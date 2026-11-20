import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const allowedActions = new Set([
  'status', 'save', 'login', 'logout', 'pin', 'upload', 'deleteMedia', 'voices', 'testChat',
  'saveMedia', 'listDiary', 'writeDiary', 'testWork',
]);
const maximumBody = 7 * 1024 * 1024;
const maximumGroupBody = 32 * 1024;
const contentType = /^application\/json(?:\s*;|$)/i;
const groupErrors = new Map([
  [400, '群聊消息格式不正确。'],
  [401, '群聊连接凭证无效。'],
  [403, '当前群或消息没有授权。'],
  [409, '群聊消息处理发生冲突，请稍后重试。'],
  [503, '鲸屿群聊服务暂不可用。'],
]);

async function readJson(request, limit) {
  if (Number(request.headers['content-length']) > limit) {
    return { error: '请求内容太大。', status: 413 };
  }

  let total = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    total += chunk.length;
    if (total > limit) return { error: '请求内容太大。', status: 413 };
    chunks.push(chunk);
  }

  try {
    const content = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      return { content };
    }
  } catch {}
  return { error: '无法识别这个请求。', status: 400 };
}

export async function startPanel({ port = 18429, onAction, onGroup }) {
  const csrf = randomBytes(32).toString('hex');
  let origin;
  let expectedHost;
  const server = createServer({
    maxHeaderSize: 8192,
    headersTimeout: 10_000,
    requestTimeout: 25_000,
    connectionsCheckingInterval: 5_000,
  }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const json = (status, body) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };

    if (request.headers.host !== expectedHost) {
      json(403, { error: '请通过本机鲸屿地址打开设置。' });
      return;
    }
    if (request.method === 'GET' && request.url === '/') {
      const nonce = randomBytes(16).toString('base64');
      response.setHeader('Content-Security-Policy', [
        "default-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
        "connect-src 'self'", "img-src 'self' data:", "script-src 'nonce-" + nonce + "'",
        "style-src 'nonce-" + nonce + "'",
      ].join('; '));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(page(nonce, csrf));
      return;
    }
    const groupRequest = request.method === 'POST' && request.url === '/api/group/reply';
    const panelRequest = request.method === 'POST' && request.url === '/api/action';
    if (!groupRequest && !panelRequest) {
      json(404, { error: '找不到这个页面。' });
      return;
    }
    if (groupRequest && request.headers.origin !== undefined) {
      json(403, { error: groupErrors.get(403) });
      return;
    }
    if (panelRequest && (
      request.headers.origin !== origin ||
      request.headers['x-jingyu-csrf'] !== csrf ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
    )) {
      json(403, { error: '这个操作需要从本机鲸屿页面发起。' });
      return;
    }
    if (!contentType.test(request.headers['content-type'] ?? '')) {
      json(415, { error: '无法读取请求格式。' });
      return;
    }

    try {
      const received = await readJson(request, groupRequest ? maximumGroupBody : maximumBody);
      if (received.error) {
        if (received.status === 413) response.setHeader('Connection', 'close');
        json(received.status, { error: received.error });
        return;
      }
      if (groupRequest) {
        if (typeof onGroup !== 'function') {
          json(503, { error: groupErrors.get(503) });
          return;
        }
        const result = await onGroup(received.content, request.headers.authorization);
        json(200, result ?? {});
        return;
      }
      const { action, data = {} } = received.content;
      if (!allowedActions.has(action) || !data || typeof data !== 'object' || Array.isArray(data)) {
        json(400, { error: '无法识别这个请求。' });
        return;
      }
      const result = await onAction(action, data);
      json(200, result ?? {});
    } catch (error) {
      if (groupRequest) {
        const status = groupErrors.has(error?.status) ? error.status : 503;
        json(status, { error: groupErrors.get(status) });
        return;
      }
      json(400, { error: error instanceof Error ? error.message : '操作失败，请稍后重试。' });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      expectedHost = '127.0.0.1:' + server.address().port;
      origin = 'http://' + expectedHost;
      server.off('error', reject);
      resolve();
    });
  });
  return {
    url: origin + '/',
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

function page(nonce, csrf) {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="jingyu-csrf" content="${csrf}">
  <title>鲸屿 · 本机设置</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; --ink:#172b2e; --muted:#536a6b; --paper:#f4f8f6;
      --surface:#fff; --line:#dbe7e2; --deep:#164b43; --teal:#d9f1e6; --danger:#992f3f;
      font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft Yahei",sans-serif; }
    * { box-sizing:border-box; }
    [hidden] { display:none !important; }
    body { margin:0; background:var(--paper); color:var(--ink); line-height:1.55; }
    header { background:var(--surface); border-bottom:1px solid var(--line); }
    header > div, main { width:min(1056px, calc(100% - 48px)); margin-inline:auto; }
    header > div { display:flex; align-items:center; justify-content:space-between; gap:16px; height:67px; }
    .brand { display:flex; align-items:center; gap:11px; font-size:1.24rem; font-weight:750; }
    .brand-icon { display:grid; place-items:center; width:34px; height:34px; color:white;
      background:var(--deep); border-radius:11px; font-size:1.2rem; }
    .host { color:var(--muted); font-size:.83rem; }
    main { padding:30px 0 72px; }
    .hero { display:flex; justify-content:space-between; gap:20px; align-items:center; margin-bottom:24px;
      padding:28px 30px; border-radius:22px; background:linear-gradient(122deg,#d9f1e6,#e5f4f1 70%,#d9ecf1);
      border:1px solid #cce4df; }
    h1,h2,h3,p { margin:0; }
    h1 { font-size:clamp(1.75rem,4.5vw,2.3rem); letter-spacing:.045em; line-height:1.27; }
    h2 { font-size:1.25rem; line-height:1.3; }
    h3 { font-size:1rem; }
    p, .help { color:var(--muted); }
    .hero p { margin-top:7px; font-size:.94rem; color:#334e4e; }
    .badge { display:inline-flex; flex:none; gap:8px; align-items:center; color:#315351;
      border:1px solid #cce0d8; background:#f6fcf9; border-radius:999px; padding:6px 12px;
      font-size:.85rem; font-weight:650; }
    .badge::before { content:""; width:8px; height:8px; border-radius:50%; background:#829793; }
    .badge[data-state="connected"]::before { background:#23805e; }
    .badge[data-state="pairing"]::before,.badge[data-state="claim"]::before { background:#b27120; }
    .badge[data-state="expired"]::before,.badge[data-state="error"]::before { background:#a24456; }
    .grid { display:grid; grid-template-columns:1.05fr .95fr; gap:18px; align-items:start; }
    .column { display:grid; gap:18px; }
    .card { min-width:0; display:grid; gap:16px; padding:24px; border:1px solid var(--line);
      border-radius:17px; background:var(--surface); box-shadow:0 2px 5px #192f3006; }
    .heading { display:grid; gap:5px; }
    .heading p,.help { font-size:.85rem; }
    .steps { margin:0; padding:0 0 0 1.24em; display:grid; gap:8px; color:#3f5758; font-size:.89rem; }
    .actions { display:flex; align-items:center; flex-wrap:wrap; gap:9px; }
    button, .link-button { min-height:40px; border:1px solid transparent; border-radius:9px; padding:8px 13px;
      font:inherit; font-size:.875rem; font-weight:650; cursor:pointer; line-height:1.45; }
    button, .link-button { color:var(--deep); background:#eef6f2; }
    button:hover, .link-button:hover { background:#e1f0e9; }
    button.primary { color:white; background:var(--deep); }
    button.primary:hover { background:#206255; }
    button.secondary { background:white; border-color:var(--line); }
    button.secondary:hover { background:var(--paper); }
    button.danger { color:var(--danger); background:white; border-color:#efdee2; }
    button.danger:hover { background:#fdf3f5; }
    button:disabled { opacity:.57; cursor:wait; }
    button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible,
    summary:focus-visible {
      outline:3px solid #90cdb9; outline-offset:2px;
    }
    .link-button { display:inline-flex; align-items:center; text-decoration:none; }
    .notice { overflow-wrap:anywhere; color:#385451; background:#f0f7f3; border:1px solid #dcebe4;
      font-size:.88rem; padding:10px 12px; border-radius:9px; white-space:pre-wrap; }
    .notice.error { color:#802b3a; background:#fcf2f4; border-color:#efd8de; }
    .pair { display:flex; flex-wrap:wrap; align-items:center; gap:15px; }
    .qr { background:white; border:1px solid var(--line); border-radius:11px; padding:10px;
      height:166px; width:166px; image-rendering:pixelated; }
    .session { display:grid; gap:6px; margin:0; }
    .session > div { display:grid; grid-template-columns:5.1em 1fr; align-items:baseline; gap:10px; }
    dt { color:var(--muted); font-size:.81rem; }
    dd { margin:0; font-size:.82rem; overflow-wrap:anywhere; }
    code { color:#315350; background:#ecf4f1; padding:2px 5px; border-radius:5px; }
    fieldset { display:grid; gap:14px; min-width:0; padding:0; margin:0; border:0; }
    form { display:grid; gap:12px; min-width:0; }
    label { display:grid; gap:6px; font-size:.88rem; font-weight:650; }
    input:not([type=checkbox]),textarea,select { width:100%; min-width:0; border:1px solid #cbdcd6; border-radius:9px;
      background:#fbfdfc; color:var(--ink); padding:9px 11px; font:inherit; font-size:.88rem; }
    input::placeholder, textarea::placeholder { color:#6c7e7b; }
    textarea { min-height:92px; resize:vertical; }
    textarea[name=memory], textarea[name=publicMemory] { min-height:112px; }
    .check { display:flex; align-items:center; gap:8px; }
    input[type=checkbox] { width:17px; height:17px; margin:0; accent-color:var(--deep); }
    .media-list { margin:0; padding:0; list-style:none; display:grid; gap:7px; }
    .media-list li { min-width:0; border:1px solid var(--line); border-radius:9px; }
    .media-list details { padding:8px 11px; }
    .media-list summary { cursor:pointer; overflow-wrap:anywhere; font-size:.88rem; font-weight:650; }
    .media-list form { margin-top:10px; }
    .media-list button { flex:none; min-height:32px; font-size:.79rem; padding:5px 8px; }
    .diaries { display:grid; gap:7px; }
    .diaries details { min-width:0; border:1px solid var(--line); border-radius:9px; padding:8px 11px; }
    .diaries summary { cursor:pointer; color:#315350; font-size:.88rem; font-weight:650; }
    .diaries p { white-space:pre-wrap; overflow-wrap:anywhere; margin-top:7px; font-size:.86rem; }
    .row { display:flex; align-items:center; gap:9px; }
    .row > :first-child { flex:1; }
    .row > button { white-space:nowrap; }
    .divider { border:0; height:1px; width:100%; margin:1px 0; background:var(--line); }
    .save { position:sticky; bottom:10px; z-index:1; display:flex; justify-content:flex-end; align-items:center;
      gap:10px; padding:9px 10px; margin:-6px -5px -6px; border:1px solid var(--line);
      border-radius:13px; background:#fcfefdee; box-shadow:0 2px 8px #142f3010; }
    #feedback { margin-inline:auto 0; font-size:.84rem; }
    @media (max-width:760px) {
      .grid { grid-template-columns:1fr; }
      header > div, main { width:min(620px, calc(100% - 32px)); }
      main { padding-top:20px; }
    }
    @media (max-width:420px) {
      .hero { align-items:flex-start; flex-direction:column; gap:11px; padding:20px; }
      .card { padding:18px; }
      .row { flex-wrap:wrap; }
    }
  </style>
</head>
<body>
  <header><div><div class="brand"><span class="brand-icon" aria-hidden="true">🐋</span>鲸屿</div>
  <span class="host">Mac 本机设置</span></div></header>
  <main>
    <section class="hero" aria-labelledby="title">
      <div><h1 id="title">鲸屿</h1><p>在微信聊天，也能把工作交给 Mac 上的 DSH。</p></div>
      <span class="badge" id="connection-badge" role="status">正在读取状态</span>
    </section>
    <div class="grid">
      <div class="column">
        <section class="card" aria-labelledby="connection-heading">
          <div class="heading">
            <h2 id="connection-heading">连接微信与 DSH</h2>
            <p>微信消息进入 DSH 原生会话，回复会发回微信。</p>
          </div>
          <ol class="steps" id="setup-steps">
            <li>打开电脑上的 DSH，登录并启用鲸屿插件。</li>
            <li>点击连接微信，用手机微信扫码，再根据提示完成绑定。</li>
            <li>在微信给鲸屿发一句话，到 DSH 找到对应会话。</li>
          </ol>
          <div class="actions">
            <button class="primary" type="button" id="login">连接微信</button>
            <button class="danger" type="button" id="logout" hidden>断开连接</button>
          </div>
          <p class="notice" id="connection-message" hidden></p>
          <div class="pair" id="pair" hidden>
            <img id="qr" class="qr" alt="用微信扫一扫连接鲸屿" hidden>
            <a id="qr-link" class="link-button" target="_blank" rel="noopener noreferrer" hidden>打开微信连接页 ↗</a>
          </div>
          <form id="pin-form" hidden>
            <label for="pin">微信显示的验证码</label>
            <div class="row">
              <input id="pin" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="16" required>
              <button class="primary">提交验证码</button>
            </div>
          </form>
          <div class="notice" id="claim" hidden>
            在手机微信里打开鲸屿的对话，并发送 <code id="claim-code"></code>。
          </div>
          <dl class="session" id="sessions" hidden>
            <div id="chat-session" hidden><dt>聊天会话</dt><dd id="chat-id"></dd></div>
            <div id="work-session" hidden><dt>工作会话</dt><dd id="work-id"></dd></div>
          </dl>
          <p class="notice error" id="last-error" hidden></p>
          <hr class="divider">
          <form id="test-form">
            <label for="test-text">测试 DSH</label>
            <p class="help">即使还没连接微信，也可以先测试 DSH 插件。测试会在 DSH 留下一条对话。</p>
            <div class="row">
              <input id="test-text" type="text" value="你好，鲸屿。请简单介绍一下自己。" maxlength="2000" required>
              <button type="submit" class="secondary">发测试消息</button>
            </div>
          </form>
          <p class="help">Mac 锁屏后可以继续收消息，只要系统保持唤醒、联网，且鲸屿和 DSH 在运行。</p>
        </section>
        <section class="card" aria-labelledby="media-heading">
          <div class="heading">
            <h2 id="media-heading">表情包</h2>
            <p>在微信发送 <code>/sticker</code> 随机取一张，或发送 <code>/sticker 名称</code> 选一张。</p>
          </div>
          <ul id="media-list" class="media-list" hidden></ul>
          <p class="help" id="media-empty">还没有上传表情图片。</p>
          <form id="upload-form">
            <label>图片名称
              <input id="media-name" type="text" placeholder="留空时使用文件名" maxlength="96">
            </label>
            <label>从电脑选择图片
              <input id="media-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required>
            </label>
            <label>标签
              <input id="media-tags" type="text" placeholder="例如 开心、撒娇、鼓掌" maxlength="250">
            </label>
            <label>图片描述
              <input id="media-description" type="text" placeholder="例如 笑着挥手的小鲸鱼，适合见面时发" maxlength="500">
            </label>
            <div class="actions"><button class="secondary" type="submit">添加到表情包</button></div>
          </form>
        </section>
        <section class="card" aria-labelledby="diary-heading">
          <div class="heading">
            <h2 id="diary-heading">日记</h2>
            <p>查看鲸屿已经写下的日记，或让她现在写一篇。</p>
          </div>
          <div class="actions">
            <button class="secondary" id="read-diary" type="button">查看日记</button>
            <button class="secondary" id="write-diary" type="button">写今日日记</button>
          </div>
          <div class="diaries" id="diary-list" hidden></div>
          <p class="help" id="diary-status" hidden></p>
        </section>
      </div>
      <form id="settings-form" class="column" autocomplete="off">
        <section class="card" aria-labelledby="persona-heading">
          <div class="heading">
            <h2 id="persona-heading">姓名与人格</h2>
          </div>
          <fieldset disabled id="persona-fields">
            <label>她的名字<input name="name" type="text" maxlength="40" required></label>
            <label>她怎么称呼你<input name="ownerName" type="text" maxlength="60" placeholder="例如 小林、船长"></label>
            <label>她的别名<input name="aliases" type="text" maxlength="300" placeholder="例如 鲸鲸、鲸鱼娘"></label>
            <label>人格<textarea name="personality" maxlength="8000" placeholder="希望她怎样说话、表达关心和陪你聊天。"></textarea></label>
            <label>背景故事<textarea name="background" maxlength="8000" placeholder="可以写她的来历、生活和你们为什么认识。"></textarea></label>
          </fieldset>
        </section>
        <section class="card" aria-labelledby="memory-heading">
          <div class="heading">
            <h2 id="memory-heading">长期记忆</h2>
            <p>在这里添加、修改或删掉想让她记住的事。可以一条写一行。</p>
          </div>
          <fieldset disabled id="memory-fields">
            <label>私聊记忆<textarea name="memory" maxlength="16000" placeholder="例如 心情不好时我更喜欢有人先听我说。"></textarea></label>
            <label>群聊可用记忆<textarea name="publicMemory" maxlength="16000" placeholder="例如 我喜欢先听结论，写代码时习惯用两格缩进。"></textarea></label>
            <p class="help">私聊记忆只给你的私密会话使用。你启用群聊时，鲸屿可以在群聊使用第二栏的内容。</p>
            <p class="help">相关记忆会随对话发给 DSH 使用的模型。</p>
          </fieldset>
        </section>
        <section class="card" aria-labelledby="group-heading">
          <div class="heading">
            <h2 id="group-heading">普通微信群聊</h2>
            <p>可选 AstrBot 通道，须有已验证的普通微信群适配器。已授权群里有人直接 @ 鲸屿时，每个群在独立的 DSH 会话里陪聊。</p>
            <p>群聊只开放陪伴对话。远程工作和取文件在私聊中使用。</p>
          </div>
          <fieldset disabled id="group-fields">
            <label class="check"><input name="groupEnabled" type="checkbox">启用 AstrBot 群聊陪伴</label>
            <label>授权的群聊 ID
              <textarea name="groupIds" maxlength="8000" spellcheck="false" placeholder="填写适配器提供的群聊 ID，每行一个"></textarea>
            </label>
          </fieldset>
          <div id="group-config" class="heading" hidden>
            <p>在同一台 Mac 的 AstrBot 插件中填写鲸屿接口 <code id="group-endpoint"></code>。</p>
            <label for="group-key">群聊连接凭证</label>
            <div class="row">
              <input id="group-key" type="password" readonly spellcheck="false">
              <button class="secondary" type="button" id="show-group-key">显示</button>
              <button class="secondary" type="button" id="copy-group-key">复制</button>
            </div>
            <p class="help" id="group-key-message" role="status"></p>
          </div>
        </section>
        <section class="card" aria-labelledby="voice-heading">
          <div class="heading">
            <h2 id="voice-heading">声音与表情</h2>
            <p>语音使用 Mac 的系统音色，通过音频文件发到微信。</p>
          </div>
          <fieldset disabled id="voice-fields">
            <label>什么时候发语音
              <select name="voiceMode">
                <option value="off">关闭语音</option>
                <option value="on-request">我用 /voice 时</option>
                <option value="always">日常聊天也发语音</option>
              </select>
            </label>
            <label>系统音色
              <input name="voice" type="text" list="voices-list" placeholder="跟随 Mac 默认音色" maxlength="100">
              <datalist id="voices-list"></datalist>
            </label>
            <p class="help">只想听这一次时，在微信发送 <code>/voice 你的问题</code>。</p>
            <label class="check"><input name="autoSticker" type="checkbox">聊天时允许鲸屿选一张表情</label>
          </fieldset>
        </section>
        <section class="card" aria-labelledby="schedule-heading">
          <div class="heading">
            <h2 id="schedule-heading">日记时间</h2>
            <p>以这台 Mac 的系统时间为准。到点时鲸屿与 DSH 需要保持运行。</p>
          </div>
          <fieldset disabled id="diary-fields">
            <label class="check"><input name="diaryEnabled" type="checkbox">每天写日记</label>
            <label>每天几点<input name="diaryTime" type="time" value="21:30"></label>
          </fieldset>
        </section>
        <section class="card" aria-labelledby="work-heading">
          <div class="heading">
            <h2 id="work-heading">远程工作</h2>
            <p>微信私聊发送 <code>开始工作</code>，接着直接说「帮我在电脑上检查这个项目」。发送 <code>结束工作</code> 回到陪伴对话。</p>
          </div>
          <fieldset disabled id="work-fields">
            <label class="check"><input name="workEnabled" type="checkbox">启用远程工作</label>
            <label>授权工作文件夹
              <input name="workspace" type="text" placeholder="/Users/你的名字/Documents/某个项目" maxlength="1024" spellcheck="false">
            </label>
            <p class="help">在 Finder 选中文件夹，按 ⌥⌘C 复制路径，然后粘贴到这里。</p>
            <label class="check"><input name="stayAwake" type="checkbox">通电时保持唤醒</label>
            <p class="help">在私聊微信已连接、远程工作已开启时生效。如果合盖触发 Mac 休眠，远程工作会暂停。</p>
            <p class="help">权限审批会在微信显示状态，请在 Mac 的 DSH 里处理。</p>
            <p class="help">发送 <code>任务结果</code> 查看最近的工作结果。结果很长时会另附报告。发送 <code>/file 相对路径</code> 取工作区里的文件。</p>
            <div class="actions"><button class="secondary" id="test-work" type="button">测试工作会话</button></div>
            <p class="help">保存设置后可运行测试。测试会创建 DSH 工作会话，请它只读列出最多五个文件名。之后可在 DSH 中设置权限。</p>
          </fieldset>
        </section>
        <div class="save">
          <p id="feedback" role="status" aria-live="polite"></p>
          <button class="primary" type="submit" id="save" disabled>保存设置</button>
        </div>
      </form>
    </div>
  </main>
  <script nonce="${nonce}">
    const get = id => document.getElementById(id);
    const form = get('settings-form');
    const labels = {
      disconnected:'微信未连接', pairing:'等待微信扫码', connected:'微信已连接',
      claim:'等待确认身份', expired:'二维码已失效'
    };
    const csrf = document.querySelector('meta[name=jingyu-csrf]').content;
    const connectionBadge = get('connection-badge');
    let initialized = false;
    let busy = false;
    let polling = false;
    let revision = 0;
    const textFields = [
      'name', 'ownerName', 'aliases', 'personality', 'background', 'memory', 'publicMemory',
      'workspace', 'voice', 'voiceMode', 'diaryTime', 'groupIds'
    ];
    const checkFields = ['workEnabled', 'stayAwake', 'autoSticker', 'diaryEnabled', 'groupEnabled'];
    const fieldsets = ['persona-fields', 'memory-fields', 'voice-fields', 'work-fields', 'diary-fields', 'group-fields'];

    async function action(name, data = {}) {
      const response = await fetch('/api/action', {
        method:'POST',
        headers: { 'content-type':'application/json', 'x-jingyu-csrf':csrf },
        body: JSON.stringify({ action:name, data })
      });
      const reply = await response.json();
      if (!response.ok) throw new Error(reply.error || '操作失败，请重试。');
      return reply;
    }

    function display(id, value) {
      const element = get(id);
      element.hidden = !value;
      element.textContent = value || '';
    }

    function updateFieldRequirements() {
      form.elements.workspace.required = form.elements.workEnabled.checked;
      form.elements.diaryTime.required = form.elements.diaryEnabled.checked;
      form.elements.groupIds.required = form.elements.groupEnabled.checked;
    }

    function fillSettings(settings) {
      if (!settings) return;
      for (const field of textFields) {
        form.elements[field].value = settings[field] ?? '';
      }
      form.elements.voiceMode.value = settings.voiceMode || (settings.voiceEnabled ? 'always' : 'on-request');
      form.elements.diaryTime.value = settings.diaryTime || '21:30';
      for (const field of checkFields) {
        form.elements[field].checked = Boolean(settings[field]);
      }
      for (const id of fieldsets) get(id).disabled = false;
      updateFieldRequirements();
      initialized = true;
      get('save').disabled = busy;
    }

    function renderMedia(items) {
      if (!Array.isArray(items)) return;
      const list = get('media-list');
      const signature = JSON.stringify(items);
      if (list.dataset.items === signature) return;
      list.dataset.items = signature;
      const openItems = new Set(Array.from(list.querySelectorAll('details[open]'), item => item.dataset.id));
      list.replaceChildren();
      list.hidden = items.length === 0;
      get('media-empty').hidden = items.length !== 0;
      for (const item of items) {
        const li = document.createElement('li');
        const details = document.createElement('details');
        const name = document.createElement('summary');
        const editor = document.createElement('form');
        const buttons = document.createElement('div');
        const save = document.createElement('button');
        const remove = document.createElement('button');
        const tags = mediaField('标签', item.tags, 250);
        const description = mediaField('图片描述', item.description, 500);
        details.dataset.id = item.id;
        details.open = openItems.has(item.id);
        name.textContent = item.name;
        buttons.className = 'actions';
        save.type = 'submit';
        save.className = 'secondary';
        save.textContent = '保存表情设置';
        remove.type = 'button';
        remove.className = 'danger';
        remove.textContent = '移除';
        remove.setAttribute('aria-label', '移除 ' + item.name);
        remove.addEventListener('click', () => {
          if (window.confirm('移除表情「' + item.name + '」？')) {
            run('deleteMedia', { id:item.id }, remove, '已移除表情。');
          }
        });
        editor.addEventListener('submit', event => {
          event.preventDefault();
          run('saveMedia', {
            id:item.id, tags:tags.input.value.trim(), description:description.input.value.trim()
          }, save, '表情设置已保存。');
        });
        buttons.append(save, remove);
        editor.append(tags.label, description.label, buttons);
        details.append(name, editor);
        li.append(details);
        list.append(li);
      }
    }

    function mediaField(title, value, maximumLength) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value ?? '';
      input.maxLength = maximumLength;
      label.append(title, input);
      return { label, input };
    }

    function safeQrLink(value) {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password &&
            ['weixin.qq.com','wechat.com'].some(domain =>
              url.hostname === domain || url.hostname.endsWith('.' + domain)
            )) return url.href;
      } catch {}
      return '';
    }

    function applyStatus(status, replaceSettings = false) {
      if (!initialized || replaceSettings) fillSettings(status.settings);
      renderMedia(status.media);
      const key = status.settings?.groupEnabled && /^[a-f0-9]{64}$/i.test(status.groupKey ?? '') ? status.groupKey : '';
      get('group-config').hidden = !key;
      const groupInput = get('group-key');
      if (groupInput.value !== key) {
        groupInput.value = key;
        groupInput.type = 'password';
        get('show-group-key').textContent = '显示';
        get('group-key-message').textContent = '';
      }
      const connection = status.connection || 'disconnected';
      connectionBadge.dataset.state = connection;
      const label = labels[connection] || '微信未连接';
      if (connectionBadge.textContent !== label) connectionBadge.textContent = label;
      const linked = connection === 'connected' || connection === 'claim';
      get('login').hidden = linked || connection === 'pairing';
      get('login').textContent = connection === 'expired' ? '重新生成二维码' : '连接微信';
      get('logout').hidden = !linked && connection !== 'pairing';
      get('logout').textContent = connection === 'pairing' ? '取消扫码' : '断开连接';
      get('setup-steps').hidden = linked;
      display('connection-message', status.message);
      display('last-error', status.lastError);
      const qr = get('qr');
      const link = get('qr-link');
      const image = /^data:image\/(?:png|svg\+xml);base64,[a-z0-9+/=]+$/i.test(status.qrImage ?? '') ? status.qrImage : '';
      const href = safeQrLink(status.qrUrl);
      if (image && qr.getAttribute('src') !== image) qr.src = image;
      if (!image && qr.hasAttribute('src')) qr.removeAttribute('src');
      if (href) link.href = href;
      else link.removeAttribute('href');
      qr.hidden = !image;
      link.hidden = !href;
      get('pair').hidden = !image && !href;
      get('pin-form').hidden = !status.pinRequired;
      get('claim').hidden = !status.claimCode;
      get('claim-code').textContent = status.claimCode ? '/claim ' + status.claimCode : '';
      get('sessions').hidden = !status.chatId && !status.workId;
      get('chat-session').hidden = !status.chatId;
      get('work-session').hidden = !status.workId;
      get('chat-id').textContent = status.chatId || '';
      get('work-id').textContent = status.workId || '';
    }

    async function refresh() {
      if (polling || busy) return;
      const requestRevision = revision;
      polling = true;
      try {
        const status = await action('status');
        if (requestRevision === revision) applyStatus(status);
      } catch {
        if (requestRevision !== revision) return;
        const label = '本机服务暂不可用';
        if (connectionBadge.textContent !== label) {
          connectionBadge.dataset.state = 'error';
          connectionBadge.textContent = label;
        }
      } finally {
        polling = false;
      }
    }

    function report(message, error = false) {
      const feedback = get('feedback');
      feedback.className = error ? 'notice error' : '';
      feedback.textContent = message;
      if (error) feedback.scrollIntoView({ block:'nearest' });
    }

    async function run(name, data, button, success) {
      if (busy) return false;
      ++revision;
      busy = true;
      button.disabled = true;
      const oldLabel = button.textContent;
      button.textContent = '处理中…';
      report('');
      try {
        const status = await action(name, data);
        button.textContent = oldLabel;
        applyStatus(status, name === 'save');
        report(success ?? '');
        return true;
      } catch (error) {
        button.textContent = oldLabel;
        report(error.message, true);
        return false;
      } finally {
        button.disabled = false;
        busy = false;
        get('save').disabled = !initialized;
        refresh();
      }
    }

    async function listDiary(event) {
      const button = event.currentTarget;
      button.disabled = true;
      display('diary-status', '读取日记…');
      try {
        const data = await action('listDiary');
        const list = get('diary-list');
        const entries = Array.isArray(data.entries) ? data.entries : [];
        list.replaceChildren();
        for (const entry of entries) {
          const detail = document.createElement('details');
          const date = document.createElement('summary');
          const text = document.createElement('p');
          date.textContent = entry.date;
          text.textContent = entry.text;
          detail.append(date, text);
          list.append(detail);
        }
        list.hidden = entries.length === 0;
        display('diary-status', entries.length === 0 ? '还没有日记。' : '');
      } catch (error) {
        display('diary-status', error.message);
      } finally {
        button.disabled = false;
      }
    }

    async function loadVoices() {
      try {
        const data = await action('voices');
        if (!Array.isArray(data.voices)) return;
        const list = get('voices-list');
        for (const voice of data.voices) {
          const item = document.createElement('option');
          item.value = voice;
          list.append(item);
        }
      } catch {
        // The voice name can still be entered manually.
      }
    }

    get('login').addEventListener('click', event => run('login', {}, event.currentTarget));
    get('logout').addEventListener('click', event => {
      const pairing = connectionBadge.dataset.state === 'pairing';
      if (pairing || window.confirm('断开微信？重新连接后才能继续通过微信收发消息。')) {
        run('logout', {}, event.currentTarget);
      }
    });
    get('pin-form').addEventListener('submit', async event => {
      event.preventDefault();
      const pin = get('pin');
      if (await run('pin',{ code:pin.value.trim() },event.submitter)) pin.value = '';
    });
    get('test-form').addEventListener('submit', event => {
      event.preventDefault();
      run('testChat',{ text:get('test-text').value.trim() },event.submitter,'请到 DSH 查看测试对话。');
    });
    get('test-work').addEventListener('click', event => {
      run('testWork', {}, event.currentTarget, '请到 DSH 查看工作测试及权限。');
    });
    form.elements.workEnabled.addEventListener('change', updateFieldRequirements);
    form.elements.diaryEnabled.addEventListener('change', updateFieldRequirements);
    form.elements.groupEnabled.addEventListener('change', updateFieldRequirements);
    get('group-endpoint').textContent = location.origin + '/api/group/reply';
    get('show-group-key').addEventListener('click', event => {
      const input = get('group-key');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      event.currentTarget.textContent = show ? '隐藏' : '显示';
    });
    get('copy-group-key').addEventListener('click', async () => {
      const input = get('group-key');
      const message = get('group-key-message');
      if (!input.value) return;
      try {
        await navigator.clipboard.writeText(input.value);
        message.textContent = '已复制凭证。';
      } catch {
        input.type = 'text';
        get('show-group-key').textContent = '隐藏';
        input.focus();
        input.select();
        message.textContent = '按 ⌘C 复制选中的凭证。';
      }
    });
    get('read-diary').addEventListener('click', listDiary);
    get('write-diary').addEventListener('click', async event => {
      if (await run('writeDiary', {}, event.currentTarget)) {
        display('diary-status', '鲸屿正在准备日记。过一会儿可以点「查看日记」。');
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const settings = {};
      for (const field of textFields) {
        settings[field] = form.elements[field].value.trim();
      }
      for (const field of checkFields) {
        settings[field] = form.elements[field].checked;
      }
      settings.voiceEnabled = settings.voiceMode === 'always';
      run('save', settings, event.submitter, '设置已保存。');
    });
    get('upload-form').addEventListener('submit', event => {
      event.preventDefault();
      const file = get('media-file').files[0];
      if (!file || busy) return;
      if (file.size > 5 * 1024 * 1024) {
        report('这张图片超过 5 MB，请缩小后重试。',true);
        return;
      }
      const name = get('media-name').value.trim() || file.name.replace(/\.[^.]+$/, '');
      const tags = get('media-tags').value.trim();
      const description = get('media-description').value.trim();
      const reader = new FileReader();
      const button = event.submitter;
      reader.addEventListener('load', async () => {
        const base64 = String(reader.result).split(',')[1];
        if (await run('upload', { name, mime:file.type, base64, tags, description }, button, '已添加表情。')) {
          get('upload-form').reset();
        }
      });
      reader.addEventListener('error', () => report('读取图片失败，请重新选择。', true));
      reader.readAsDataURL(file);
    });
    refresh();
    loadVoices();
    setInterval(refresh, 2500);
  </script>
</body>
</html>`;
}
