import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'

export const defaultSettings = Object.freeze({
  name: '鲸屿',
  personality: '你是一位生活在海岛上的 AI 陪伴。说中文，语气温暖自然，有一点幽默。先认真听我说，再回应；表达亲近时尊重彼此的界限。',
  ownerName: '你',
  aliases: '鲸鱼娘',
  background: '',
  memory: '',
  publicMemory: '',
  workEnabled: false,
  stayAwake: false,
  workspace: '',
  voiceMode: 'on-request',
  diaryEnabled: false,
  diaryTime: '21:30',
  groupEnabled: false,
  groupIds: '',
  voice: 'Tingting',
  autoSticker: false,
})

export function defaultDataDir() {
  return resolve(process.env.JINGYU_STATE_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'jingyu'))
}

export async function workspacePath(input) {
  const candidate = input === '~' || input.startsWith('~/')
    ? join(homedir(), input.slice(2))
    : input
  if (!isAbsolute(candidate)) throw new Error('请填写 Mac 文件夹的完整路径。')
  const path = await realpath(candidate).catch(() => '')
  if (!path || !(await stat(path)).isDirectory()) throw new Error('找不到该项目文件夹。')
  return path
}

export async function validateSettings(data, previous) {
  const settings = { ...previous }
  for (const [key, max] of Object.entries({ name: 48, ownerName: 48, aliases: 300, personality: 8000, background: 8000, memory: 16000, publicMemory: 8000, workspace: 4096, voice: 128, diaryTime: 5, groupIds: 4096 })) {
    if (!Object.hasOwn(data, key)) continue
    if (typeof data[key] !== 'string' || data[key].length > max || data[key].includes('\0')) {
      throw new Error(`「${key}」的内容格式不正确或太长。`)
    }
    settings[key] = data[key].trim()
  }
  for (const key of ['workEnabled', 'stayAwake', 'diaryEnabled', 'groupEnabled', 'autoSticker']) {
    if (Object.hasOwn(data, key)) {
      if (typeof data[key] !== 'boolean') throw new Error('设置格式不正确。')
      settings[key] = data[key]
    }
  }
  settings.name ||= defaultSettings.name
  settings.voice ||= defaultSettings.voice
  if (/^[\s-]/u.test(settings.voice) || /[\r\n]/u.test(settings.voice)) throw new Error('请选择系统提供的声音。')
  if (Object.hasOwn(data, 'voiceMode')) {
    if (!['off', 'on-request', 'always'].includes(data.voiceMode)) throw new Error('请选择语音回复方式。')
    settings.voiceMode = data.voiceMode
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(settings.diaryTime)) throw new Error('日记时间请用 24 小时制。')
  const groupIds = [...new Set(settings.groupIds.split(/\r?\n/u).map(id => id.trim()).filter(Boolean))]
  if (groupIds.length > 30 || groupIds.some(id => !/^[a-zA-Z0-9_.:@-]{1,160}$/u.test(id))) {
    throw new Error('请每行填写一个有效的群 ID，最多 30 个。')
  }
  if (settings.groupEnabled && !groupIds.length) throw new Error('请先填写至少一个允许陪聊的群 ID。')
  settings.groupIds = groupIds.join('\n')
  if (settings.workEnabled) settings.workspace = await workspacePath(settings.workspace)
  return settings
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const maxImageBytes = 5 * 1024 * 1024

function readImage({ name, mime, base64 }) {
  if (typeof name !== 'string' || typeof base64 !== 'string' || base64.length > Math.ceil(maxImageBytes / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) throw new Error('图片太大或读取失败。')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > maxImageBytes) throw new Error('图片大小上限是 5 MB。')
  const valid = (mime === 'image/png' && bytes.subarray(0, 8).equals(png))
    || (mime === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    || (mime === 'image/gif' && /^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString('ascii')))
    || (mime === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
  if (!valid) throw new Error('请选择小于 5 MB 的 PNG、JPEG、GIF 或 WebP 图片。')
  return { name: basename(name).replace(/[\r\n\0]/gu, '').slice(0, 96) || '表情包', bytes }
}

export function createStorage(dataDir) {
  const directory = join(dataDir, 'stickers')
  const file = join(dataDir, 'settings.json')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(dataDir, 0o700)
  const defaults = { settings: { ...defaultSettings }, media: [], account: null, diary: {}, diaryNotes: {}, groupKey: null }
  let state
  try {
    state = { ...defaults, ...JSON.parse(readFileSync(file, 'utf8')) }
    const oldVoice = state.settings?.voiceEnabled === true && !state.settings.voiceMode
    state.settings = { ...defaultSettings, ...state.settings, ...(oldVoice ? { voiceMode: 'always' } : {}) }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('鲸屿设置文件无法读取，请检查本机数据目录。', { cause: error })
    state = defaults
  }

  function update(patch) {
    const next = { ...state, ...patch }
    const temp = join(dataDir, `.settings-${randomUUID()}.tmp`)
    try {
      writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      renameSync(temp, file)
    } finally {
      rmSync(temp, { force: true })
    }
    state = next
  }

  function mediaDetails(data) {
    const description = typeof data.description === 'string' ? data.description.trim() : ''
    const tags = typeof data.tags === 'string' ? data.tags.trim() : ''
    if (description.length > 160 || tags.length > 300) throw new Error('表情描述或标签太长。')
    return { description, tags }
  }

  return {
    get state() { return state },
    update,
    saveMedia(data) {
      if (!state.media.some(item => item.id === data.id)) throw new Error('这张表情包已经不存在。')
      const details = mediaDetails(data)
      update({ media: state.media.map(item => item.id === data.id ? { ...item, ...details } : item) })
    },
    upload(input) {
      if (state.media.length >= 40) throw new Error('已存满 40 张表情包，可以先删除一张。')
      const { name, bytes } = readImage(input)
      const details = mediaDetails(input)
      const id = randomUUID()
      const asset = join(directory, id)
      writeFileSync(asset, bytes, { mode: 0o600, flag: 'wx' })
      try {
        update({ media: [...state.media, { id, name, ...details }] })
      } catch (error) {
        rmSync(asset, { force: true })
        throw error
      }
    },
    deleteMedia(id) {
      if (!state.media.some(item => item.id === id)) throw new Error('这张表情包已经不存在。')
      update({ media: state.media.filter(item => item.id !== id) })
      rmSync(join(directory, id), { force: true })
    },
    readMedia(id) {
      if (!state.media.some(item => item.id === id)) throw new Error('这张表情包已经不存在。')
      return readFileSync(join(directory, id))
    },
  }
}
