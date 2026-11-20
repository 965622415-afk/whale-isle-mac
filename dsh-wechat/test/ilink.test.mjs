import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import test from 'node:test';
import { createIlink, splitIlinkText } from '../src/ilink.mjs';

const credentials = {
  token: 'fixture-token', baseUrl: 'https://idc-3.weixin.qq.com',
  botId: 'fixture@im.bot', ownerId: 'owner@im.wechat',
};

const reply = { credentials, to: credentials.ownerId, contextToken: 'fixture-context', clientId: 'jingyu-fixture' };

test('requests a QR code, validates redirects and forwards optional verification digits', async () => {
  const results = [
    { qrcode: 'ticket', qrcode_img_content: 'https://weixin.qq.com/x/fixture' },
    { status: 'scaned_but_redirect', redirect_host: 'idc-3.weixin.qq.com' },
    { status: 'confirmed_but_need_verifycode' },
    {
      status: 'confirmed', bot_token: credentials.token, ilink_bot_id: credentials.botId,
      ilink_user_id: credentials.ownerId,
    },
    { status: 'scaned_but_redirect', redirect_host: 'idc-3.weixin.qq.com.example.org' },
  ];
  const requests = [];
  const ilink = createIlink({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json(results.shift());
    },
  });

  const session = await ilink.startLogin();
  assert.equal(session.qrContent, 'https://weixin.qq.com/x/fixture');
  const redirect = await ilink.pollLogin(session);
  assert.equal(redirect.baseUrl, credentials.baseUrl);
  const input = { ...session, baseUrl: redirect.baseUrl };
  assert.equal((await ilink.pollLogin(input)).status, 'need_verifycode');
  const login = await ilink.pollLogin({ ...input, verifyCode: '004123' });
  assert.deepEqual(login.credentials, credentials);
  await assert.rejects(ilink.pollLogin(input), { code: 'UNTRUSTED_URL' });

  assert.equal(requests[0].url.hostname, 'ilinkai.weixin.qq.com');
  assert.equal(requests[0].url.searchParams.get('bot_type'), '3');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), { local_token_list: [] });
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[1].options.method, 'GET');
  assert.equal(requests[1].options.headers.AuthorizationType, undefined);
  assert.equal(requests[2].url.hostname, 'idc-3.weixin.qq.com');
  assert.equal(requests[3].url.searchParams.get('qrcode'), 'ticket');
  assert.equal(requests[3].url.searchParams.get('verify_code'), '004123');
});

test('uses a cursor and preserves full precision of inbound message IDs', async () => {
  const ilink = createIlink({
    fetchImpl: async (url, { body, headers }) => {
      assert.equal(url.pathname, '/ilink/bot/getupdates');
      assert.equal(headers.Authorization, 'Bearer fixture-token');
      assert.equal(JSON.parse(body).get_updates_buf, 'last-cursor');
      return new Response('{"ret":0,"msgs":[{"message_id":18446744073709551614,"item_list":[{"msg_id":1}]}],"get_updates_buf":"next-cursor","longpolling_timeout_ms":24000}');
    },
  });
  const { messages, cursor, timeoutMs } = await ilink.getUpdates({ credentials, cursor: 'last-cursor' });
  assert.equal(messages[0].message_id, '18446744073709551614');
  assert.equal(messages[0].item_list[0].msg_id, '1');
  assert.equal(cursor, 'next-cursor');
  assert.equal(timeoutMs, 24_000);
});

test('preserves caller cancellation and reports invalid tokens without logging secrets', async () => {
  const controller = new AbortController();
  const blocking = createIlink({
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  const pending = blocking.getUpdates({ credentials, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });

  for (const result of [
    () => Response.json({ ret: 0, errcode: -14, errmsg: 'fixture-token' }),
    () => new Response('fixture-token', { status: 401 }),
  ]) {
    const ilink = createIlink({ fetchImpl: async () => result() });
    await assert.rejects(ilink.getUpdates({ credentials }), (error) => (
      error.code === 'AUTH_EXPIRED' && !error.message.includes('fixture-token')
    ));
  }
});

test('sends text using the inbound conversation context', async () => {
  const ilink = createIlink({
    fetchImpl: async (url, { body }) => {
      assert.equal(url.pathname, '/ilink/bot/sendmessage');
      const { msg, base_info } = JSON.parse(body);
      assert.equal(base_info.bot_agent, 'Jingyu/1.0.0');
      assert.equal(msg.to_user_id, credentials.ownerId);
      assert.equal(msg.context_token, 'fixture-context');
      assert.equal(msg.client_id, 'jingyu-fixture');
      assert.deepEqual(msg.item_list, [{ type: 1, text_item: { text: '你好' } }]);
      return Response.json({ ret: 0 });
    },
  });
  await ilink.sendText({ ...reply, text: '你好' });
});

test('splits long mixed-language replies within size targets and keeps emoji sequences together', () => {
  const family = '👩‍👩‍👧‍👦';
  const input = `  ${'鯨'.repeat(998)}${family}${' 海岛\n'.repeat(900)}${family}  `;
  const parts = splitIlinkText(input);
  assert.ok(parts.length > 3);
  assert.equal(parts.join(''), input.trim());
  assert.ok(parts[1].startsWith(family));
  for (const part of parts) {
    assert.ok(part.length <= 1000);
    assert.ok(Buffer.byteLength(part) <= 3000);
  }
});

for (const kind of ['image', 'file']) {
  test(`encrypts and uploads ${kind} before sending the media reference`, async () => {
    const bytes = Buffer.from('attachment');
    const requests = [];
    let uploadRequest;
    const ilink = createIlink({
      fetchImpl: async (url, options) => {
        requests.push(url.pathname);
        if (url.pathname.endsWith('/getuploadurl')) {
          uploadRequest = JSON.parse(options.body);
          assert.equal(uploadRequest.media_type, kind === 'image' ? 1 : 3);
          assert.equal(uploadRequest.rawsize, bytes.length);
          assert.equal(uploadRequest.rawfilemd5, createHash('md5').update(bytes).digest('hex'));
          return Response.json(kind === 'image'
            ? { upload_param: 'fixture+parameter' }
            : { upload_full_url: 'https://novac2c.cdn.weixin.qq.com/c2c/upload?t=fixture%2Bparameter' });
        }
        if (url.pathname.endsWith('/upload')) {
          if (kind === 'image') {
            assert.equal(url.searchParams.get('filekey'), uploadRequest.filekey);
            assert.equal(url.searchParams.get('encrypted_query_param'), 'fixture+parameter');
          } else {
            assert.equal(url.searchParams.get('t'), 'fixture+parameter');
          }
          assert.equal(url.hostname, 'novac2c.cdn.weixin.qq.com');
          assert.equal(options.redirect, 'error');
          assert.equal(options.headers.Authorization, undefined);
          assert.equal(options.body.length, uploadRequest.filesize);
          const key = Buffer.from(uploadRequest.aeskey, 'hex');
          const cipher = createDecipheriv('aes-128-ecb', key, null);
          assert.deepEqual(Buffer.concat([cipher.update(options.body), cipher.final()]), bytes);
          return new Response('', { headers: { 'x-encrypted-param': 'fixture-download' } });
        }
        assert.equal(url.pathname, '/ilink/bot/sendmessage');
        const item = JSON.parse(options.body).msg.item_list[0];
        const media = {
          encrypt_query_param: 'fixture-download',
          aes_key: Buffer.from(uploadRequest.aeskey).toString('base64'),
          encrypt_type: 1,
        };
        const expected = kind === 'image'
          ? { type: 2, image_item: { media, mid_size: uploadRequest.filesize } }
          : { type: 4, file_item: { media, file_name: '鲸屿 项目总结.pdf', len: String(bytes.length) } };
        assert.deepEqual(item, expected);
        return Response.json({ ret: 0 });
      },
    });
    await ilink.sendMedia({ ...reply, kind, bytes, name: '/some/path/鲸屿 项目总结.pdf' });
    assert.equal(requests.length, 3);
  });
}

test('does not upload to a non-WeChat host returned by the server', async () => {
  const ilink = createIlink({
    fetchImpl: async (url) => {
      assert.equal(url.pathname, '/ilink/bot/getuploadurl');
      return Response.json({ upload_full_url: 'https://novac2c.cdn.weixin.qq.com.example.org/x' });
    },
  });
  await assert.rejects(
    ilink.sendMedia({ ...reply, kind: 'image', bytes: Buffer.from('image') }),
    { code: 'UNTRUSTED_URL' },
  );
});
