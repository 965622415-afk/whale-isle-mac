import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Wire format: https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md
const API_ORIGIN = 'https://ilinkai.weixin.qq.com';
const CDN_UPLOAD = 'https://novac2c.cdn.weixin.qq.com/c2c/upload';
// The backend identifies the compatible protocol generation by its numeric prefix.
const VERSION = '3.0.0';
const [major, minor, patch] = VERSION.split('.').map(Number);
const CLIENT_VERSION = String((major << 16) | (minor << 8) | patch);
const BASE_INFO = { channel_version: `${VERSION}/jingyu-1.0.0`, bot_agent: 'Jingyu/1.0.0' };
const DEFAULT_LONG_POLL_MS = 35_000;
const textSegments = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const MAX_TEXT_UNITS = 1000;
const MAX_TEXT_BYTES = 3000;
const ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id']);
const LOGIN_STATES = new Set([
  'wait', 'scaned', 'scaned_but_redirect', 'confirmed', 'expired',
  'need_verifycode', 'verify_code_blocked', 'binded_redirect',
]);

export class IlinkError extends Error {
  constructor(message, { code, httpStatus, apiCode } = {}) {
    super(message);
    this.name = 'IlinkError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.apiCode = apiCode;
  }
}

function trustedUrl(value, hostAllowed) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new IlinkError('微信返回了无效的服务地址。', { code: 'UNTRUSTED_URL' });
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hostAllowed(url.hostname)) {
    throw new IlinkError('微信返回的服务地址不在受信域名内。', { code: 'UNTRUSTED_URL' });
  }
  return url;
}

function apiOrigin(value) {
  return trustedUrl(value, (host) => host === 'ilinkai.wechat.com' || host.endsWith('.weixin.qq.com')).origin;
}

function cdnUrl(value) {
  return trustedUrl(value, (host) => host.endsWith('.cdn.weixin.qq.com') || host.endsWith('.cdn.wechat.com'));
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IlinkError(`微信接口缺少${label}。`, { code: 'INVALID_DATA' });
  }
  return value;
}

function checkApiResult(result, label) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new IlinkError(`微信${label}返回了无效数据。`, { code: 'INVALID_DATA' });
  }
  const codes = [result.ret, result.errcode].map(Number).filter((code) => Number.isFinite(code) && code !== 0);
  if (codes.includes(-14)) {
    throw new IlinkError('微信连接凭证暂时失效，请稍后重试或重新扫码。', { code: 'AUTH_EXPIRED', apiCode: -14 });
  }
  if (codes.length) {
    throw new IlinkError(`微信${label}失败（${codes.join('/')}）。`, { code: 'API_ERROR', apiCode: codes[0] });
  }
  return result;
}

function parseJson(text, label) {
  try {
    // WeChat identifiers are uint64 and may exceed JavaScript's safe integer range.
    return JSON.parse(text, (key, value, context) => {
      if (ID_FIELDS.has(key) && typeof value === 'number' && /^-?\d+$/.test(context?.source ?? '')) {
        return context.source;
      }
      return value;
    });
  } catch {
    // The server payload can contain a bot token or QR code.
    throw new IlinkError(`微信${label}返回的内容无法读取。`, { code: 'INVALID_DATA' });
  }
}

// Conservative local chunk sizes. The backend protocol does not publish a text limit.
export function splitIlinkText(text) {
  const parts = [];
  let part = '';
  let bytes = 0;
  for (const { segment } of textSegments.segment(text.trim())) {
    const segments = segment.length > MAX_TEXT_UNITS || Buffer.byteLength(segment) > MAX_TEXT_BYTES
      ? Array.from(segment)
      : [segment];
    for (const unit of segments) {
      const size = Buffer.byteLength(unit);
      if (part.length + unit.length > MAX_TEXT_UNITS || bytes + size > MAX_TEXT_BYTES) {
        if (part.trim()) parts.push(part);
        part = '';
        bytes = 0;
      }
      part += unit;
      bytes += size;
    }
  }
  if (part.trim()) parts.push(part);
  return parts;
}

/**
 * Single-account callers persist credentials and cursor outside this transport.
 * startLogin({signal}) yields {qrcode, qrContent, baseUrl}.
 * pollLogin({qrcode, baseUrl, verifyCode, signal}) yields {status, baseUrl, credentials?}.
 * Carry baseUrl into the next poll. A confirmed login yields credentials
 * {token, baseUrl, botId, ownerId}. Keep the token and verification code local.
 * getUpdates({credentials, cursor, timeoutMs, signal}) yields {messages, cursor, timeoutMs}.
 * sendText({credentials, to, contextToken, text, clientId, signal}) sends a reply.
 * sendMedia({credentials, to, contextToken, kind, bytes, name, clientId, signal})
 * sends an image or a file. Audio attachments use kind 'file'.
 */
export function createIlink({ fetchImpl = fetch } = {}) {
  async function request(url, options, { label, signal, timeoutMs, authenticated = false, read }) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    requestSignal.throwIfAborted();
    try {
      const response = await fetchImpl(url, { ...options, signal: requestSignal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        const httpStatus = response.status;
        const authExpired = authenticated && (httpStatus === 401 || httpStatus === 403);
        throw new IlinkError(
          authExpired ? '微信连接凭证无法使用，请重新扫码。' : `微信${label}请求失败（HTTP ${httpStatus}）。`,
          { code: authExpired ? 'AUTH_EXPIRED' : 'HTTP_ERROR', httpStatus },
        );
      }
      return await read(response);
    } catch (error) {
      signal?.throwIfAborted();
      if (timeoutSignal.aborted) {
        throw new IlinkError(`微信${label}响应超时。`, { code: 'TIMEOUT' });
      }
      if (error instanceof IlinkError) throw error;
      throw new IlinkError(`无法连接微信${label}服务。`, { code: 'NETWORK_ERROR' });
    }
  }

  async function callApi(path, {
    baseUrl = API_ORIGIN, token, query, payload, signal, timeoutMs = 15_000, label,
  }) {
    const url = new URL(`/ilink/bot/${path}`, apiOrigin(baseUrl));
    if (query) url.search = new URLSearchParams(query);
    const headers = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': CLIENT_VERSION };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers.AuthorizationType = 'ilink_bot_token';
      headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64');
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    return request(url, {
      method: payload ? 'POST' : 'GET',
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    }, {
      label,
      signal,
      timeoutMs,
      authenticated: Boolean(token),
      read: async (response) => checkApiResult(parseJson(await response.text(), label), label),
    });
  }

  function callBot(path, credentials, data, options) {
    const token = requiredString(credentials?.token, '登录凭证');
    return callApi(path, {
      ...options,
      token,
      baseUrl: credentials.baseUrl,
      payload: { ...data, base_info: BASE_INFO },
    });
  }

  async function startLogin({ signal } = {}) {
    // The documented own-account bind starts directly at the bot QR endpoint.
    const result = await callApi('get_bot_qrcode', {
      query: { bot_type: '3' }, payload: { local_token_list: [] }, signal, label: '二维码',
    });
    return {
      qrcode: requiredString(result.qrcode, '二维码标识'),
      qrContent: requiredString(result.qrcode_img_content, '二维码内容'),
      baseUrl: API_ORIGIN,
    };
  }

  async function pollLogin({ qrcode, baseUrl = API_ORIGIN, verifyCode, signal }) {
    const query = { qrcode: requiredString(qrcode, '二维码标识') };
    if (verifyCode !== undefined && verifyCode !== '') {
      if (typeof verifyCode !== 'string' || !/^\d{1,16}$/.test(verifyCode)) {
        throw new IlinkError('请输入微信显示的数字验证码。', { code: 'INVALID_DATA' });
      }
      query.verify_code = verifyCode;
    }
    let result;
    try {
      result = await callApi('get_qrcode_status', {
        baseUrl, query, signal, timeoutMs: DEFAULT_LONG_POLL_MS + 5_000, label: '扫码状态',
      });
    } catch (error) {
      if (error.code === 'TIMEOUT' || error.httpStatus === 504 || error.httpStatus === 524) {
        return { status: 'wait', baseUrl };
      }
      throw error;
    }
    const rawStatus = requiredString(result.status, '扫码状态');
    const status = rawStatus.includes('need_verifycode') ? 'need_verifycode' : rawStatus;
    if (!LOGIN_STATES.has(status)) {
      throw new IlinkError('微信返回了未知的扫码状态。', { code: 'INVALID_DATA' });
    }
    if (status === 'scaned_but_redirect' && result.redirect_host) {
      baseUrl = apiOrigin(`https://${result.redirect_host}`);
    }
    if (status !== 'confirmed') return { status, baseUrl };
    baseUrl = apiOrigin(result.baseurl || baseUrl);
    return {
      status,
      baseUrl,
      credentials: {
        token: requiredString(result.bot_token, '登录凭证'),
        baseUrl,
        botId: requiredString(result.ilink_bot_id, '机器人账号'),
        ownerId: requiredString(result.ilink_user_id, '扫码账号'),
      },
    };
  }

  async function getUpdates({ credentials, cursor = '', timeoutMs = DEFAULT_LONG_POLL_MS, signal }) {
    const pollMs = Number.isFinite(timeoutMs) ? Math.min(90_000, Math.max(1000, timeoutMs)) : DEFAULT_LONG_POLL_MS;
    let result;
    try {
      result = await callBot('getupdates', credentials, { get_updates_buf: cursor }, {
        signal, label: '收取消息', timeoutMs: Math.ceil(pollMs) + 5000,
      });
    } catch (error) {
      if (error.code === 'TIMEOUT') return { messages: [], cursor, timeoutMs: pollMs };
      throw error;
    }
    if (result.msgs !== undefined && !Array.isArray(result.msgs)) {
      throw new IlinkError('微信返回了无效的消息列表。', { code: 'INVALID_DATA' });
    }
    return {
      messages: result.msgs ?? [],
      cursor: typeof result.get_updates_buf === 'string' && result.get_updates_buf ? result.get_updates_buf : cursor,
      timeoutMs: Number.isFinite(result.longpolling_timeout_ms) ? result.longpolling_timeout_ms : pollMs,
    };
  }

  function sendItem({ credentials, to, contextToken, clientId = `jingyu-${randomUUID()}`, signal }, item) {
    return callBot('sendmessage', credentials, {
      msg: {
        from_user_id: '',
        to_user_id: requiredString(to, '收件人'),
        client_id: requiredString(clientId, '消息标识'),
        message_type: 2,
        message_state: 2,
        context_token: requiredString(contextToken, '对话凭证'),
        item_list: [item],
      },
    }, { signal, label: '发送消息' });
  }

  function sendText(options) {
    const text = requiredString(options.text, '消息正文');
    return sendItem(options, { type: 1, text_item: { text } });
  }

  async function uploadEncrypted(url, ciphertext, signal) {
    // Keep a minimum time budget for small files and give larger ones longer to send.
    const timeoutMs = Math.max(35_000, Math.ceil(ciphertext.length / (128 * 1024)) * 1000);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await request(url, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: ciphertext,
        }, {
          signal,
          timeoutMs,
          label: '媒体上传',
          read: async (response) => {
            const parameter = response.headers.get('x-encrypted-param');
            await response.body?.cancel();
            if (response.status !== 200 || !parameter) {
              throw new IlinkError('微信媒体服务器未确认接收文件。', { code: 'UPLOAD_ERROR' });
            }
            return parameter;
          },
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (attempt === 3 || (error.httpStatus >= 400 && error.httpStatus < 500)) throw error;
        await delay(300 * attempt, undefined, { signal });
      }
    }
  }

  async function sendMedia(options) {
    const { credentials, to, contextToken, kind, bytes, name, signal } = options;
    requiredString(contextToken, '对话凭证');
    if (kind !== 'image' && kind !== 'file') {
      throw new IlinkError('微信媒体类型须为图片或文件。', { code: 'INVALID_DATA' });
    }
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
      throw new IlinkError('微信媒体文件没有可发送的内容。', { code: 'INVALID_DATA' });
    }
    const fileName = kind === 'file'
      ? basename(requiredString(name, '文件名').replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/gu, '')
      : undefined;
    if (kind === 'file' && (!fileName || fileName === '.' || fileName === '..')) {
      throw new IlinkError('微信媒体文件名无效。', { code: 'INVALID_DATA' });
    }
    const key = randomBytes(16);
    const keyHex = key.toString('hex');
    const filekey = randomBytes(16).toString('hex');
    const cipher = createCipheriv('aes-128-ecb', key, null);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const upload = await callBot('getuploadurl', credentials, {
      filekey,
      media_type: kind === 'image' ? 1 : 3,
      to_user_id: requiredString(to, '收件人'),
      rawsize: bytes.length,
      rawfilemd5: createHash('md5').update(bytes).digest('hex'),
      filesize: ciphertext.length,
      no_need_thumb: true,
      aeskey: keyHex,
    }, { signal, label: '获取媒体上传地址' });
    let url;
    if (typeof upload.upload_full_url === 'string' && upload.upload_full_url.trim()) {
      url = cdnUrl(upload.upload_full_url);
    } else {
      url = new URL(CDN_UPLOAD);
      url.searchParams.set('encrypted_query_param', requiredString(upload.upload_param, '媒体上传参数'));
      url.searchParams.set('filekey', filekey);
    }
    const parameter = await uploadEncrypted(url, ciphertext, signal);
    const media = {
      encrypt_query_param: parameter,
      aes_key: Buffer.from(keyHex).toString('base64'),
      encrypt_type: 1,
    };
    const item = kind === 'image'
      ? { type: 2, image_item: { media, mid_size: ciphertext.length } }
      : { type: 4, file_item: { media, file_name: fileName, len: String(bytes.length) } };
    return sendItem(options, item);
  }

  return { startLogin, pollLogin, getUpdates, sendText, sendMedia };
}
