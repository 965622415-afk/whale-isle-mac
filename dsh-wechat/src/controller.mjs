import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createStorage, validateSettings, workspacePath } from './storage.mjs'
import { listVoices, makeQr, speak } from './media.mjs'
import { splitIlinkText } from './ilink.mjs'
import { deliveries, readWorkFile } from './delivery.mjs'
import { diaryClock, diaryPrompt } from './diary.mjs'

const help = [
  '直接发消息，和鲸屿聊天。',
  '说「帮我在电脑上检查项目启动失败的原因」，鲸屿会交给 Mac 上的 DSH。',
  '说「开始工作」切到工作模式，「结束工作」切回陪伴。也可以用 /work 加上任务。',
  '说「任务结果」取回最近一次工作结果，/file 报告.pdf 可取回工作目录里的文件。',
  '/voice 问题 · /sticker 文件名或标签 · /diary · /status',
].join('\n')
const maxJobs = 60

function report(error) {
  return error instanceof Error ? error.message : '出现未知错误。'
}

function qrLink(payload) {
  try {
    const url = new URL(payload)
    if (url.protocol === 'https:' && !url.username && !url.password
      && /(?:^|\.)(weixin\.qq\.com|wechat\.com)$/u.test(url.hostname)) return url.href
  } catch {}
  return undefined
}

function readMessage(message) {
  if (message?.message_type !== 1 || typeof message.from_user_id !== 'string' || !message.from_user_id
    || typeof message.context_token !== 'string' || !message.context_token || message.group_id) return null
  const text = (Array.isArray(message.item_list) ? message.item_list : []).map(item => {
    if (item?.type === 1) return item.text_item?.text
    if (item?.type === 3) return item.voice_item?.text
    return undefined
  }).filter(value => typeof value === 'string').join('\n')
  const unique = message.message_id || message.msg_id || message.svr_id || message.client_id
    || `${message.seq ?? ''}:${message.create_time_ms ?? ''}:${text}`
  const id = `jingyu-${createHash('sha256').update(`${message.from_user_id}:${unique}`).digest('hex').slice(0, 32)}`
  return { id, text, to: message.from_user_id, contextToken: message.context_token }
}

function modeFor(text, workMode) {
  if (/^聊天[:：]\s*\S/u.test(text)) return { mode: 'chat', text: text.replace(/^聊天[:：]\s*/u, '') }
  if (workMode || /^(?:帮我(?:在|用)(?:电脑|Mac|DSH)(?:上)?|请(?:在|用)(?:电脑|Mac|DSH)(?:上)?|让(?:电脑|Mac|DSH)|(?:新任务|工作任务)[：:\s])/iu.test(text)) {
    return { mode: 'work', text }
  }
  return { mode: 'chat', text }
}

function groupFault(status) {
  return Object.assign(new Error('群聊请求未完成。'), { status })
}

export function createController({ dataDir, ilink, connectDsh, makeStorage = createStorage, clock = () => new Date(), voiceMaker = speak, retryMs = 3000 }) {
  const store = makeStorage(dataDir)
  const groupRequests = new Map()
  const groupResults = new Map()
  const inFlightDiary = new Set()
  let connection = store.state.account ? 'connected' : 'disconnected'
  let message = store.state.account ? '已绑定。正在收取微信消息。' : '请用微信扫码连接鲸屿。'
  let lastError = ''
  let operation
  let pairing
  let diaryTimer
  let awakeProcess
  let stopped = false

  const dsh = connectDsh({ getSettings: () => store.state.settings, onReply, onFailure, onAttention, dataDir })

  async function status() {
    const sessions = await dsh.sessions()
    return {
      settings: store.state.settings,
      media: store.state.media,
      connection,
      message,
      lastError,
      qrUrl: pairing?.qrUrl,
      qrImage: pairing?.qrImage,
      pinRequired: Boolean(pairing?.pinRequired),
      claimCode: pairing?.claimCode,
      groupKey: store.state.settings.groupEnabled ? store.state.groupKey : undefined,
      chatId: sessions.find(entry => entry.mode === 'chat')?.id,
      workId: sessions.findLast(entry => entry.mode === 'work')?.id,
    }
  }

  function syncWakeLock() {
    const settings = store.state.settings
    const keep = !stopped && connection === 'connected' && settings.workEnabled && settings.stayAwake
      && process.platform === 'darwin'
    if (!keep) {
      awakeProcess?.kill()
      awakeProcess = undefined
    } else if (!awakeProcess) {
      const child = spawn('/usr/bin/caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' })
      awakeProcess = child
      child.unref()
      child.once('error', () => {
        if (awakeProcess === child) awakeProcess = undefined
        lastError = '无法启用通电时保持唤醒。可用 macOS 电池设置开启。'
      })
      child.once('exit', () => { if (awakeProcess === child) awakeProcess = undefined })
    }
  }

  function accountFor(credentials) {
    const account = store.state.account
    return account?.credentials.token === credentials.token ? account : undefined
  }

  function updateAccount(credentials, patch) {
    const account = accountFor(credentials)
    if (!account) return false
    store.update({ account: { ...account, ...patch } })
    return true
  }

  function getJob(id) {
    return store.state.account?.jobs?.find(job => job.id === id)
  }

  function updateJob(id, patch) {
    const account = store.state.account
    if (!account?.jobs?.some(job => job.id === id)) return
    updateAccount(account.credentials, { jobs: account.jobs.map(job => job.id === id ? { ...job, ...patch } : job) })
  }

  function jobRoute(account, job, signal) {
    return {
      id: job.id, credentials: account.credentials, to: account.credentials.ownerId,
      contextToken: account.contextToken || job.contextToken, signal,
    }
  }

  function stopOperation() {
    operation?.abort()
    operation = undefined
    pairing = undefined
  }

  function runOperation(task) {
    const current = new AbortController()
    operation = current
    void task(current.signal).catch(error => {
      if (current.signal.aborted || operation !== current) return
      lastError = report(error)
      message = '微信连接中断。'
      connection = error.code === 'AUTH_EXPIRED' ? 'expired' : 'disconnected'
      pairing = undefined
      current.abort()
      syncWakeLock()
    })
  }

  async function sendText(route, text, suffix = 'reply') {
    for (const [index, part] of splitIlinkText(text).entries()) {
      await ilink.sendText({ ...route, text: part, clientId: `${route.id}-${suffix}-${index}` })
    }
  }

  async function sendSticker(route, requested = '', context = '') {
    const items = store.state.media
    const matching = items.filter(entry => [entry.name, entry.description, ...String(entry.tags ?? '').split(/[,，\s]+/u)]
      .some(value => value && (requested ? value.toLowerCase() === requested.toLowerCase() : value.length >= 2 && context.includes(value))))
    const choices = requested || (context && matching.length) ? matching : items
    if (!choices.length) return false
    const item = choices[randomInt(choices.length)]
    await ilink.sendMedia({
      ...route, kind: 'image', name: item.name, bytes: store.readMedia(item.id), clientId: `${route.id}-image`,
    })
    return true
  }

  function addDiaryNote(role, text) {
    if (!store.state.settings.diaryEnabled) return
    const { day } = diaryClock(clock())
    const groups = store.state.diaryNotes
    const recent = Object.fromEntries(Object.entries(groups).sort().slice(-6))
    recent[day] = [...(groups[day] ?? []).slice(-23), { role, text: text.slice(0, 500) }]
    store.update({ diaryNotes: recent })
  }

  async function writeDiary(day = diaryClock(clock()).day) {
    if (store.state.diary[day] || inFlightDiary.has(day)) return
    const notes = store.state.diaryNotes[day] ?? []
    if (!notes.length) throw new Error('今天还没有可写进日记的私聊。')
    inFlightDiary.add(day)
    try {
      await dsh.submit({ id: `jingyu-diary-${day}`, text: diaryPrompt(notes, day), mode: 'diary' })
    } catch (error) {
      inFlightDiary.delete(day)
      throw error
    }
  }

  function checkDiary() {
    if (stopped || !store.state.settings.diaryEnabled) return
    const { day, time } = diaryClock(clock())
    if (time >= store.state.settings.diaryTime && store.state.diaryNotes[day]?.length) {
      void writeDiary(day).catch(error => { lastError = report(error) })
    }
  }

  function listDiary() {
    return Object.entries(store.state.diary).sort(([a], [b]) => b.localeCompare(a))
      .map(([date, text]) => ({ date, text }))
  }

  function settleGroup(id, text, error) {
    const pending = groupRequests.get(id)
    if (!pending) return false
    groupRequests.delete(id)
    if (error) {
      pending.reject(error)
    } else {
      groupResults.set(id, text)
      if (groupResults.size > 80) groupResults.delete(groupResults.keys().next().value)
      pending.resolve({ text })
    }
    return true
  }

  function settleDiary(id, text) {
    const day = /^jingyu-diary-(\d{4}-\d{2}-\d{2})$/u.exec(id)?.[1]
    if (!day) return false
    inFlightDiary.delete(day)
    if (text) {
      const diary = Object.fromEntries(Object.entries({ ...store.state.diary, [day]: text.slice(0, 8000) }).sort().slice(-120))
      store.update({ diary })
    } else {
      lastError = '这次日记没有生成。可以在电脑 DSH 查看「鲸屿 · 日记」的状态。'
    }
    return true
  }

  async function onReply({ id, text }) {
    if (stopped || settleGroup(id, text) || settleDiary(id, text)) return
    const job = getJob(id)
    if (!job) {
      if (id.startsWith('jingyu-test-')) message = 'DSH 已回复。请在 Mac 打开对应的鲸屿会话查看。'
      return
    }
    const result = typeof text === 'string' && text.trim() ? text.slice(0, 200000) : '这一轮已经结束，详情请在 Mac 上查看。'
    updateJob(id, { result, status: 'ready', index: 0, retryAt: 0 })
    if (job.mode === 'chat') addDiaryNote('assistant', result)
  }

  async function onFailure({ id }) {
    if (stopped || settleGroup(id, undefined, groupFault(503)) || settleDiary(id)) return
    if (!getJob(id)) {
      if (id.startsWith('jingyu-test-')) message = 'DSH 测试未完成。请查看桌面会话中的运行错误。'
      return
    }
    updateJob(id, { result: '这一轮未完成。请打开 Mac 上的鲸屿会话查看详情。', failed: true, status: 'ready', index: 0, retryAt: 0 })
  }

  async function onAttention({ id, mode, kind, noticeId }) {
    const account = store.state.account
    const job = getJob(id)
    const signal = operation?.signal
    if (!job || mode !== 'work' || !signal || signal.aborted) return
    const text = kind === 'approval'
      ? '这项工作正在等 DSH 审批。请在 Mac 的「鲸屿 · 工作」中确认，确认后结果会发回微信。'
      : '鲸屿有一个问题需要你回答。请在 Mac 的「鲸屿 · 工作」中查看。'
    const suffix = createHash('sha256').update(String(noticeId || kind)).digest('hex').slice(0, 10)
    await sendText(jobRoute(account, job, signal), text, `attention-${suffix}`).catch(error => {
      if (!signal.aborted) lastError = report(error)
    })
  }

  async function sendPart(route, part, index, tag = 'result') {
    const clientId = `${route.id}-${tag}-${index}`
    if ('text' in part) return ilink.sendText({ ...route, text: part.text, clientId })
    return ilink.sendMedia({ ...route, kind: 'file', bytes: part.bytes, name: part.name, clientId })
  }

  async function sendExtras(route, job) {
    if (route.signal.aborted || job.failed || job.mode !== 'chat') return
    try {
      if (job.voice) {
        const bytes = await voiceMaker(job.result, store.state.settings.voice, dataDir, route.signal)
        await ilink.sendMedia({ ...route, kind: 'file', bytes, name: '鲸屿的语音.wav', clientId: `${job.id}-voice` })
      }
    } catch {
      if (!route.signal.aborted) lastError = '文字已经发送。语音生成或发送失败，请在 Mac 检查音色。'
    }
    if (store.state.settings.autoSticker) {
      try {
        await sendSticker(route, '', job.result)
      } catch (error) {
        if (!route.signal.aborted) lastError = report(error)
      }
    }
  }

  async function deliverResults(credentials, signal) {
    while (!signal.aborted) {
      const account = accountFor(credentials)
      if (!account) return
      const job = account.jobs?.find(item => item.status === 'ready' && (item.retryAt ?? 0) <= Date.now())
      if (!job) {
        await delay(300, undefined, { signal })
        continue
      }
      const route = jobRoute(account, job, signal)
      try {
        const parts = deliveries(job)
        for (let index = job.index ?? 0; index < parts.length; index++) {
          await sendPart(route, parts[index], index)
          if (signal.aborted) return
          updateJob(job.id, { index: index + 1 })
        }
        updateJob(job.id, { status: 'sent', sentAt: Date.now(), failures: 0 })
        void sendExtras(route, job)
      } catch (error) {
        if (signal.aborted) return
        const failures = (job.failures ?? 0) + 1
        const retryAt = Date.now() + Math.min(retryMs * 2 ** Math.min(failures - 1, 8), 30 * 60000)
        lastError = '结果已保存，微信暂时未能接收。可以在微信发送「任务结果」重新获取。'
        updateJob(job.id, { failures, retryAt })
      }
    }
  }

  async function submitJob(job) {
    try {
      await dsh.submit({ id: job.id, text: job.text, mode: job.mode, cwd: job.cwd })
    } catch (error) {
      lastError = report(error)
      updateJob(job.id, { result: lastError, failed: true, status: 'ready' })
    }
  }

  async function showResult(route) {
    const job = accountFor(route.credentials)?.jobs?.findLast(item => item.mode === 'work')
    if (!job) return sendText(route, '还没有工作任务。')
    if (job.status === 'pending') return sendText(route, '最近的任务正在运行或等待 DSH 确认。完成后会发回微信。')
    if (job.status === 'ready') {
      updateJob(job.id, { retryAt: 0, failures: 0 })
      return sendText(route, '正在把保存的结果发回微信。')
    }
    for (const [index, part] of deliveries(job).entries()) await sendPart(route, part, index, 'retrieve')
  }

  async function dispatch(route) {
    const text = route.text.trim()
    if (!text) return sendText(route, '我可以接收文字和微信已转写的语音。')
    if (text.length > 12000) return sendText(route, '这条消息太长，请分开几条发送。')

    const account = accountFor(route.credentials)
    const settings = store.state.settings
    if (!account) return
    if (/^开始工作[。！!]?$/u.test(text)) {
      if (!settings.workEnabled) return sendText(route, '请先在 Mac 的鲸屿设置中选择项目文件夹，并开启远程工作。')
      updateAccount(route.credentials, { workMode: true })
      return sendText(route, '已进入工作模式。直接说任务即可。说「结束工作」切回陪伴。')
    }
    if (/^(?:结束工作|回到陪聊|切回陪聊)[。！!]?$/u.test(text)) {
      updateAccount(route.credentials, { workMode: false })
      return sendText(route, '已切回陪伴。已经提交的工作可以继续运行。')
    }
    if (/^(?:任务结果|工作结果|查看结果|\/result)[。！!]?$/iu.test(text)) return showResult(route)
    const match = /^\/(help|status|sticker|work|voice|claim|file|diary)(?=\s|$)\s*([\s\S]*)$/iu.exec(text)
    const command = match?.[1].toLowerCase()
    const argument = match?.[2].trim() || ''
    if (command === 'help') return sendText(route, help)
    if (command === 'status') return sendText(route, settings.workEnabled
      ? `鲸屿已连接，远程工作已开启。当前模式：${account.workMode ? '工作' : '陪伴'}。`
      : '鲸屿已连接，远程工作目前关闭。')
    if (command === 'claim') return sendText(route, '鲸屿已经绑定了这位微信用户。')
    if (command === 'diary') {
      const latest = listDiary()[0]
      return sendText(route, latest ? `${latest.date} · 鲸屿的日记\n\n${latest.text}` : '还没有写好的日记。')
    }
    if (command === 'sticker') {
      if (!await sendSticker(route, argument)) await sendText(route, '没有找到这张表情图。请先在 Mac 面板上传。')
      return
    }
    if (command === 'file') {
      if (!settings.workEnabled) return sendText(route, '请在 Mac 开启远程工作后再取文件。')
      try {
        await sendPart(route, await readWorkFile(settings.workspace, argument), 0, 'requested-file')
      } catch (error) {
        await sendText(route, report(error))
      }
      return
    }
    if ((command === 'work' || command === 'voice') && !argument) {
      return sendText(route, command === 'work' ? '请告诉我你想在电脑上做什么。' : '请在 /voice 后加上你想问的内容。')
    }
    if (command === 'voice' && settings.voiceMode === 'off') return sendText(route, '请先在 Mac 面板开启语音回复。')

    const selected = command === 'work' || command === 'voice'
      ? { mode: command === 'work' ? 'work' : 'chat', text: argument }
      : modeFor(text, account.workMode)
    let cwd
    if (selected.mode === 'work') {
      if (!settings.workEnabled) return sendText(route, '请先在 Mac 的鲸屿设置中选择项目文件夹，并开启远程工作。')
      try {
        cwd = await workspacePath(settings.workspace)
      } catch (error) {
        return sendText(route, report(error))
      }
    }
    route.signal.throwIfAborted()
    const current = accountFor(route.credentials)
    if (!current || getJob(route.id)) return
    const jobs = current.jobs ?? []
    if (jobs.filter(item => item.status === 'pending').length >= 12) {
      return sendText(route, '待处理消息较多，请稍后再发。')
    }
    const job = {
      ...selected, id: route.id, cwd, contextToken: route.contextToken, status: 'pending',
      voice: command === 'voice' || (selected.mode === 'chat' && settings.voiceMode === 'always'),
    }
    const retained = [...jobs]
    if (retained.length >= maxJobs) {
      const removable = retained.findIndex(item => item.status === 'sent')
      if (removable === -1) return sendText(route, '尚有太多结果等待回传。请检查 Mac 微信连接后再提交。')
      retained.splice(removable, 1)
    }
    updateAccount(route.credentials, { jobs: [...retained, job] })
    if (job.mode === 'chat') addDiaryNote('user', job.text)
    await submitJob(job)
    if (job.mode === 'work' && getJob(job.id)?.status === 'pending') {
      void sendText(route, '已交给 Mac 上的 DSH，完成后鲸屿会在这里回复。', 'queued').catch(() => {})
    }
  }

  async function receive(credentials, cursor, signal, pendingClaim) {
    let backoff = 1000
    let timeoutMs
    let catchingUp = false
    const enableResults = () => {
      if (catchingUp) return
      catchingUp = true
      for (const job of accountFor(credentials)?.jobs ?? []) {
        if (job.status === 'pending') void submitJob(job)
      }
      void deliverResults(credentials, signal).catch(error => {
        if (!signal.aborted) lastError = report(error)
      })
    }
    if (!pendingClaim) enableResults()
    while (!signal.aborted) {
      if (pendingClaim && Date.now() >= pendingClaim.deadline) {
        connection = 'disconnected'
        message = '配对码已过期，请重新扫码。'
        pairing = undefined
        return
      }
      let batch
      try {
        batch = await ilink.getUpdates({ credentials, cursor, timeoutMs, signal })
      } catch (error) {
        if (signal.aborted) return
        if (error.code === 'AUTH_EXPIRED') throw error
        lastError = report(error)
        await delay(backoff, undefined, { signal })
        backoff = Math.min(backoff * 2, 30000)
        continue
      }
      backoff = 1000
      timeoutMs = batch.timeoutMs
      for (const raw of batch.messages) {
        signal.throwIfAborted()
        const incoming = readMessage(raw)
        if (!incoming || incoming.to !== credentials.ownerId) continue
        const route = { ...incoming, credentials, signal }
        if (pendingClaim) {
          if (Date.now() < pendingClaim.deadline && incoming.text.trim() === `/claim ${pendingClaim.code}`) {
            const previous = store.state.account
            const sameOwner = previous?.credentials.ownerId === credentials.ownerId
            const retained = sameOwner ? (previous.jobs ?? []).map(job => ({ ...job, retryAt: 0 })) : []
            store.update({
              account: { credentials, cursor, seen: [incoming.id], jobs: retained, contextToken: incoming.contextToken, workMode: false },
              ...(sameOwner ? {} : { diaryNotes: {}, diary: {} }),
            })
            pendingClaim = undefined
            pairing = undefined
            connection = 'connected'
            syncWakeLock()
            message = '已绑定。你可以在微信给鲸屿发消息。'
            enableResults()
            await sendText(route, '鲸屿已连上你的 Mac。发「你好」开始聊天，发 /help 查看工作和语音等用法。')
              .catch(error => { if (!signal.aborted) lastError = report(error) })
          }
          continue
        }
        const account = accountFor(credentials)
        if (!account) return
        if ((account.seen ?? []).includes(incoming.id)) continue
        updateAccount(credentials, { contextToken: incoming.contextToken })
        await dispatch(route).catch(error => { if (!signal.aborted) lastError = report(error) })
        if (signal.aborted) return
        const seen = accountFor(credentials)?.seen ?? []
        updateAccount(credentials, { seen: [...seen.slice(-255), incoming.id] })
      }
      signal.throwIfAborted()
      if (!pendingClaim && cursor !== batch.cursor) updateAccount(credentials, { cursor: batch.cursor })
      if (!batch.messages.length && cursor === batch.cursor) await delay(150, undefined, { signal })
      cursor = batch.cursor
    }
  }

  async function pair(signal) {
    const login = await ilink.startLogin({ signal })
    signal.throwIfAborted()
    pairing = { qrUrl: qrLink(login.qrContent), qrImage: makeQr(login.qrContent) }
    message = '打开手机微信扫一扫，确认连接。'
    const deadline = Date.now() + 300000
    let baseUrl = login.baseUrl
    while (Date.now() < deadline) {
      const verifyCode = pairing.verifyCode
      if (pairing.pinRequired && !verifyCode) {
        await delay(250, undefined, { signal })
        continue
      }
      delete pairing.verifyCode
      const result = await ilink.pollLogin({ qrcode: login.qrcode, baseUrl, verifyCode, signal })
      signal.throwIfAborted()
      baseUrl = result.baseUrl || baseUrl
      pairing.pinRequired = result.status === 'need_verifycode'
      if (result.status === 'confirmed') {
        pairing = { claimCode: String(randomInt(100000, 1000000)) }
        connection = 'claim'
        message = '扫码成功。在微信机器人聊天里发送下方绑定指令。'
        return receive(result.credentials, '', signal, { code: pairing.claimCode, deadline: Date.now() + 600000 })
      }
      if (['expired', 'verify_code_blocked', 'binded_redirect'].includes(result.status)) break
      if (pairing.pinRequired) message = '请在电脑面板填写手机微信显示的验证码。'
      await delay(500, undefined, { signal })
    }
    connection = 'disconnected'
    message = '二维码已失效，请重新生成。'
    pairing = undefined
  }

  async function groupReply(data, authorization) {
    if (stopped || !store.state.settings.groupEnabled) throw groupFault(403)
    const token = typeof authorization === 'string' ? /^Bearer ([a-f\d]{64})$/iu.exec(authorization)?.[1] : undefined
    if (!token || !store.state.groupKey || !timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(store.state.groupKey, 'hex'))) {
      throw groupFault(401)
    }
    const { id, groupId, groupName, text } = data ?? {}
    if (typeof groupId !== 'string' || !store.state.settings.groupIds.split('\n').includes(groupId)) throw groupFault(403)
    if (typeof id !== 'string' || !/^astrbot-[a-f\d]{64}$/u.test(id)
      || typeof text !== 'string' || !text.trim() || text.length > 8000) throw groupFault(403)
    const key = `jingyu-group-${createHash('sha256').update(`${groupId}\0${id}`).digest('hex')}`
    if (groupResults.has(key)) return { text: groupResults.get(key) }
    const existing = groupRequests.get(key)
    if (existing) return existing.promise
    if (groupRequests.size >= 12) throw groupFault(409)

    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    groupRequests.set(key, { resolve, reject, promise })
    const timer = setTimeout(() => settleGroup(key, undefined, groupFault(503)), 84000)
    timer.unref()
    void dsh.submit({ id: key, text, mode: 'group', groupId, groupName })
      .catch(() => settleGroup(key, undefined, groupFault(503)))
    return promise.finally(() => clearTimeout(timer))
  }

  function start() {
    const account = store.state.account
    if (account) runOperation(signal => receive(account.credentials, account.cursor, signal))
    syncWakeLock()
    diaryTimer = setInterval(checkDiary, 45000)
    diaryTimer.unref()
  }

  async function action(name, data = {}) {
    if (stopped) throw new Error('鲸屿正在关闭。')
    switch (name) {
      case 'status': break
      case 'save': {
        const settings = await validateSettings(data, store.state.settings)
        store.update({ settings, ...(settings.groupEnabled && !store.state.groupKey ? { groupKey: randomBytes(32).toString('hex') } : {}) })
        if (!settings.workEnabled && store.state.account?.workMode) updateAccount(store.state.account.credentials, { workMode: false })
        syncWakeLock()
        break
      }
      case 'upload': store.upload(data); break
      case 'saveMedia': store.saveMedia(data); break
      case 'deleteMedia': store.deleteMedia(data.id); break
      case 'listDiary': return { entries: listDiary() }
      case 'writeDiary': await writeDiary(); break
      case 'voices': return { voices: await listVoices() }
      case 'login':
        if (connection === 'connected') throw new Error('微信已经连接。要重新绑定，请先断开当前连接。')
        stopOperation()
        lastError = ''
        connection = 'pairing'
        syncWakeLock()
        message = '正在向微信申请二维码……'
        runOperation(pair)
        break
      case 'pin':
        if (!pairing?.pinRequired || typeof data.code !== 'string' || !/^\d{1,16}$/u.test(data.code)) {
          throw new Error('请输入微信当前显示的数字验证码。')
        }
        pairing.verifyCode = data.code
        break
      case 'logout':
        stopOperation()
        store.update({ account: null })
        lastError = ''
        connection = 'disconnected'
        syncWakeLock()
        message = '已断开连接，可以重新扫码。原来的任务仍在 DSH 会话中。'
        break
      case 'testWork': {
        const settings = store.state.settings
        if (!settings.workEnabled) throw new Error('请先保存工作目录并开启远程工作。')
        const cwd = await workspacePath(settings.workspace)
        message = '只读工作测试已提交，请到 DSH 的「鲸屿 · 工作」查看。'
        await dsh.submit({
          id: `jingyu-test-work-${randomUUID()}`, mode: 'work', cwd,
          text: '只做连通性测试：查看当前工作目录，列出最多五个文件或文件夹的名称。不要读取文件内容，不要修改文件，不要联网。',
        })
        break
      }
      case 'testChat': {
        const text = typeof data.text === 'string' ? data.text.trim() : ''
        if (!text || text.length > 12000) throw new Error('请输入要发给鲸屿的测试消息。')
        message = '已提交。打开 DSH 的「鲸屿 · 陪伴」查看对话。'
        await dsh.submit({ id: `jingyu-test-${randomUUID()}`, text, mode: 'chat' })
        break
      }
      default: throw new Error('鲸屿不支持这项操作。')
    }
    return status()
  }

  async function close() {
    if (stopped) return
    stopped = true
    clearInterval(diaryTimer)
    syncWakeLock()
    stopOperation()
    for (const id of groupRequests.keys()) settleGroup(id, undefined, groupFault(503))
    await dsh.close()
  }

  return { start, action, groupReply, close }
}
