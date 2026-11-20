import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import QRCode from './vendor/QRCode/index.js'
import correction from './vendor/QRCode/QRErrorCorrectLevel.js'

const run = promisify(execFile)

export function makeQr(payload) {
  const qr = new QRCode(-1, correction.M)
  qr.addData(payload)
  qr.make()
  const width = qr.getModuleCount()
  const size = width + 8
  const cells = []
  for (let row = 0; row < width; row++) {
    for (let col = 0; col < width; col++) {
      if (qr.isDark(row, col)) cells.push(`M${col + 4},${row + 4}h1v1h-1z`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${cells.join('')}"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export async function listVoices() {
  const { stdout } = await run('/usr/bin/say', ['-v', '?'], { timeout: 8000 })
  return [...new Set(stdout.split('\n').map(line => line.match(/^(.+?)\s+[a-z]{2,3}_[A-Z]{2}\s+#/u)?.[1].trim()).filter(Boolean))]
}

export async function speak(text, voice, dataDir, signal) {
  const directory = await mkdtemp(join(dataDir, '.audio-'))
  try {
    const source = join(directory, 'reply.txt')
    const audio = join(directory, 'reply.aiff')
    const wave = join(directory, 'reply.wav')
    const spoken = Array.from(text).slice(0, 640).join('')
    await writeFile(source, spoken, { mode: 0o600 })
    await run('/usr/bin/say', ['-v', voice, '-f', source, '-o', audio], { signal, timeout: 90000 })
    await run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', audio, wave], { signal, timeout: 15000 })
    const bytes = await readFile(wave)
    const info = await run('/usr/bin/afinfo', [wave], { signal, timeout: 8000 })
    if (!/audio bytes: [1-9][0-9]*/u.test(info.stdout)) throw new Error('macOS 没有生成可播放的音频。')
    return bytes
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
