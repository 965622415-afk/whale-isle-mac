export const remoteVoiceProviders = Object.freeze({
  breezeblue: Object.freeze({
    name: 'BreezeBlue',
    endpoint: 'https://api.breeze.blue/v1/text-to-speech',
    model: 'breeze-tts-2',
    voice: 'voc_u3nxkd5578wc',
    requiresKey: true,
  }),
  minimax: Object.freeze({
    name: 'MiniMax',
    endpoint: 'https://api.minimaxi.com/v1/t2a_v2',
    model: 'speech-2.8-turbo',
    voice: 'qiaopi_mengmei',
    requiresKey: true,
  }),
  siliconflow: Object.freeze({
    name: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1/audio/speech',
    model: 'FunAudioLLM/CosyVoice2-0.5B',
    voice: 'FunAudioLLM/CosyVoice2-0.5B:claire',
    requiresKey: true,
  }),
  custom: Object.freeze({
    name: 'OpenAI 兼容',
    endpoint: '',
    model: '',
    voice: '',
    requiresKey: false,
  }),
})

const audioLimit = 12 * 1024 * 1024
const loopback = new Set(['127.0.0.1', '[::1]', 'localhost'])
const endpointRoutes = {
  breezeblue: '/text-to-speech',
  minimax: '/t2a_v2',
  siliconflow: '/audio/speech',
  custom: '/audio/speech',
}

function providerSettings(provider) {
  if (!Object.hasOwn(remoteVoiceProviders, provider)) throw new Error('请选择支持的语音服务。')
  return remoteVoiceProviders[provider]
}

export function resolveVoiceEndpoint(provider, endpoint = '') {
  const defaults = providerSettings(provider)
  if (typeof endpoint !== 'string') throw new Error('语音接口地址格式不正确。')
  const address = endpoint.trim() || defaults.endpoint
  if (!address) throw new Error('请填写语音接口地址。')
  let url
  try {
    url = new URL(address)
  } catch {
    throw new Error('语音接口地址格式不正确。')
  }
  if (url.protocol !== 'https:' && !(provider === 'custom' && url.protocol === 'http:' && loopback.has(url.hostname))) {
    throw new Error('语音接口需要 HTTPS。本机自定义接口可使用 HTTP。')
  }
  if (url.username || url.password || url.hash || [...url.searchParams.keys()].some(name => {
    const field = name.toLowerCase().replace(/[^a-z0-9]/gu, '')
    return /(?:api(?:key|token)|password|secret|signature|authorization|credential|token|^key$)/u.test(field)
  })) {
    throw new Error('请把 API 密钥填在密钥栏，接口地址中请勿包含凭据或片段。')
  }
  const route = endpointRoutes[provider]
  const path = url.pathname.replace(/\/+$/u, '')
  url.pathname = path.endsWith('/v1') ? path + route : path || '/v1' + route
  return url.href
}

function providerRequest(provider, url, text, model, voice, instructions, apiKey) {
  const headers = { 'Content-Type': 'application/json' }
  if (provider === 'breezeblue') {
    if (!/^[\w-]{1,256}$/u.test(voice)) throw new Error('BreezeBlue 音色 ID 格式不正确。')
    url.pathname += '/' + voice
    url.searchParams.set('output_format', 'wav')
    url.searchParams.set('delivery', 'sync')
    headers['xi-api-key'] = apiKey
    return { headers, body: { text, model_id: model, ...(instructions ? { instructions } : {}) } }
  }

  if (apiKey) headers.Authorization = 'Bearer ' + apiKey
  if (provider === 'minimax') {
    return {
      headers,
      body: {
        model, text, stream: false, output_format: 'hex',
        voice_setting: { voice_id: voice, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, format: 'wav', channel: 1 },
      },
    }
  }

  if (provider === 'siliconflow') {
    return {
      headers,
      body: { model, voice, input: text, response_format: 'wav', sample_rate: 32000, stream: false },
    }
  }

  return {
    headers,
    body: { model, voice, input: text, response_format: 'wav', ...(instructions ? { instructions } : {}) },
  }
}

async function readResponse(response, limit) {
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel().catch(() => {})
    throw new Error('语音服务返回的音频过大。')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('语音服务没有返回音频。')
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel().catch(() => {})
        throw new Error('语音服务返回的音频过大。')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, length)
}

function minimaxAudio(response) {
  let result
  try {
    result = JSON.parse(response.toString('utf8'))
  } catch {
    throw new Error('MiniMax 返回的语音数据格式不正确。')
  }
  const status = result?.base_resp?.status_code
  if (Number.isSafeInteger(status) && status !== 0) throw new Error(`MiniMax 语音合成失败（错误码 ${status}）。`)
  const audio = result?.data?.audio
  if (typeof audio !== 'string' || audio.length % 2 || !/^[a-f0-9]+$/iu.test(audio)) {
    throw new Error('MiniMax 没有返回有效音频。')
  }
  if (audio.length > 2 * audioLimit) throw new Error('语音服务返回的音频过大。')
  return Buffer.from(audio, 'hex')
}

function audioAttachment(bytes) {
  if (bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    return { bytes, filename: '鲸屿的语音.wav', contentType: 'audio/wav' }
  }
  if (bytes.length >= 12 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
    return { bytes, filename: '鲸屿的语音.mp3', contentType: 'audio/mpeg' }
  }
  throw new Error('语音服务没有返回可播放的 WAV 或 MP3 音频。')
}

export async function speakWithAPI({
  text, provider, endpoint, model = '', voice = '', apiKey = '', instructions = '', signal, fetchFn = fetch,
}) {
  const defaults = providerSettings(provider)
  const url = new URL(resolveVoiceEndpoint(provider, endpoint))
  const input = typeof text === 'string' ? Array.from(text.trim()).slice(0, 640).join('') : ''
  const modelId = model.trim() || defaults.model
  const voiceId = voice.trim() || defaults.voice
  if (!input || !modelId || !voiceId) throw new Error('请填写朗读内容、模型和音色。')
  if (typeof apiKey !== 'string' || /[^\x21-\x7e]/u.test(apiKey)) throw new Error('语音 API 密钥格式不正确。')
  if (!apiKey && defaults.requiresKey) throw new Error(`请先填写 ${defaults.name} 的 API 密钥。`)
  const direction = typeof instructions === 'string' ? instructions.trim().slice(0, 1000) : ''
  const { headers, body } = providerRequest(provider, url, input, modelId, voiceId, direction, apiKey)
  const timeout = AbortSignal.timeout(30000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  signal?.throwIfAborted()
  let response
  try {
    response = await fetchFn(url.href, {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: requestSignal,
    })
  } catch {
    signal?.throwIfAborted()
    if (timeout.aborted) throw new Error('语音合成超时，请稍后再试。')
    throw new Error('无法连接语音服务，请检查接口地址和网络。')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    if (response.status >= 300 && response.status < 400) throw new Error('语音接口返回跳转，请填写最终接口地址。')
    if (response.status === 401 || response.status === 403) throw new Error('语音服务拒绝了当前密钥，请检查密钥及权限。')
    throw new Error(`语音服务请求失败（HTTP ${response.status}）。`)
  }
  const limit = provider === 'minimax' ? 2 * audioLimit + 65536 : audioLimit
  let reply
  try {
    reply = await readResponse(response, limit)
  } catch (error) {
    signal?.throwIfAborted()
    if (timeout.aborted) throw new Error('语音合成超时，请稍后再试。')
    // response streams can expose details from a third party in transport errors
    const reason = error.message
    if (reason === '语音服务返回的音频过大。' || reason === '语音服务没有返回音频。') throw error
    throw new Error('读取语音回复失败，请稍后再试。')
  }
  return audioAttachment(provider === 'minimax' ? minimaxAudio(reply) : reply)
}
