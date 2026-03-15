// ffmpeg.js — Video assembly via FFmpeg child process.
// Builds a 1920x1080 H.264 MP4 from scene images + narration audio,
// with per-scene transitions and subtitle overlays.

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

/** Resolve FFmpeg binary path (bundled or system fallback) */
function getFfmpegPath() {
  const bundled = path.join(
    process.resourcesPath || path.join(__dirname, '../../resources'),
    'ffmpeg.exe'
  )
  return fs.existsSync(bundled) ? bundled : 'ffmpeg'
}

/** Resolve ffprobe binary path */
function getFfprobePath() {
  const bundled = path.join(
    process.resourcesPath || path.join(__dirname, '../../resources'),
    'ffprobe.exe'
  )
  return fs.existsSync(bundled) ? bundled : 'ffprobe'
}

/**
 * Get the duration of an audio file in seconds.
 * @param {string} audioPath
 * @returns {Promise<number>}
 */
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfprobePath(), [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ])

    let output = ''
    proc.stdout.on('data', d => { output += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve(parseFloat(output.trim()) || 0)
      else reject(new Error(`ffprobe failed (code ${code}) on ${audioPath}`))
    })
    proc.on('error', reject)
  })
}

/**
 * Build the FFmpeg xfade/transition filter string for a given type.
 * These are applied between consecutive scenes.
 * @param {'page-curl'|'slide'|'fade'|'zoom'} type
 * @param {number} duration — transition duration in seconds
 * @returns {string} FFmpeg filter expression
 */
function buildTransitionFilter(type, duration = 0.5) {
  switch (type) {
    case 'slide':
      return `xfade=transition=slideright:duration=${duration}`
    case 'fade':
      return `xfade=transition=fade:duration=${duration.toFixed(2)}`
    case 'zoom':
      // Zoom-pan into next scene
      return `xfade=transition=smoothup:duration=${duration}`
    case 'page-curl':
    default:
      // FFmpeg doesn't have a native page-curl xfade; use 'diagtl' as the closest equivalent.
      // For a true page-curl, a custom overlay filter chain would be needed.
      return `xfade=transition=diagtl:duration=${duration}`
  }
}


/**
 * Assemble all scene assets into a final MP4 video.
 *
 * Strategy:
 * - Each scene: still image looped for (audioDuration + 0.5s)
 * - Scenes concatenated with xfade transitions
 * - Subtitle text drawn at bottom per scene
 * - All narration audio concatenated
 * - Final encode: H.264 + AAC, 1920x1080 @ 30fps
 *
 * @param {object} project — full project object
 * @param {object[]} scenes — array of scene objects (must be status 'ready')
 * @param {string} outputPath — absolute path for output .mp4
 * @param {function} onProgress — callback(percent: number)
 * @returns {Promise<void>}
 */
async function assembleVideo(project, scenes, outputPath, onProgress) {
  // ── Pre-flight check ──────────────────────────────────────────────────────
  const missing = []
  for (const scene of scenes) {
    if (!scene.illustrationPath || !fs.existsSync(scene.illustrationPath)) {
      missing.push(`Scene ${scene.index + 1}: missing illustration`)
    }
    const audioPath = scene.recordingPath || scene.narrationPath
    if (!audioPath || !fs.existsSync(audioPath)) {
      missing.push(`Scene ${scene.index + 1}: missing narration audio`)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Pre-flight failed:\n${missing.join('\n')}`)
  }

  // ── Calculate exact scene durations via ffprobe ──────────────────────────
  console.log('[ffmpeg] Calculating scene durations...')
  const scenesWithDuration = await Promise.all(
    scenes.map(async (scene) => {
      const audioPath = scene.recordingPath || scene.narrationPath
      const audioDuration = await getAudioDuration(audioPath)
      return { ...scene, duration: audioDuration + 0.5, _audioPath: audioPath }
    })
  )

  const totalDuration = scenesWithDuration.reduce((sum, s) => sum + s.duration, 0)
  console.log(`[ffmpeg] Total video duration: ${totalDuration.toFixed(1)}s across ${scenes.length} scenes`)

  // ── Build FFmpeg arguments ────────────────────────────────────────────────
  // We use the filter_complex approach:
  // 1. Input each image as a video stream looped for its scene duration
  // 2. Input each narration audio
  // 3. Scale + letterbox each image stream
  // 4. Chain xfade transitions between video streams
  // 5. Concatenate audio streams
  // 6. Encode to H.264 + AAC

  const ffmpegArgs = []
  const TRANSITION_DURATION = 0.5  // seconds
  const FPS = project.export?.fps || 30
  const RESOLUTION = project.export?.resolution || '1920x1080'
  const [RES_W, RES_H] = RESOLUTION.split('x')

  // Inputs: alternate image + audio per scene
  // Add 1s buffer to image loop so xfade never starves for frames at the transition boundary
  for (const scene of scenesWithDuration) {
    ffmpegArgs.push(
      '-loop', '1',
      '-t', (scene.duration + 1).toFixed(3),
      '-i', scene.illustrationPath
    )
  }
  for (const scene of scenesWithDuration) {
    ffmpegArgs.push('-i', scene._audioPath)
  }

  // ── Build filter_complex ──────────────────────────────────────────────────
  const n = scenesWithDuration.length
  const filterParts = []

  // Step 1: Scale each image to target resolution (letterboxed)
  for (let i = 0; i < n; i++) {
    const label = `v${i}`
    filterParts.push(
      `[${i}:v]scale=${RESOLUTION}:force_original_aspect_ratio=decrease,` +
      `pad=w=${RES_W}:h=${RES_H}:x=(ow-iw)/2:y=(oh-ih)/2:color=white,` +
      `fps=${FPS}` +
      `[${label}]`
    )
  }

  // Step 2: Chain xfade transitions between video streams
  let lastVideoLabel = 'v0'
  let timeOffset = scenesWithDuration[0].duration - TRANSITION_DURATION

  for (let i = 1; i < n; i++) {
    const currentLabel = `v${i}`
    const outLabel = i === n - 1 ? 'vout' : `xf${i}`
    const transitionFilter = buildTransitionFilter(
      scenesWithDuration[i].transition,
      TRANSITION_DURATION
    )

    filterParts.push(
      `[${lastVideoLabel}][${currentLabel}]${transitionFilter}:offset=${timeOffset.toFixed(3)}[${outLabel}]`
    )

    lastVideoLabel = outLabel
    timeOffset += scenesWithDuration[i].duration - TRANSITION_DURATION
  }

  // If only 1 scene, rename v0 → vout
  if (n === 1) {
    filterParts[0] = filterParts[0].replace('[v0]', '[vout]')
  }

  // Step 3: Concatenate audio streams
  const audioInputs = scenesWithDuration.map((_, i) => `[${n + i}:a]`).join('')
  filterParts.push(`${audioInputs}concat=n=${n}:v=0:a=1[aout]`)

  // ── Final FFmpeg command ──────────────────────────────────────────────────
  const filterComplex = filterParts.join(';\n')

  ffmpegArgs.push(
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-r', String(FPS),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  )

  // ── Spawn FFmpeg ──────────────────────────────────────────────────────────
  console.log('[ffmpeg] Starting video assembly...')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFfmpegPath(), ffmpegArgs)

    let stderrBuffer = ''

    ffmpeg.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderrBuffer += chunk

      // Parse progress from FFmpeg stderr: "time=HH:MM:SS.ms"
      const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/)
      if (timeMatch && onProgress) {
        const h = parseInt(timeMatch[1])
        const m = parseInt(timeMatch[2])
        const s = parseInt(timeMatch[3])
        const currentSecs = h * 3600 + m * 60 + s
        const percent = Math.min(99, Math.round((currentSecs / totalDuration) * 100))
        onProgress(percent)
      }
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        onProgress && onProgress(100)
        console.log(`[ffmpeg] Video assembled successfully: ${outputPath}`)
        resolve()
      } else {
        const tail = stderrBuffer.slice(-3000)
        console.error('[ffmpeg] stderr:', tail)
        reject(new Error(`FFmpeg exited with code ${code}.\n${tail}`))
      }
    })

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}. Is ffmpeg.exe in resources/?`))
    })
  })
}

module.exports = { assembleVideo, getAudioDuration, buildTransitionFilter }
