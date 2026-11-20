import assert from 'node:assert/strict'
import { test } from 'node:test'
import { remoteVoiceProviders, resolveVoiceEndpoint, speakWithAPI } from '../src/tts.mjs'

const key = 'sample-credential'
const wav = Buffer.alloc(46)
wav.write('RIFF', 0, 'ascii')
wav.writeUInt32LE(wav.length - 8, 4)
wav.write('WAVEfmt ', 8, 'ascii')
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(24000, 24)
wav.writeUInt32LE(48000, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36, 'ascii')
wav.writeUInt32LE(2, 40)

test('resolves exact audio endpoints from provider-specific defaults or compatible base addresses', () => {
  assert.equal(resolveVoiceEndpoint('minimax', 'https://api.minimax.io/v1/'), 'https://api.minimax.io/v1/t2a_v2')
  assert.equal(resolveVoiceEndpoint('breezeblue', 'https://api.breeze.blue'), 'https://api.breeze.blue/v1/text-to-speech')
  assert.equal(resolveVoiceEndpoint('siliconflow'), remoteVoiceProviders.siliconflow.endpoint)
  assert.equal(resolveVoiceEndpoint('custom', 'http://[::1]:9125'), 'http://[::1]:9125/v1/audio/speech')
  assert.equal(resolveVoiceEndpoint('custom', 'https://example.net/tts?api-version=1'), 'https://example.net/tts?api-version=1')
})

test('rejects unsafe endpoints and embedded credentials', () => {
  assert.throws(() => resolveVoiceEndpoint('custom', 'http://example.net/v1'), /需要 HTTPS/u)
  assert.throws(() => resolveVoiceEndpoint('breezeblue', 'http://127.0.0.1/v1'), /需要 HTTPS/u)
  assert.throws(() => resolveVoiceEndpoint('custom', 'https://user:pass@example.net/v1'), /勿包含凭据/u)
  assert.throws(() => resolveVoiceEndpoint('custom', 'https://example.net/v1?api_key=private'), /勿包含凭据/u)
  assert.throws(() => resolveVoiceEndpoint('custom', 'https://example.net/v1#fragment'), /勿包含凭据/u)
  assert.throws(() => resolveVoiceEndpoint('custom'), /填写语音接口/u)
})

test('BreezeBlue uses the authorized voice path and its own authentication header', async () => {
  const audio = await speakWithAPI({
    provider: 'breezeblue', apiKey: key, voice: 'voc_abcdefghijkl', text: '你好', instructions: '温柔地说',
    fetchFn: async (address, options) => {
      const url = new URL(address)
      assert.equal(url.hostname, 'api.breeze.blue')
      assert.equal(url.pathname, '/v1/text-to-speech/voc_abcdefghijkl')
      assert.equal(url.searchParams.get('output_format'), 'wav')
      assert.equal(url.searchParams.get('delivery'), 'sync')
      assert.equal(options.headers['xi-api-key'], key)
      assert.equal(options.redirect, 'manual')
      assert.deepEqual(JSON.parse(options.body), { text: '你好', model_id: 'breeze-tts-2', instructions: '温柔地说' })
      return new Response(wav)
    },
  })
  assert.deepEqual(audio, { bytes: wav, filename: '鲸屿的语音.wav', contentType: 'audio/wav' })
})

test('MiniMax sends the selected model and voice and converts its hex result to audio', async () => {
  const audio = await speakWithAPI({
    provider: 'minimax', apiKey: key, voice: 'custom-voice', model: 'speech-2.8-hd', text: '试音',
    fetchFn: async (url, options) => {
      assert.equal(url, remoteVoiceProviders.minimax.endpoint)
      assert.equal(options.headers.Authorization, 'Bearer ' + key)
      const payload = JSON.parse(options.body)
      assert.equal(payload.model, 'speech-2.8-hd')
      assert.equal(payload.voice_setting.voice_id, 'custom-voice')
      assert.equal(payload.audio_setting.format, 'wav')
      assert.equal(payload.output_format, 'hex')
      return Response.json({ base_resp: { status_code: 0 }, data: { audio: wav.toString('hex') } })
    },
  })
  assert.deepEqual(audio.bytes, wav)
})

test('siliconflow and custom send appropriate API speech payloads and retain optional local key', async () => {
  for (const provider of ['siliconflow', 'custom']) {
    const custom = provider === 'custom'
    const audio = await speakWithAPI({
      provider, apiKey: custom ? '' : key,
      endpoint: custom ? 'http://localhost:8001' : undefined,
      model: custom ? 'tts-1' : undefined, voice: custom ? 'alloy' : undefined,
      text: '海'.repeat(641),
      fetchFn: async (url, options) => {
        assert.equal(url, custom ? 'http://localhost:8001/v1/audio/speech' : remoteVoiceProviders.siliconflow.endpoint)
        assert.equal(options.headers.Authorization, custom ? undefined : 'Bearer ' + key)
        const payload = JSON.parse(options.body)
        assert.equal(payload.input, '海'.repeat(640))
        assert.equal(payload.response_format, 'wav')
        assert.equal(payload.voice, custom ? 'alloy' : remoteVoiceProviders.siliconflow.voice)
        return new Response(wav)
      },
    })
    assert.deepEqual(audio.bytes, wav)
  }
})

test('keeps credentials out of failures and rejects redirects, missing keys and malformed audio', async () => {
  const base = { provider: 'siliconflow', apiKey: key, text: '试音' }
  await assert.rejects(speakWithAPI({ ...base, apiKey: '', fetchFn: assert.fail }), /先填写/u)
  await assert.rejects(speakWithAPI({
    ...base,
    fetchFn: async () => new Response(key, { status: 401 }),
  }), error => /拒绝/u.test(error.message) && !error.message.includes(key))
  await assert.rejects(speakWithAPI({
    ...base,
    fetchFn: async () => { throw new Error(key) },
  }), error => /无法连接/u.test(error.message) && !error.message.includes(key))
  await assert.rejects(speakWithAPI({
    ...base,
    fetchFn: async () => new Response(null, { status: 302, headers: { Location: 'https://example.net' } }),
  }), /返回跳转/u)
  await assert.rejects(speakWithAPI({
    ...base,
    fetchFn: async () => new Response(wav, { headers: { 'Content-Length': '14000000' } }),
  }), /音频过大/u)
  await assert.rejects(speakWithAPI({
    ...base,
    fetchFn: async () => Response.json({ audio: key }),
  }), /可播放/u)
  await assert.rejects(speakWithAPI({
    ...base, provider: 'minimax',
    fetchFn: async () => Response.json({ base_resp: { status_code: 1008, status_msg: key }, data: null }),
  }), error => /1008/u.test(error.message) && !error.message.includes(key))
})
