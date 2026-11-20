import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { splitIlinkText } from './ilink.mjs'

const fileLimit = 20 * 1024 * 1024

export function withinWorkspace(candidate, base) {
  const rel = relative(base, candidate)
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}

export async function readWorkFile(workspace, requested) {
  if (!requested || isAbsolute(requested) || requested.includes('\0')) {
    throw new Error('请填写工作目录里的相对路径，例如 /file 报告/结果.pdf。')
  }
  const base = await realpath(workspace)
  const path = await realpath(resolve(base, requested)).catch(() => '')
  if (!path || !withinWorkspace(path, base)) throw new Error('工作目录内没有找到这个文件。')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || !stat.size || stat.size > fileLimit) {
      throw new Error('只能回传工作目录里非空且不超过 20 MB 的普通文件。')
    }
    const bytes = Buffer.alloc(stat.size)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== bytes.length || (await handle.stat()).size !== bytes.length) {
      throw new Error('文件正在变化，请等它写完后重新获取。')
    }
    return { bytes, name: basename(path) }
  } finally {
    await handle.close()
  }
}

export function workMessage(text, failed = false) {
  return (failed ? '鲸屿工作状态\n\n' : '鲸屿工作已完成\n\n') + text
}

export function deliveries(job) {
  const text = job.mode === 'work' ? workMessage(job.result, job.failed) : job.result
  if (job.mode === 'work' && text.length > 4200) {
    const preview = Array.from(text).slice(0, 850).join('')
    return [
      ...splitIlinkText(preview + '\n\n全文另附。').map(text => ({ text })),
      { bytes: Buffer.from(text, 'utf8'), name: '鲸屿-工作结果.md' },
    ]
  }
  return splitIlinkText(text).map(text => ({ text }))
}
