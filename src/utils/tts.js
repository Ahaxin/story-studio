// tts.js — Dual TTS engine: Piper (local) and Google Cloud TTS (cloud).
// Voice engine is selected per voice profile (voiceProfile.voiceEngine).

const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

// ─── Google Cloud TTS ─────────────────────────────────────────────────────────

/**
 * Generate narration using Google Cloud TTS.
 * @param {string} text
 * @param {string} language — 'nl-NL' | 'zh-CN'
 * @param {object} voiceProfile — { voiceId, voiceEngine }
 * @param {string} outputPath — absolute path to save .mp3
 * @returns {Promise<{ path: string, durationSeconds: number }>}
 */
async function generateWithGoogle(text, language, voiceProfile, outputPath) {
  const apiKey = process.env.GOOGLE_TTS_API_KEY
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY is not set in .env')

  // Map our language codes to BCP-47 codes Google expects
  const languageCode = language === 'zh-CN' ? 'cmn-CN' : 'nl-NL'

  const requestBody = {
    input: { text },
    voice: {
      languageCode,
      name: voiceProfile.voiceId || getDefaultGoogleVoice(language),
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.9,     // slightly slower for children
      pitch: 1.5,            // slightly higher pitch, more expressive
    },
  }

  const response = await axios.post(
    `${GOOGLE_TTS_URL}?key=${apiKey}`,
    requestBody,
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  )

  const audioContent = response.data?.audioContent
  if (!audioContent) {
    throw new Error(`Google TTS returned no audio. Response: ${JSON.stringify(response.data)}`)
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, Buffer.from(audioContent, 'base64'))

  const durationSeconds = await getAudioDuration(outputPath)
  return { path: outputPath, durationSeconds }
}

/** Default Google voice IDs per language */
function getDefaultGoogleVoice(language) {
  const defaults = {
    'nl-NL': 'nl-NL-Wavenet-D',
    'zh-CN': 'cmn-CN-Wavenet-A',
  }
  return defaults[language] || 'nl-NL-Wavenet-D'
}

/**
 * Fetch available Google TTS voices for a language.
 * @param {string} language — 'nl-NL' | 'zh-CN'
 * @returns {Promise<object[]>} array of voice objects
 */
async function listGoogleVoices(language) {
  const apiKey = process.env.GOOGLE_TTS_API_KEY
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY is not set in .env')

  const languageCode = language === 'zh-CN' ? 'cmn-CN' : 'nl-NL'

  const response = await axios.get(
    `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}&languageCode=${languageCode}`,
    { timeout: 10000 }
  )

  return response.data?.voices || []
}

// ─── Piper TTS (local) ────────────────────────────────────────────────────────

/**
 * Generate narration using the local Piper TTS binary.
 * Piper outputs WAV; we then convert to MP3 via FFmpeg.
 * @param {string} text
 * @param {string} language
 * @param {object} voiceProfile
 * @param {string} outputPath — final .mp3 path
 * @returns {Promise<{ path: string, durationSeconds: number }>}
 */
async function generateWithPiper(text, language, voiceProfile, outputPath) {
  const piperBin = path.join(
    process.resourcesPath || path.join(__dirname, '../../resources'),
    'piper.exe'
  )

  const modelsBasePath = process.env.PIPER_MODELS_PATH || './resources/piper/models'
  const modelPath = voiceProfile.voiceId
    ? path.join(modelsBasePath, voiceProfile.voiceId)
    : getDefaultPiperModel(language, modelsBasePath)

  if (!fs.existsSync(piperBin)) {
    throw new Error(`Piper binary not found at ${piperBin}. Please place piper.exe in resources/.`)
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Piper model not found at ${modelPath}. Download the model and place it in ${modelsBasePath}.`)
  }

  // Piper outputs WAV; write to a temp path then convert
  const wavPath = outputPath.replace(/\.mp3$/, '.wav')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  await new Promise((resolve, reject) => {
    // Piper reads text from stdin
    const piper = spawn(piperBin, [
      '--model', modelPath,
      '--output_file', wavPath,
    ])

    piper.stdin.write(text)
    piper.stdin.end()

    piper.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Piper exited with code ${code}`))
    })
    piper.on('error', reject)
  })

  // Convert WAV → MP3 using FFmpeg
  await convertWavToMp3(wavPath, outputPath)

  // Clean up temp WAV
  if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath)

  const durationSeconds = await getAudioDuration(outputPath)
  return { path: outputPath, durationSeconds }
}

/** Default Piper model filenames per language */
function getDefaultPiperModel(language, modelsBasePath) {
  const models = {
    'nl-NL': 'nl_NL-mls-medium.onnx',
    'zh-CN': 'zh_CN-huayan-medium.onnx',
  }
  const filename = models[language] || models['nl-NL']
  return path.join(modelsBasePath, filename)
}

// ─── ElevenLabs (online voice clone) ─────────────────────────────────────────

const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'

/**
 * Generate narration using ElevenLabs TTS.
 * @param {string} text
 * @param {string} language — passed for reference; ElevenLabs uses multilingual_v2
 * @param {object} voiceProfile — { voiceId, elevenLabsApiKey }
 * @param {string} outputPath — absolute path to save .mp3
 */
async function generateWithElevenLabs(text, language, voiceProfile, outputPath) {
  const apiKey = voiceProfile.elevenLabsApiKey
  if (!apiKey) throw new Error('ElevenLabs API key is not set. Go to Settings → API Keys.')
  if (!voiceProfile.voiceId) throw new Error('ElevenLabs Voice ID is not set. Add it in Settings → Daughter profile.')

  const response = await axios.post(
    `${ELEVENLABS_TTS_URL}/${voiceProfile.voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  )

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, Buffer.from(response.data))

  const durationSeconds = await getAudioDuration(outputPath)
  return { path: outputPath, durationSeconds }
}

// ─── XTTS v2 (local voice cloning) ───────────────────────────────────────────

const XTTS_SERVER_URL = 'http://127.0.0.1:5002'

// Map Story Studio language codes → XTTS v2 internal codes
const XTTS_LANG_MAP = {
  'nl-NL': 'nl',
  'zh-CN': 'zh-cn',
}

/**
 * Generate narration via the local XTTS v2 Flask server.
 * The server must be running (started by Electron main process).
 * voiceProfile.voiceSamplePath must point to a recorded WAV reference clip.
 *
 * @param {string} text
 * @param {string} language — 'nl-NL' | 'zh-CN'
 * @param {object} voiceProfile — { voiceSamplePath }
 * @param {string} outputPath — final .mp3 path
 * @returns {Promise<{ path: string, durationSeconds: number }>}
 */
async function generateWithXtts(text, language, voiceProfile, outputPath) {
  if (!voiceProfile.voiceSamplePath) {
    throw new Error(
      'XTTS voice clone requires a recorded voice sample. ' +
      'Go to Settings and record a sample for this daughter first.'
    )
  }
  if (!fs.existsSync(voiceProfile.voiceSamplePath)) {
    throw new Error(
      `Voice sample file not found: ${voiceProfile.voiceSamplePath}. ` +
      'Please re-record the voice sample in Settings.'
    )
  }

  const xttsLang = XTTS_LANG_MAP[language] || 'nl'

  // Verify server is reachable and model is loaded before sending a long request
  try {
    const healthRes = await axios.get(`${XTTS_SERVER_URL}/health`, { timeout: 3000 })
    if (healthRes.data?.status === 'loading') {
      throw new Error('XTTS model is still loading. Please wait a moment and try again.')
    }
    if (healthRes.data?.status !== 'ready') {
      throw new Error('XTTS server is not ready. Check Settings for server status.')
    }
  } catch (err) {
    if (err.message.includes('XTTS')) throw err  // re-throw our own errors
    throw new Error(
      'XTTS server is offline. Make sure Python and the TTS library are installed. ' +
      'See Settings → XTTS Setup for instructions.'
    )
  }

  console.log(`[tts] XTTS synthesizing via voice clone (lang=${xttsLang})`)

  // Request synthesis — response is raw WAV bytes
  let response
  try {
    response = await axios.post(
      `${XTTS_SERVER_URL}/synthesize`,
      {
        text,
        reference_audio_path: voiceProfile.voiceSamplePath,
        language: xttsLang,
      },
      {
        responseType: 'arraybuffer',
        timeout: 180000,  // 3 min — XTTS on CPU can be slow for longer paragraphs
      }
    )
  } catch (err) {
    // Decode the error body from arraybuffer to get the actual Python exception message
    if (err.response?.data) {
      try {
        const decoded = JSON.parse(Buffer.from(err.response.data).toString('utf-8'))
        throw new Error(`XTTS synthesis failed: ${decoded.error || JSON.stringify(decoded)}`)
      } catch (parseErr) {
        if (parseErr.message.startsWith('XTTS')) throw parseErr
      }
    }
    throw err
  }

  // Save WAV then convert to MP3
  const wavPath = outputPath.replace(/\.mp3$/, '_xtts.wav')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(wavPath, Buffer.from(response.data))

  await convertWavToMp3(wavPath, outputPath)
  if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath)

  const durationSeconds = await getAudioDuration(outputPath)
  return { path: outputPath, durationSeconds }
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

/**
 * Main entry point — generate narration using the correct engine.
 * @param {string} text
 * @param {string} language
 * @param {object} voiceProfile
 * @param {string} outputPath
 * @returns {Promise<{ path: string, durationSeconds: number }>}
 */
async function generateNarration(text, language, voiceProfile, outputPath) {
  if (!text || !text.trim()) throw new Error('Cannot generate narration for empty text.')

  const engine = voiceProfile?.voiceEngine || 'piper'
  console.log(`[tts] Generating narration via ${engine} (${language})`)

  switch (engine) {
    case 'elevenlabs': return generateWithElevenLabs(text, language, voiceProfile, outputPath)
    case 'xtts':       return generateWithXtts(text, language, voiceProfile, outputPath)
    case 'google':     return generateWithGoogle(text, language, voiceProfile, outputPath)
    default:           return generateWithPiper(text, language, voiceProfile, outputPath)
  }
}

/**
 * Generate a short test preview clip (~3 seconds of speech).
 * @param {string} text — short phrase to speak
 * @param {object} voiceProfile
 * @param {string} language
 * @returns {Promise<{ path: string, durationSeconds: number }>}
 */
async function testVoice(text, voiceProfile, language) {
  const tmpDir = require('os').tmpdir()
  const outputPath = path.join(tmpDir, `tts_test_${Date.now()}.mp3`)
  return generateNarration(text, language, voiceProfile, outputPath)
}

/**
 * Get duration of an audio file in seconds using ffprobe.
 * @param {string} audioPath
 * @returns {Promise<number>}
 */
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const ffprobePath = getFfprobePath()

    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ])

    let output = ''
    proc.stdout.on('data', d => { output += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) {
        const dur = parseFloat(output.trim())
        resolve(isNaN(dur) ? 0 : dur)
      } else {
        reject(new Error(`ffprobe exited with code ${code}`))
      }
    })
    proc.on('error', reject)
  })
}

/** Convert WAV to MP3 using FFmpeg */
function convertWavToMp3(wavPath, mp3Path) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath()

    const proc = spawn(ffmpegPath, [
      '-y',
      '-i', wavPath,
      '-codec:a', 'libmp3lame',
      '-qscale:a', '2',
      mp3Path,
    ])

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg WAV→MP3 conversion failed with code ${code}`))
    })
    proc.on('error', reject)
  })
}

/** Resolve FFmpeg binary path (bundled or system) */
function getFfmpegPath() {
  const bundled = path.join(
    process.resourcesPath || path.join(__dirname, '../../resources'),
    'ffmpeg.exe'
  )
  return fs.existsSync(bundled) ? bundled : 'ffmpeg'
}

/** Resolve ffprobe binary path (bundled or system) */
function getFfprobePath() {
  const bundled = path.join(
    process.resourcesPath || path.join(__dirname, '../../resources'),
    'ffprobe.exe'
  )
  return fs.existsSync(bundled) ? bundled : 'ffprobe'
}

module.exports = { generateNarration, listGoogleVoices, testVoice, getAudioDuration }
