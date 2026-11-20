import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createController } from '../src/controller.mjs'
import { createStorage } from '../src/storage.mjs'
import { deliveries, readWorkFile } from '../src/delivery.mjs'

const credentials = { ownerId: 'owner', token: 'test-key', botId: 'bot', baseUrl: 'https://ilinkai.weixin.qq.com' }
const storedAccount = { credentials, cursor: 'start', seen: [], jobs: [], contextToken: 'old' }
const message = (id, text, from = 'owner', token = 'fresh') => ({
  message_id: id, message_type: 1, from_user_id: from, context_token: token, item_list: [{ type: 1, text_item: { text } }],
})

async function until(check) {
  for (let attempt = 0; attempt < 160; attempt++) {
    const found = check()
    if (found) return found
    await delay(20)
  }
  assert.fail('Expected relay event was not received')
}

async function testRuntime(t, { connected = true, start = true, reject = () => false, preloaded = [], date = new Date('2026-11-20T12:00:00Z') } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'jingyu-test-'))
  const workspace = join(dataDir, 'project')
  await mkdir(workspace)
  const store = createStorage(dataDir)
  store.update({ ...(connected ? { account: { ...storedAccount, jobs: preloaded } } : {}) })
  const inbound = []
  const outbound = []
  const requests = []
  const transports = []
  const syntheses = []
  let callbacks
  const controller = createController({
    dataDir,
    makeStorage: () => store,
    clock: () => date,
    retryMs: 20,
    async voiceMaker() { return Buffer.from('mock voice') },
    async apiVoiceMaker(options) {
      syntheses.push(options)
      return { bytes: Buffer.from('mock api voice'), filename: '语音.wav' }
    },
    ilink: {
      async startLogin() {
        return { qrContent: 'https://weixin.qq.com/jingyu-test', qrcode: '123', baseUrl: credentials.baseUrl }
      },
      async pollLogin() { return { status: 'confirmed', credentials } },
      async getUpdates({ cursor, signal }) {
        transports.push(cursor)
        await delay(8, undefined, { signal })
        return inbound.length ? { messages: inbound.splice(0), cursor: cursor + '1' } : { messages: [], cursor }
      },
      async sendText(options) {
        const bad = reject(options)
        outbound.push({ ...options, bad })
        if (bad) throw new Error('Test send failed')
      },
      async sendMedia(options) { outbound.push(options) },
    },
    connectDsh(options) {
      callbacks = options
      return {
        async submit(request) { requests.push(request) },
        async sessions() { return [] },
        async close() {},
      }
    },
  })
  t.after(async () => {
    await controller.close()
    await rm(dataDir, { recursive: true, force: true })
  })
  if (start) controller.start()
  return { controller, store, workspace, inbound, outbound, requests, callbacks, transports, syntheses }
}

test('only the bound owner can submit; everyday and ordinary-language work use native mode routes', async t => {
  const { controller, store, workspace, inbound, outbound, requests, callbacks } = await testRuntime(t)
  await controller.action('save', { workspace, workEnabled: true })
  inbound.push(null, message('1', '帮我在电脑上删除资料', 'stranger'), message('2', '早呀'))
  const chat = await until(() => requests[0])
  assert.deepEqual([chat.mode, chat.text], ['chat', '早呀'])
  await callbacks.onReply({ id: chat.id, text: '早！' })
  await until(() => outbound.find(item => item.text === '早！'))
  inbound.push(message('3', '帮我在电脑上检查启动问题'), message('3', '帮我在电脑上检查启动问题'))
  const work = await until(() => requests[1])
  assert.deepEqual([work.mode, work.text, work.cwd], ['work', '帮我在电脑上检查启动问题', await realpath(workspace)])
  assert.equal(requests.length, 2)
  await callbacks.onAttention({ id: work.id, mode: 'work', kind: 'approval', noticeId: 'notice' })
  assert.ok(outbound.some(item => item.text?.includes('正在等 DSH 审批')))
  await callbacks.onReply({ id: work.id, text: '测试通过。' })
  const final = await until(() => outbound.find(item => item.text?.includes('测试通过。')))
  assert.equal(final.contextToken, 'fresh')
  await until(() => store.state.account.jobs.find(job => job.id === work.id && job.status === 'sent'))
})

test('starts or ends work mode by message without /dsh', async t => {
  const { controller, workspace, inbound, requests } = await testRuntime(t)
  await controller.action('save', { workspace, workEnabled: true })
  inbound.push(message('switch-on', '开始工作'), message('task', '看看那个文档'),
    message('switch-off', '结束工作'), message('chat', '今天好冷'))
  await until(() => requests.length === 2)
  assert.deepEqual(requests.map(item => item.mode), ['work', 'chat'])
})

test('saves a failed delivery until the owner supplies a fresh reply token', async t => {
  const { controller, store, workspace, inbound, outbound, requests, callbacks } = await testRuntime(t, {
    reject: item => item.text?.includes('结果：已完成') && item.contextToken === 'expired-context',
  })
  await controller.action('save', { workspace, workEnabled: true })
  inbound.push(message('assign', '新任务 列出文件', 'owner', 'expired-context'))
  const work = await until(() => requests[0])
  await callbacks.onReply({ id: work.id, text: '结果：已完成' })
  await until(() => outbound.find(item => item.bad))
  assert.equal(store.state.account.jobs[0].status, 'ready')
  inbound.push(message('retry', '任务结果', 'owner', 'fresh'))
  await until(() => outbound.find(item => !item.bad && item.text?.includes('结果：已完成')))
  assert.equal(requests.length, 1)
})

test('resumes a pending request and sends saved results after bridge restart', async t => {
  const { inbound, outbound, requests, callbacks } = await testRuntime(t, {
    preloaded: [
      { id: 'remembered', mode: 'chat', status: 'pending', text: '已提交的聊天' },
      { id: 'finished', mode: 'work', status: 'ready', index: 0, result: '已经保存' },
    ],
  })
  const previous = await until(() => requests[0])
  assert.equal(previous.id, 'remembered')
  await until(() => outbound.find(item => item.text?.includes('已经保存')))
  await callbacks.onReply({ id: previous.id, text: '重启后继续回复' })
  await until(() => outbound.find(item => item.text === '重启后继续回复'))
  assert.equal(inbound.length, 0)
})

test('official scanner identity and explicit local pair code are both required', async t => {
  const { controller, inbound } = await testRuntime(t, { connected: false })
  await controller.action('login')
  let status
  for (let i = 0; i < 40; i++) {
    status = await controller.action('status')
    if (status.claimCode) break
    await delay(20)
  }
  assert.equal(status.connection, 'claim')
  inbound.push(message('attempt-1', '/claim ' + status.claimCode, 'stranger'))
  await delay(200)
  assert.equal((await controller.action('status')).connection, 'claim')
  inbound.push(message('attempt-2', '/claim ' + status.claimCode))
  await delay(300)
  assert.equal((await controller.action('status')).connection, 'connected')
})

test('groups require their scoped key and ID; calls with work wording stay group conversations', async t => {
  const { controller, callbacks, requests } = await testRuntime(t, { start: false })
  const status = await controller.action('save', { groupEnabled: true, groupIds: 'group-2' })
  const input = { id: 'astrbot-' + 'a'.repeat(64), groupId: 'group-2', groupName: '练习群', text: '/work 帮忙' }
  await assert.rejects(controller.groupReply(input, 'Bearer ' + '0'.repeat(64)), { status: 401 })
  const header = 'Bearer ' + status.groupKey
  await assert.rejects(controller.groupReply({ ...input, groupId: 'other-group' }, header), { status: 403 })
  const reply = controller.groupReply(input, header)
  const accepted = await until(() => requests[0])
  assert.equal(accepted.mode, 'group')
  await callbacks.onReply({ id: accepted.id, text: '群里可以陪聊' })
  assert.deepEqual(await reply, { text: '群里可以陪聊' })
  assert.deepEqual(await controller.groupReply(input, header), { text: '群里可以陪聊' })
  assert.equal(requests.length, 1)
})

test('diary uses only enabled private conversation notes and stays in its own DSH turn', async t => {
  const { controller, inbound, requests, callbacks } = await testRuntime(t)
  await controller.action('save', { diaryEnabled: true })
  inbound.push(message('today', '我今天很开心'))
  const chat = await until(() => requests[0])
  await callbacks.onReply({ id: chat.id, text: '跟我说说开心的事吧' })
  await controller.action('writeDiary')
  const diary = await until(() => requests[1])
  assert.equal(diary.mode, 'diary')
  assert.match(diary.text, /我今天很开心/)
  await callbacks.onReply({ id: diary.id, text: '今天她说她很开心。' })
  assert.deepEqual((await controller.action('listDiary')).entries, [{ date: '2026-11-20', text: '今天她说她很开心。' }])
})

test('long work reply is sent as readable report and explicit file retrieval stays in workspace', async t => {
  const parts = deliveries({ mode: 'work', result: '详细结果。'.repeat(3000) })
  assert.equal(parts.length, 2)
  assert.ok(parts[1].bytes.toString().includes('详细结果。'))
  const { workspace } = await testRuntime(t, { start: false })
  await writeFile(join(workspace, '报告.txt'), '内容')
  await writeFile(join(workspace, '..', '其他.txt'), '不外发')
  assert.equal((await readWorkFile(workspace, '报告.txt')).bytes.toString(), '内容')
  await assert.rejects(readWorkFile(workspace, '../其他.txt'))
})

test('remote voice credentials are private, bound to an endpoint, and used by optional WeChat audio', async t => {
  const { controller, inbound, outbound, requests, callbacks, syntheses } = await testRuntime(t)
  const settings = {
    voiceProvider: 'custom', voiceEndpoint: 'https://audio.example/v1',
    voiceMode: 'always', voiceModel: 'sample-model', voiceId: 'sample-voice',
  }
  const saved = await controller.action('saveVoice', { settings, apiKey: 'synthetic-test-key' })
  assert.equal(saved.voiceKeyConfigured, true)
  assert.ok(!JSON.stringify(saved).includes('synthetic-test-key'))
  const audio = await controller.action('previewVoice', { settings, text: '本机试听' })
  assert.equal(Buffer.from(audio.audio, 'base64').toString(), 'mock api voice')
  assert.equal(syntheses[0].apiKey, 'synthetic-test-key')
  await controller.action('previewVoice', { settings: { ...settings, voiceEndpoint: 'https://different.example/v1' }, text: '检查范围' })
  assert.equal(syntheses[1].apiKey, '')
  inbound.push(message('voice', '晚上好'))
  const chat = await until(() => requests[0])
  await callbacks.onReply({ id: chat.id, text: '晚上好，今天怎么样？' })
  await until(() => outbound.some(item => item.kind === 'file' && item.name === '语音.wav'))
  assert.equal(syntheses[2].apiKey, 'synthetic-test-key')
  assert.equal((await controller.action('saveVoice', { settings, clearKey: true })).voiceKeyConfigured, false)
})

test('a normal reply sends only text unless the companion picks a sticker from its library', async t => {
  const { controller, store, inbound, outbound, requests, callbacks } = await testRuntime(t)
  await controller.action('save', { autoSticker: true })
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')
  const status = await controller.action('upload', { base64: png, mime: 'image/png', name: '开心.png' })
  const sticker = status.media[0]
  assert.deepEqual(callbacks.getStickers(), [sticker])
  inbound.push(message('plain', '今天又下雨了'))
  const plain = await until(() => requests[0])
  await callbacks.onReply({ id: plain.id, text: '记得带伞。' })
  await until(() => store.state.account.jobs.some(job => job.id === plain.id && job.status === 'sent'))
  assert.equal(outbound.some(item => item.kind === 'image'), false)
  inbound.push(message('decided', '今天通过考试了'))
  const decided = await until(() => requests[1])
  await callbacks.onReply({ id: decided.id, text: '恭喜！', stickerId: sticker.id })
  assert.equal((await until(() => outbound.find(item => item.kind === 'image'))).name, '开心.png')
})
