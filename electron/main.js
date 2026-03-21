// Story Studio — Electron Main Process
// All file I/O and API calls happen here via IPC.
// React frontend communicates exclusively through ipcRenderer.invoke().

const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net: electronNet } = require('electron')

// Register custom scheme BEFORE app is ready (Electron requirement)
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, supportFetchAPI: true, stream: true } },
])
const path = require('path')
const fs = require('fs')
const os = require('os')
const net = require('net')
const { spawn } = require('child_process')
const axios = require('axios')
const FormData = require('form-data')
require('dotenv').config()

// electron-store for persistent settings
let Store
let store

// We use dynamic import for ESM-only electron-store
async function initStore() {
  const { default: ElectronStore } = await import('electron-store')
  store = new ElectronStore({
    name: 'story-studio-settings',
    defaults: {
      nanoBananaApiKey: '',
      googleTtsApiKey: '',
      elevenLabsApiKey: '',
      piperModelsPath: './resources/piper/models',
      daughters: {
        daughter1: { name: '', voiceEngine: 'piper', voiceId: '', voiceSamplePath: '', avatarMode: 'none', avatarPath: '', characterPrompt: '', characterReferencePath: '' },
        daughter2: { name: '', voiceEngine: 'google', voiceId: '', voiceSamplePath: '', avatarMode: 'none', avatarPath: '', characterPrompt: '', characterReferencePath: '' },
      },
      characters: [],
    },
  })
}

// Path to the projects directory — stored in app folder to avoid spaces in userData path
const PROJECTS_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'projects')
  : path.join(__dirname, '..', 'projects')

// Ensure projects directory exists
function ensureProjectsDir() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true })
  }
}

// Helper: read project.json for a given project ID
function readProjectJson(projectId) {
  const projectPath = path.join(PROJECTS_DIR, projectId, 'project.json')
  if (!fs.existsSync(projectPath)) throw new Error(`Project not found: ${projectId}`)
  return JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
}

// Helper: write project.json for a given project ID
function writeProjectJson(projectId, data) {
  const projectPath = path.join(PROJECTS_DIR, projectId, 'project.json')
  fs.writeFileSync(projectPath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Merge voice settings (name, engine, voiceId, sample) from electron-store into a project's style
function mergeVoiceSettings(project) {
  const daughters = store.get('daughters') || {}
  for (const d of ['daughter1', 'daughter2']) {
    if (!daughters[d]) continue
    const { name, voiceEngine, voiceId, voiceSamplePath, avatarMode, characterPrompt, characterReferencePath } = daughters[d]
    project.style[d] = {
      ...project.style[d],
      ...(name              !== undefined && { name }),
      ...(voiceEngine       !== undefined && { voiceEngine }),
      ...(voiceId           !== undefined && { voiceId }),
      ...(voiceSamplePath   !== undefined && { voiceSamplePath }),
      ...(avatarMode              !== undefined && { avatarMode }),
      ...(characterPrompt         !== undefined && { characterPrompt }),
      ...(characterReferencePath  !== undefined && { characterReferencePath }),
    }
  }
  return project
}

// story:create — Create new project folder + project.json
ipcMain.handle('story:create', async (event, { name, language, scenes, illustrationStyle, styleId }) => {
  try {
    const { createProject } = require('../src/utils/schema')
    const project = createProject(name, language)

    // Populate daughter voice profiles from electron-store settings
    mergeVoiceSettings(project)

    // Apply style preset if provided
    if (illustrationStyle) project.style.illustrationStyle = illustrationStyle
    if (styleId) project.style.styleId = styleId

    // Attach pre-split scenes — run through createScene() to ensure UUIDs + all fields
    if (scenes && Array.isArray(scenes)) {
      const { createScene } = require('../src/utils/schema')
      project.scenes = scenes.map((s, i) => {
        const scene = createScene(i, s.text, s.narrator || 'daughter1', s.transition || 'page-curl')
        // Preserve AI-generated illustrationPrompt if provided (from Write for Me flow)
        if (s.illustrationPrompt && typeof s.illustrationPrompt === 'string' && s.illustrationPrompt.trim()) {
          scene.illustrationPrompt = s.illustrationPrompt.trim()
        }
        return scene
      })
    }

    const projectDir = path.join(PROJECTS_DIR, project.id)
    fs.mkdirSync(path.join(projectDir, 'scenes'), { recursive: true })
    fs.mkdirSync(path.join(projectDir, 'avatars'), { recursive: true })
    fs.mkdirSync(path.join(projectDir, 'export'), { recursive: true })

    ensureIllustrationPrompts(project)
    writeProjectJson(project.id, project)

    return { success: true, data: project }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Populate missing illustrationPrompts so every scene has a default prompt to display.
// Character consistency is NOT embedded here — it is injected as a fresh Gemini API
// part at generation time by scene:generate-illustration.
function ensureIllustrationPrompts(project) {
  const { buildScenePrompt } = require('../src/utils/nanoBanana')
  for (const scene of project.scenes) {
    if (!scene.illustrationPrompt || !scene.illustrationPrompt.trim()) {
      const narrator = project.style[scene.narrator] || project.style[project.style.activeNarrator]
      const avatarPrompt = narrator?.characterPrompt || ''   // always pass, no avatarMode gate
      scene.illustrationPrompt = buildScenePrompt(scene.text, project.style, avatarPrompt, scene.index, project.name)
    }
  }
}

// story:load — Load project.json by project ID
ipcMain.handle('story:load', async (event, { projectId }) => {
  try {
    const project = readProjectJson(projectId)
    mergeVoiceSettings(project)
    ensureIllustrationPrompts(project)
    return { success: true, data: project }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// story:rename — Update the project name in project.json and rebuild cover prompt
ipcMain.handle('story:rename', async (event, { projectId, name }) => {
  try {
    const project = readProjectJson(projectId)
    project.name = String(name).trim()

    // Rebuild the cover scene's illustration prompt with the updated title
    const coverScene = project.scenes.find(s => s.index === 0)
    if (coverScene) {
      const { buildScenePrompt } = require('../src/utils/nanoBanana')
      mergeVoiceSettings(project)
      const narrator = project.style[coverScene.narrator] || project.style[project.style.activeNarrator]
      const avatarPrompt = narrator?.characterPrompt || ''   // always pass, no avatarMode gate
      coverScene.illustrationPrompt = buildScenePrompt(coverScene.text, project.style, avatarPrompt, 0, project.name)
    }

    writeProjectJson(projectId, project)
    return { success: true, data: coverScene || null }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// story:update-style — Change the illustration style preset for a project
ipcMain.handle('story:update-style', async (event, { projectId, styleId, illustrationStyle, clearPrompts }) => {
  try {
    const project = readProjectJson(projectId)
    mergeVoiceSettings(project)
    project.style.styleId = styleId
    project.style.illustrationStyle = illustrationStyle
    if (clearPrompts) {
      for (const scene of project.scenes) {
        scene.illustrationPrompt = ''
      }
    }
    ensureIllustrationPrompts(project)
    writeProjectJson(projectId, project)
    return { success: true, data: project }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// style:list-previews — Return {id: absoluteFilePath | null} for all 8 style presets
ipcMain.handle('style:list-previews', async () => {
  try {
    const STYLE_PRESETS = require('../src/utils/stylePresetsData.json')
    const previewsDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'voices', 'style-previews')
      : path.join(__dirname, '..', 'voices', 'style-previews')

    const result = {}
    for (const preset of STYLE_PRESETS) {
      const filePath = path.join(previewsDir, `${preset.id}.png`)
      result[preset.id] = fs.existsSync(filePath) ? filePath : null
    }
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// style:generate-previews — Generate missing preview images for all style presets
ipcMain.handle('style:generate-previews', async () => {
  try {
    const STYLE_PRESETS = require('../src/utils/stylePresetsData.json')
    const { generatePortrait } = require('../src/utils/nanoBanana')

    const previewsDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'voices', 'style-previews')
      : path.join(__dirname, '..', 'voices', 'style-previews')
    fs.mkdirSync(previewsDir, { recursive: true })

    const apiKey = store.get('nanoBananaApiKey') || process.env.NANO_BANANA_API_KEY

    const results = []
    for (const preset of STYLE_PRESETS) {
      const filePath = path.join(previewsDir, `${preset.id}.png`)
      if (fs.existsSync(filePath)) {
        results.push({ id: preset.id, imagePath: filePath, skipped: true })
        continue
      }
      try {
        const previewPrompt = `children's book illustration, ${preset.prompt}, a young girl discovering a magical glowing flower in an enchanted forest, warm magical light, safe for kids aged 4-10`
        await generatePortrait(previewPrompt, filePath, apiKey)
        results.push({ id: preset.id, imagePath: filePath })
        console.log(`[style-previews] Generated preview for: ${preset.id}`)
      } catch (err) {
        console.warn(`[style-previews] Failed to generate preview for ${preset.id}:`, err.message)
        results.push({ id: preset.id, error: err.message })
      }
    }
    return { success: true, data: results }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// story:delete — Remove a project folder entirely
ipcMain.handle('story:delete', async (event, { projectId }) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, projectId)
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// story:list — List all saved projects (id, name, createdAt)
ipcMain.handle('story:list', async () => {
  try {
    ensureProjectsDir()
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    const projects = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const project = readProjectJson(entry.name)
        projects.push({ id: project.id, name: project.name, createdAt: project.createdAt, language: project.language })
      } catch {
        // Skip malformed project dirs
      }
    }

    projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return { success: true, data: projects }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// scene:generate-illustration — Call Nano Banana API, save image, update project.json
ipcMain.handle('scene:generate-illustration', async (event, { projectId, sceneId }) => {
  try {
    const project = readProjectJson(projectId)
    mergeVoiceSettings(project)
    const scene = project.scenes.find(s => s.id === sceneId)
    if (!scene) throw new Error(`Scene not found: ${sceneId}`)

    const { generateIllustration, buildScenePrompt } = require('../src/utils/nanoBanana')

    const narrator = project.style[scene.narrator] || project.style[project.style.activeNarrator]

    // Collect all reference images: narrator always included, other daughters + library
    // characters matched case-insensitively against scene text + illustration prompt.
    const sceneContent = `${scene.text} ${scene.illustrationPrompt || ''}`
    const sceneContentLower = sceneContent.toLowerCase()
    const refPaths = []

    const narratorKey = scene.narrator || project.style.activeNarrator
    const allDaughters = store.get('daughters') || {}

    // Narrator always gets their reference image (they're in every scene, often via pronouns)
    const narratorDaughter = allDaughters[narratorKey]
    if (narratorDaughter?.characterReferencePath) {
      refPaths.push(narratorDaughter.characterReferencePath)
    }

    // Other daughters: only when their name appears in the scene (case-insensitive)
    for (const [key, d] of Object.entries(allDaughters)) {
      if (key === narratorKey) continue
      if (d?.characterReferencePath && d?.name && sceneContentLower.includes(d.name.toLowerCase())) {
        refPaths.push(d.characterReferencePath)
      }
    }

    const allCharacters = store.get('characters', [])
    for (const char of allCharacters) {
      if (char.imagePath && char.name && sceneContentLower.includes(char.name.toLowerCase())) {
        refPaths.push(char.imagePath)
      }
    }

    if (refPaths.length > 0) {
      console.log(`[generate-illustration] Using ${refPaths.length} reference image(s):`, refPaths.map(p => path.basename(p)))
    }

    // Build/use scene description prompt.
    // Use the stored prompt if it exists (user-edited or pre-built), otherwise generate one.
    if (!scene.illustrationPrompt || !scene.illustrationPrompt.trim()) {
      const avatarPrompt = narrator?.characterPrompt || ''
      scene.illustrationPrompt = buildScenePrompt(scene.text, project.style, avatarPrompt, scene.index, project.name)
    }
    const scenePrompt = scene.illustrationPrompt

    // Build character consistency context — ALWAYS fresh from store, injected as a separate
    // Gemini API part so it covers auto-discovered characters regardless of when the story
    // was created or whether the scene prompt was pre-built (paste text) or AI-generated.
    const charContextParts = []
    if (scene.index > 0) {
      if (narrator?.characterPrompt?.trim()) {
        charContextParts.push(narrator.characterPrompt.trim())
      }
      for (const [key, d] of Object.entries(allDaughters)) {
        if (key !== narratorKey && d?.name && d?.characterPrompt && sceneContentLower.includes(d.name.toLowerCase())) {
          charContextParts.push(`${d.name}: ${d.characterPrompt.trim()}`)
        }
      }
      for (const char of allCharacters) {
        if (char.description && char.name && sceneContentLower.includes(char.name.toLowerCase())) {
          charContextParts.push(`${char.name}: ${char.description.trim()}`)
        }
      }
    }
    const characterContext = charContextParts.length > 0
      ? 'IMPORTANT — character appearance must stay IDENTICAL across every scene ' +
        '(same face shape, eye color, hair color and style, skin tone, body proportions). ' +
        'Only pose, expression, and clothing change to match the scene action. ' +
        'Characters: ' + charContextParts.join(' | ')
      : ''

    const sceneDirName = `scene_${sceneId}`
    const sceneDir = path.join(PROJECTS_DIR, projectId, 'scenes', sceneDirName)
    fs.mkdirSync(sceneDir, { recursive: true })

    const apiKey = store.get('nanoBananaApiKey') || process.env.NANO_BANANA_API_KEY
    const illustrationPath = await generateIllustration(scenePrompt, projectId, sceneId, sceneDir, apiKey, refPaths, characterContext)

    // Re-read project fresh before writing to avoid overwriting concurrent narration writes
    const freshProject1 = readProjectJson(projectId)
    const freshScene1 = freshProject1.scenes.find(s => s.id === sceneId)
    if (freshScene1) {
      freshScene1.illustrationPath = illustrationPath
      freshScene1.illustrationPrompt = scenePrompt  // save the clean scene prompt (not the char context)
      freshScene1.status = (freshScene1.narrationPath || freshScene1.recordingPath) ? 'ready' : 'illustration-done'
      writeProjectJson(projectId, freshProject1)
      return { success: true, data: freshScene1 }
    }

    writeProjectJson(projectId, project)
    return { success: true, data: scene }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// scene:generate-narration — Call TTS engine, save audio, update project.json
ipcMain.handle('scene:generate-narration', async (event, { projectId, sceneId }) => {
  try {
    const project = readProjectJson(projectId)
    mergeVoiceSettings(project)
    const scene = project.scenes.find(s => s.id === sceneId)
    if (!scene) throw new Error(`Scene not found: ${sceneId}`)

    const { generateNarration } = require('../src/utils/tts')

    const narratorKey = scene.narrator || project.style.activeNarrator
    const voiceProfile = { ...project.style[narratorKey] }
    if (!voiceProfile) throw new Error(`Voice profile not found: ${narratorKey}`)

    // Inject API keys into voiceProfile so tts.js doesn't need to read env directly
    if (voiceProfile.voiceEngine === 'elevenlabs') {
      voiceProfile.elevenLabsApiKey = store.get('elevenLabsApiKey') || process.env.ELEVENLABS_API_KEY || ''
    }

    const sceneDirName = `scene_${sceneId}`
    const sceneDir = path.join(PROJECTS_DIR, projectId, 'scenes', sceneDirName)
    fs.mkdirSync(sceneDir, { recursive: true })

    const outputPath = path.join(sceneDir, 'narration.mp3')
    const result = await generateNarration(scene.text, project.language, voiceProfile, outputPath)

    // Re-read project fresh before writing to avoid overwriting concurrent parallel narration writes
    const freshProject2 = readProjectJson(projectId)
    const freshScene2 = freshProject2.scenes.find(s => s.id === sceneId)
    if (freshScene2) {
      freshScene2.narrationPath = result.path
      freshScene2.duration = result.durationSeconds + 0.5
      freshScene2.status = freshScene2.illustrationPath ? 'ready' : 'narration-done'
      writeProjectJson(projectId, freshProject2)
      return { success: true, data: freshScene2 }
    }

    scene.narrationPath = result.path
    scene.duration = result.durationSeconds + 0.5
    scene.status = scene.illustrationPath ? 'ready' : 'narration-done'
    writeProjectJson(projectId, project)
    return { success: true, data: scene }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// scene:save-recording — Convert WebM recording to WAV with noise cancellation, save to scene folder
ipcMain.handle('scene:save-recording', async (event, { projectId, sceneId, audioBuffer }) => {
  try {
    const project = readProjectJson(projectId)
    const scene = project.scenes.find(s => s.id === sceneId)
    if (!scene) throw new Error(`Scene not found: ${sceneId}`)

    const projectDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'projects', projectId)
      : path.join(__dirname, '..', 'projects', projectId)
    const sceneDir = path.join(projectDir, 'scenes', `scene_${sceneId}`)
    fs.mkdirSync(sceneDir, { recursive: true })

    const tmpWebm = path.join(sceneDir, 'recording_tmp.webm')
    const wavPath = path.join(sceneDir, 'recording.wav')

    // Write raw WebM bytes
    fs.writeFileSync(tmpWebm, Buffer.from(audioBuffer))

    // Convert to 44100 Hz mono WAV with noise cancellation pipeline
    const resDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../resources')
    const ffmpegBin = fs.existsSync(path.join(resDir, 'ffmpeg.exe')) ? path.join(resDir, 'ffmpeg.exe') : 'ffmpeg'
    await new Promise((resolve, reject) => {
      let stderrBuf = ''
      const proc = spawn(ffmpegBin, [
        '-y', '-i', tmpWebm,
        '-af', 'highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ar', '44100', '-ac', '1',
        '-c:a', 'pcm_s16le',
        wavPath,
      ])
      proc.stderr.on('data', chunk => { stderrBuf += chunk.toString() })
      proc.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error(`FFmpeg exited ${code}: ${stderrBuf.slice(-300)}`))
      })
    })

    // Clean up temp WebM
    if (fs.existsSync(tmpWebm)) fs.unlinkSync(tmpWebm)

    // Get audio duration via ffprobe
    let duration = 0
    try {
      const fprobeBin = fs.existsSync(path.join(resDir, 'ffprobe.exe')) ? path.join(resDir, 'ffprobe.exe') : 'ffprobe'
      duration = await new Promise((resolve, reject) => {
        let out = ''
        const proc = spawn(fprobeBin, [
          '-v', 'error', '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          wavPath,
        ])
        proc.stdout.on('data', d => { out += d.toString() })
        proc.on('close', code => code === 0 ? resolve(parseFloat(out.trim()) || 0) : reject(new Error('ffprobe failed')))
      })
    } catch (_) { duration = 0 }

    // Re-read project fresh before writing (parallel-safe)
    const freshProject = readProjectJson(projectId)
    const freshScene = freshProject.scenes.find(s => s.id === sceneId)
    if (freshScene) {
      freshScene.recordingPath = wavPath
      freshScene.duration = duration + 0.5
      freshScene.status = freshScene.illustrationPath ? 'ready' : 'narration-done'
      writeProjectJson(projectId, freshProject)
      return { success: true, data: freshScene }
    }

    scene.recordingPath = wavPath
    scene.duration = duration + 0.5
    scene.status = scene.illustrationPath ? 'ready' : 'narration-done'
    writeProjectJson(projectId, project)
    return { success: true, data: scene }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// scene:update — Patch specific fields of a scene in project.json
ipcMain.handle('scene:update', async (event, { projectId, sceneId, updates }) => {
  try {
    const project = readProjectJson(projectId)
    const sceneIndex = project.scenes.findIndex(s => s.id === sceneId)
    if (sceneIndex === -1) throw new Error(`Scene not found: ${sceneId}`)

    project.scenes[sceneIndex] = { ...project.scenes[sceneIndex], ...updates }
    writeProjectJson(projectId, project)
    return { success: true, data: project.scenes[sceneIndex] }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// video:assemble — Run FFmpeg pipeline, stream progress via webContents.send
ipcMain.handle('video:assemble', async (event, { projectId }) => {
  try {
    const project = readProjectJson(projectId)
    const outputPath = path.join(PROJECTS_DIR, projectId, 'export', 'story_final.mp4')

    const { assembleVideo } = require('../src/utils/ffmpeg')

    await assembleVideo(project, project.scenes, outputPath, (percent) => {
      // Stream progress back to renderer
      event.sender.send('video:progress', { projectId, percent })
    })

    project.export.outputPath = outputPath
    writeProjectJson(projectId, project)

    return { success: true, data: { outputPath } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// shell:show-item-in-folder — Reveal a file in Windows Explorer
ipcMain.handle('shell:show-item-in-folder', (_event, filePath) => {
  shell.showItemInFolder(filePath)
})

// shell:open-path — Open a file with its default system application
ipcMain.handle('shell:open-path', (_event, filePath) => {
  shell.openPath(filePath)
})

// avatar:upload — Open file dialog, copy PNG to project avatars/ folder
ipcMain.handle('avatar:upload', async (event, { projectId, daughter }) => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Avatar PNG',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'No file selected' }
    }

    const sourcePath = result.filePaths[0]
    const ext = path.extname(sourcePath)
    const destPath = path.join(PROJECTS_DIR, projectId, 'avatars', `${daughter}${ext}`)

    fs.copyFileSync(sourcePath, destPath)

    // Update project.json
    const project = readProjectJson(projectId)
    project.style[daughter].avatarMode = 'fixed'
    project.style[daughter].avatarPath = destPath
    writeProjectJson(projectId, project)

    return { success: true, data: { avatarPath: destPath } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// avatar:upload-reference — Open file dialog, copy image to voices/ folder, save path to electron-store
ipcMain.handle('avatar:upload-reference', async (event, { daughter }) => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Character Reference Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'No file selected' }
    }

    const sourcePath = result.filePaths[0]
    const ext = path.extname(sourcePath)

    const voicesDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'voices')
      : path.join(__dirname, '..', 'voices')
    fs.mkdirSync(voicesDir, { recursive: true })

    const destPath = path.join(voicesDir, `${daughter}_character_reference${ext}`)
    fs.copyFileSync(sourcePath, destPath)

    // Save to electron-store so it persists globally across projects
    const daughters = store.get('daughters') || {}
    daughters[daughter] = { ...daughters[daughter], characterReferencePath: destPath }
    store.set('daughters', daughters)

    return { success: true, data: { characterReferencePath: destPath } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// character:list — Return the global character reference library
ipcMain.handle('character:list', async () => {
  try {
    return { success: true, data: store.get('characters', []) }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// character:add — File dialog → copy image → append to character library
ipcMain.handle('character:add', async (event, { name, description = '' }) => {
  try {
    // Normalise name first — trim whitespace before all checks
    const trimmedName = (name || '').trim()

    // Validate name
    if (!trimmedName) {
      return { success: false, error: 'Name is required' }
    }
    if (/[\\/:*?"<>|]/.test(trimmedName)) {
      return { success: false, error: 'Name contains invalid characters (\\ / : * ? " < > |)' }
    }
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(trimmedName)) {
      return { success: false, error: 'That name is reserved by Windows and cannot be used.' }
    }

    // Check uniqueness
    const existing = store.get('characters', [])
    if (existing.some(c => c.name === trimmedName)) {
      return { success: false, error: 'A character with that name already exists' }
    }

    // Open file dialog
    const result = await dialog.showOpenDialog({
      title: 'Select Character Reference Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'No file selected' }
    }

    const sourcePath = result.filePaths[0]
    const ext = path.extname(sourcePath)

    // Ensure voices/characters/ directory exists
    const voicesDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'voices')
      : path.join(__dirname, '..', 'voices')
    const charactersDir = path.join(voicesDir, 'characters')
    fs.mkdirSync(charactersDir, { recursive: true })

    // Copy image — re-read store fresh in case another add completed while dialog was open
    const destPath = path.join(charactersDir, `${trimmedName}_reference${ext}`)
    fs.copyFileSync(sourcePath, destPath)

    const freshExisting = store.get('characters', [])
    if (freshExisting.some(c => c.name === trimmedName)) {
      return { success: false, error: 'A character with that name already exists' }
    }
    const updated = [...freshExisting, { name: trimmedName, imagePath: destPath, description: description.trim() }]
    store.set('characters', updated)

    return { success: true, data: updated }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// character:remove — Remove a character from the library and delete their image file
ipcMain.handle('character:remove', async (event, { name }) => {
  try {
    const existing = store.get('characters', [])
    const entry = existing.find(c => c.name === name)
    const updated = existing.filter(c => c.name !== name)
    store.set('characters', updated)

    // Best-effort file deletion
    if (entry?.imagePath) {
      try { fs.unlinkSync(entry.imagePath) } catch (e) {
        console.warn(`[character:remove] Could not delete file: ${entry.imagePath}`, e.message)
      }
    }

    return { success: true, data: updated }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

function sanitizeCharacterName(name) {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_')
}

// characters:auto-discover — Scan story text, extract named characters via LM Studio,
// generate a portrait reference image for each new character, save to library.
ipcMain.handle('characters:auto-discover', async (event, { projectId }) => {
  try {
    const project = readProjectJson(projectId)
    const storyText = project.scenes.map(s => s.text).join('\n\n')

    const { extractCharacters } = require('../src/utils/lmStudio')
    const { generatePortrait } = require('../src/utils/nanoBanana')

    // Extract named characters from story using LM Studio
    let extracted = []
    try {
      extracted = await extractCharacters(storyText)
      console.log(`[auto-discover] LM Studio extracted ${extracted.length} character(s):`, extracted.map(c => c.name))
    } catch (err) {
      console.warn('[auto-discover] Character extraction failed:', err.message)
      return { success: true, data: { added: [], skipped: [], warning: `LM Studio unavailable: ${err.message}` } }
    }

    // Build set of already-known names (daughters + existing library) — skip these
    // Use lowercase for case-insensitive deduplication
    const daughters = store.get('daughters') || {}
    const knownNamesLower = new Set([
      ...Object.values(daughters).map(d => d.name).filter(Boolean).map(n => n.toLowerCase()),
      ...store.get('characters', []).map(c => c.name).filter(Boolean).map(n => n.toLowerCase()),
    ])

    const newChars = extracted.filter(c => c.name && !knownNamesLower.has(c.name.toLowerCase()))
    const skipped  = extracted.filter(c => c.name &&  knownNamesLower.has(c.name.toLowerCase())).map(c => c.name)

    if (newChars.length === 0) {
      return { success: true, data: { added: [], skipped } }
    }

    // Ensure characters directory exists
    const voicesDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'voices')
      : path.join(__dirname, '..', 'voices')
    const charactersDir = path.join(voicesDir, 'characters')
    fs.mkdirSync(charactersDir, { recursive: true })

    const apiKey = store.get('nanoBananaApiKey') || process.env.NANO_BANANA_API_KEY

    const added = []
    for (const char of newChars) {
      try {
        // Build a portrait prompt: neutral standing pose, plain background, clear face
        const portraitPrompt = [
          "children's book watercolor character portrait",
          `a character named ${char.name}`,
          char.description ? char.description : 'friendly child-appropriate appearance',
          'full body standing, facing viewer',
          'plain cream or white background',
          'clear friendly face, expressive eyes',
          'consistent character design for children\'s picture book',
          "safe for kids aged 4-10, bright and cheerful",
        ].join(', ')

        const destPath = path.join(charactersDir, `${sanitizeCharacterName(char.name)}_reference.png`)
        await generatePortrait(portraitPrompt, destPath, apiKey)
        added.push({ name: char.name, imagePath: destPath, description: char.description || '' })
        console.log(`[auto-discover] Portrait created for: ${char.name}`)
      } catch (err) {
        console.warn(`[auto-discover] Portrait failed for ${char.name}:`, err.message)
        // Still include the character in review — user can regenerate portrait manually
        added.push({ name: char.name, imagePath: null, description: char.description || '' })
      }
    }

    return { success: true, data: { added, skipped } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// characters:save-batch — Persist a confirmed list of discovered characters to the library
ipcMain.handle('characters:save-batch', async (event, { characters }) => {
  try {
    if (!Array.isArray(characters)) throw new Error('characters must be an array')
    const existing = store.get('characters', [])
    const existingLower = new Set(existing.map(c => c.name?.toLowerCase()).filter(Boolean))
    const toAdd = characters.filter(c => c.name && !existingLower.has(c.name.toLowerCase()))
    const updated = [...existing, ...toAdd]
    store.set('characters', updated)
    return { success: true, data: updated }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// character:regenerate-portrait — Regenerate portrait image with an updated description prompt
ipcMain.handle('character:regenerate-portrait', async (event, { name, description }) => {
  try {
    const { generatePortrait } = require('../src/utils/nanoBanana')
    const voicesDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'voices')
      : path.join(__dirname, '..', 'voices')
    const charactersDir = path.join(voicesDir, 'characters')
    fs.mkdirSync(charactersDir, { recursive: true })

    const apiKey = store.get('nanoBananaApiKey') || process.env.NANO_BANANA_API_KEY
    const portraitPrompt = [
      "children's book watercolor character portrait",
      `a character named ${name}`,
      description || 'friendly child-appropriate appearance',
      'full body standing, facing viewer',
      'plain cream or white background',
      'clear friendly face, expressive eyes',
      "consistent character design for children's picture book",
      "safe for kids aged 4-10, bright and cheerful",
    ].join(', ')

    const imagePath = path.join(charactersDir, `${sanitizeCharacterName(name)}_reference.png`)
    await generatePortrait(portraitPrompt, imagePath, apiKey)
    return { success: true, data: { name, imagePath } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// settings:get — Return value from electron-store
ipcMain.handle('settings:get', async (event, { key }) => {
  try {
    const value = key ? store.get(key) : store.store
    return { success: true, data: value }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// settings:set — Write key/value to electron-store
ipcMain.handle('settings:set', async (event, { key, value }) => {
  try {
    store.set(key, value)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ─── LM Studio IPC Handlers ───────────────────────────────────────────────────

// lmstudio:status — check whether LM Studio is running and a model is loaded
ipcMain.handle('lmstudio:status', async () => {
  try {
    const { checkLmStudioStatus } = require('../src/utils/lmStudio')
    const result = await checkLmStudioStatus()
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// lmstudio:generate-story — generate story scenes from an idea using local LLM
ipcMain.handle('lmstudio:generate-story', async (event, { idea, language, sceneCount }) => {
  try {
    const { generateStory } = require('../src/utils/lmStudio')
    const result = await generateStory({ idea, language, sceneCount })
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message, rawResponse: err.rawResponse }
  }
})

// lmstudio:generate-prompt — generate a single illustration prompt for a scene
ipcMain.handle('lmstudio:generate-prompt', async (event, { sceneText, language, storyTitle, illustrationStyle }) => {
  try {
    const { generateIllustrationPrompt } = require('../src/utils/lmStudio')
    const prompt = await generateIllustrationPrompt({ sceneText, language, storyTitle, illustrationStyle })
    return { success: true, data: prompt }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ─── XTTS Voice Clone Server ──────────────────────────────────────────────────

let xttsProcess = null
const XTTS_PORT = 5002

/** Check if a TCP port is already bound */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => { server.close(); resolve(false) })
    server.listen(port, '127.0.0.1')
  })
}

/** Convert WebM audio to cleaned WAV optimised for XTTS voice cloning.
 *  Pipeline: webm → 22050 Hz mono → highpass → afftdn denoise → loudnorm
 */
function convertWebmToWav(webmPath, wavPath) {
  return new Promise((resolve, reject) => {
    const resDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../resources')
    const ffmpegBin = (() => {
      const bundled = path.join(resDir, 'ffmpeg.exe')
      return fs.existsSync(bundled) ? bundled : 'ffmpeg'
    })()

    const proc = spawn(ffmpegBin, [
      '-y',
      '-i', webmPath,
      '-af', [
        'highpass=f=80',       // remove low-freq rumble
        'afftdn=nf=-25',       // FFT noise reduction (−25 dB noise floor)
        'loudnorm=I=-16:TP=-1.5:LRA=11', // EBU R128 loudness normalisation
      ].join(','),
      '-ar', '22050',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      wavPath,
    ])
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg webm→wav failed (code ${code})`)))
    proc.on('error', reject)
  })
}

/** Spawn the Python XTTS server and forward status events to renderer windows */
async function startXttsServer() {
  const inUse = await isPortInUse(XTTS_PORT)
  if (inUse) {
    console.log('[xtts] Port 5002 already bound — assuming server is running')
    return
  }

  // In dev, resources/ is a sibling of electron/. In production, use process.resourcesPath.
  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '../resources')
  const venvPython = path.join(resourcesDir, 'xtts_venv', 'Scripts', 'python.exe')
  const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python'

  const serverScript = path.join(resourcesDir, 'xtts_server.py')
  if (!fs.existsSync(serverScript)) {
    console.warn('[xtts] xtts_server.py not found — XTTS engine will be unavailable')
    return
  }

  xttsProcess = spawn(pythonBin, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  xttsProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim()
    console.log('[xtts-server]', msg)
    // Forward XTTS_STATUS:* lines to every open renderer window
    if (msg.includes('XTTS_STATUS:')) {
      const status = msg.split('XTTS_STATUS:')[1].split(':')[0]  // 'loading'|'ready'|'error'
      BrowserWindow.getAllWindows().forEach(w =>
        w.webContents.send('xtts:status-update', { status })
      )
    }
  })

  xttsProcess.stderr.on('data', (d) =>
    console.error('[xtts-server]', d.toString().slice(0, 500))
  )

  xttsProcess.on('exit', (code) => {
    console.log(`[xtts] Server exited (code=${code})`)
    xttsProcess = null
  })

  console.log(`[xtts] Server started (pid=${xttsProcess.pid}, python=${pythonBin})`)
}

function stopXttsServer() {
  if (xttsProcess) {
    xttsProcess.kill('SIGTERM')
    xttsProcess = null
    console.log('[xtts] Server stopped')
  }
}

// voice:save-sample — receive WebM ArrayBuffer from renderer, convert to WAV, save to userData/voices/
ipcMain.handle('voice:save-sample', async (event, { daughter, audioBuffer }) => {
  try {
    const voicesDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'voices')
      : path.join(__dirname, '..', 'voices')
    fs.mkdirSync(voicesDir, { recursive: true })

    // Write raw WebM bytes to a temp file
    const tmpWebm = path.join(voicesDir, `${daughter}_tmp.webm`)
    fs.writeFileSync(tmpWebm, Buffer.from(audioBuffer))

    // Convert to 22050 Hz mono WAV (optimal for XTTS)
    const wavPath = path.join(voicesDir, `${daughter}_reference.wav`)
    await convertWebmToWav(tmpWebm, wavPath)

    // Clean up temp WebM
    if (fs.existsSync(tmpWebm)) fs.unlinkSync(tmpWebm)

    // Persist the path in electron-store
    const current = store.get('daughters') || {}
    store.set('daughters', {
      ...current,
      [daughter]: { ...current[daughter], voiceSamplePath: wavPath },
    })

    return { success: true, data: { voiceSamplePath: wavPath } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// elevenlabs:clone-voice — record WebM → WAV → upload to ElevenLabs Instant Voice Clone API
ipcMain.handle('elevenlabs:clone-voice', async (event, { daughter, audioBuffer, name }) => {
  const tmpWebm = path.join(os.tmpdir(), `el_clone_${daughter}_${Date.now()}.webm`)
  const tmpWav  = tmpWebm.replace(/\.webm$/, '.wav')

  try {
    if (!['daughter1', 'daughter2'].includes(daughter)) {
      return { success: false, error: 'Invalid daughter key.' }
    }
    const apiKey = store.get('elevenLabsApiKey') || ''
    if (!apiKey) {
      return { success: false, error: 'ElevenLabs API key is not set. Go to Settings → API Keys.' }
    }
    const voiceName = (name || '').trim().slice(0, 100)
    if (!voiceName) {
      return { success: false, error: 'Set a daughter name before cloning.' }
    }

    // Write WebM buffer to temp file
    fs.writeFileSync(tmpWebm, Buffer.from(audioBuffer))

    // Convert WebM → WAV at 44100 Hz with voice cleaning pipeline
    await new Promise((resolve, reject) => {
      const resDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../resources')
      const ffmpegBin = fs.existsSync(path.join(resDir, 'ffmpeg.exe')) ? path.join(resDir, 'ffmpeg.exe') : 'ffmpeg'
      let stderrBuf = ''
      const proc = spawn(ffmpegBin, [
        '-y', '-i', tmpWebm,
        '-af', 'highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ar', '44100', '-ac', '1',
        tmpWav,
      ])
      proc.stderr.on('data', chunk => { stderrBuf += chunk.toString() })
      proc.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error(`FFmpeg exited ${code}: ${stderrBuf.slice(-300)}`))
      })
    })

    // Upload to ElevenLabs Instant Voice Clone
    const form = new FormData()
    form.append('name', voiceName)
    form.append('files', fs.createReadStream(tmpWav), { filename: 'sample.wav', contentType: 'audio/wav' })

    const response = await axios.post(
      'https://api.elevenlabs.io/v1/voices/add',
      form,
      { headers: { 'xi-api-key': apiKey, ...form.getHeaders() } }
    )

    const voiceId = response.data.voice_id

    // Persist voiceId to electron-store immediately so narration generation can use it
    const currentDaughters = store.get('daughters') || {}
    store.set('daughters', {
      ...currentDaughters,
      [daughter]: { ...currentDaughters[daughter], voiceId },
    })

    return { success: true, data: { voiceId } }

  } catch (err) {
    const detail = err.response?.data?.detail
    const msg = typeof detail === 'string' ? detail : (detail?.message || err.message)
    return { success: false, error: msg }
  } finally {
    if (fs.existsSync(tmpWebm)) fs.unlinkSync(tmpWebm)
    if (fs.existsSync(tmpWav))  fs.unlinkSync(tmpWav)
  }
})

// xtts:status — check if the Flask server is running and whether the model is loaded
ipcMain.handle('xtts:status', async () => {
  try {
    const axios = require('axios')
    const res = await axios.get(`http://127.0.0.1:${XTTS_PORT}/health`, { timeout: 2000 })
    return { success: true, data: res.data }
  } catch {
    return { success: true, data: { status: 'offline' } }
  }
})

// ─── Window Setup ─────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow file:// URLs from the Vite dev server (http://localhost:5173).
      // In production the app loads from file:// origin so this is not needed.
      webSecurity: app.isPackaged,
    },
    titleBarStyle: 'default',
    title: 'Story Studio',
  })

  // In dev, load from Vite dev server; in production, load built index.html
  // app.isPackaged is false in dev (electron .), true in production build
  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  // Serve local files via localfile:///absolute/path — uses net.fetch for proper
  // byte-range support (required for audio/video seeking in HTML media elements)
  protocol.handle('localfile', (request) => {
    const filePath = decodeURIComponent(request.url.slice('localfile:///'.length))
    return electronNet.fetch('file:///' + filePath.replace(/\\/g, '/'))
  })

  ensureProjectsDir()
  await initStore()

  // Grant microphone access to the renderer (needed for VoiceRecorder)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') callback(true)
    else callback(false)
  })

  // Start XTTS voice clone server (non-blocking — fails gracefully if Python not installed)
  startXttsServer().catch(err => console.warn('[xtts] Failed to start server:', err.message))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopXttsServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
