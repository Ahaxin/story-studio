# Story Studio — Project Brain

## Current Status
All phases complete and running. App boots cleanly with `npm run dev`.
XTTS venv installed at `resources/xtts_venv/`. XTTS auto-starts with Electron — do not start manually.
ElevenLabs in-app voice cloning implemented and working (2026-03-14).
Begonia (daughter1) switched to ElevenLabs engine with cloned voice.

## Stack
- Electron 28 + React 18 + Vite 5 (Windows desktop)
- Nano Banana API → illustration per scene
- XTTS v2 (local voice clone) + ElevenLabs (online voice clone)
- FFmpeg (bundled) → video assembly
- All secrets from `.env` — never hardcode keys

## Architecture
```
electron/
  main.js       — IPC handlers, XTTS server spawn/kill, mic permissions
  preload.js    — contextBridge: exposes window.electronAPI to renderer
src/
  App.jsx       — shell: Sidebar + page router + NewStoryModal overlay
  main.jsx      — React + QueryClient entry point
  index.css     — Tailwind base
  store/
    useStore.js — Zustand: navigation, selectedSceneId, generatingScenes, reorder
  hooks/
    useIPC.js   — React Query wrappers for all IPC calls
  components/
    Sidebar.jsx         — project list, + New Story, Export/Settings nav
    NewStoryModal.jsx   — 2-step wizard: name/language → paste + split preview
    SceneList.jsx       — scrollable scene cards, status badges, Generate All
    SceneEditor.jsx     — illustration, text, narrator, audio, transitions, avatar
    VoiceRecorder.jsx   — MediaRecorder UI for XTTS voice sample capture
  pages/
    StoryEditor.jsx     — two-panel layout + top bar
    ExportPage.jsx      — pre-flight checklist, settings, progress bar
    Settings.jsx        — API keys, daughter profiles, XTTS recorder + status
  utils/
    schema.js           — createProject() + createScene() factories
    storySplitter.js    — splitByParagraph(), 5–15 scene enforcement
    nanoBanana.js       — illustration API client + buildScenePrompt()
    tts.js              — Piper / Google Cloud TTS / XTTS v2 engines
    ffmpeg.js           — filter_complex video assembler + getAudioDuration()
resources/
  ffmpeg.exe            — download from gyan.dev (not in git)
  ffprobe.exe           — bundled with ffmpeg download
  piper.exe             — download from github.com/rhasspy/piper/releases
  piper/models/         — .onnx + .onnx.json voice model files
  xtts_server.py        — Flask server wrapping Coqui XTTS v2
  xtts_venv/            — Python venv with TTS + flask + torch (not in git)
  requirements.txt      — pip deps for XTTS
projects/               — F:/PROJECTS/story-studio/projects/{id}/ in dev (not in repo)
voices/                 — F:/PROJECTS/story-studio/voices/ in dev (not in repo)
.env                    — API keys (git-ignored)
```

## IPC Channels (all in electron/main.js)
| Channel | Purpose |
|---|---|
| `story:create` | Create project folder + project.json |
| `story:load` | Load project.json by ID |
| `story:list` | List all saved projects |
| `story:rename` | Update name + rebuild cover scene illustrationPrompt |
| `story:delete` | Remove project folder entirely |
| `scene:generate-illustration` | Call Nano Banana, save PNG |
| `scene:generate-narration` | Call TTS engine, save MP3 |
| `scene:update` | Patch scene fields in project.json |
| `video:assemble` | Run FFmpeg pipeline, stream progress |
| `shell:show-item-in-folder` | Reveal file in Windows Explorer via shell |
| `avatar:upload` | File dialog → copy PNG to project |
| `avatar:upload-reference` | File dialog → save character reference image to voices/ |
| `settings:get` / `settings:set` | electron-store read/write |
| `voice:save-sample` | WebM → WAV (22050Hz mono) via FFmpeg |
| `elevenlabs:clone-voice` | WebM → WAV (44100Hz) → POST /v1/voices/add → returns voiceId, writes to store |
| `xtts:status` | Health check GET /health on port 5002 |

## IPC Events (main → renderer)
- `video:progress` — `{ projectId, percent }` during export
- `xtts:status-update` — `{ status }` as model loads/fails

## TTS Engines
| Engine | Key | Notes |
|---|---|---|
| XTTS v2 | `voiceEngine: 'xtts'` | Local Flask server port 5002, needs voice sample WAV |
| ElevenLabs | `voiceEngine: 'elevenlabs'` | REST API, needs `elevenLabsApiKey` + `voiceId` in electron-store |

## XTTS Language Codes
- `nl-NL` → `'nl'`  (Dutch)
- `zh-CN` → `'zh-cn'` (Mandarin)
Never pass BCP-47 codes directly to XTTS — it has its own code list.

## Project JSON Structure
```
{
  id, name, language, createdAt,
  style: {
    illustrationStyle,
    daughter1: { name, voiceEngine, voiceId, voiceSamplePath, avatarMode, avatarPath, characterPrompt },
    daughter2: { ... },
    activeNarrator: 'daughter1'
  },
  scenes: [ { id, index, text, wordCount, illustrationPath, illustrationPrompt,
               narrationPath, narrator, transition, duration, status } ],
  export: { resolution, fps, outputPath }
}
```

## electron-store Defaults
```
nanoBananaApiKey, elevenLabsApiKey,
daughters.daughter1: { name, voiceEngine, voiceId, voiceSamplePath, avatarMode, characterPrompt, characterReferencePath }
daughters.daughter2: { ... }
```
Voice sample WAVs saved to: `F:/PROJECTS/story-studio/voices/` in dev, `userData/voices/` in production

## Rules
- One paragraph = one scene/page (min 5, max 15)
- Languages: nl-NL and zh-CN
- All file I/O through Electron IPC — never call Node APIs from React directly
- React Query for async state, Zustand for UI state
- Tailwind CSS + Nunito font throughout
- Never use localStorage — use electron-store
- All resource paths: use `app.isPackaged` to switch between dev and production paths
- All utils are CommonJS (`require`) — do NOT convert to ESM

## Build Commands
- `npm run dev` — Vite + Electron dev mode (starts XTTS server automatically)
- `npm run build` — production build + NSIS installer
- `npm run electron` — Electron only (requires Vite already on 5173)
- Restart only Electron: `cmd //c "taskkill /IM electron.exe /F"` then `npm run electron`
- Kill all Python (XTTS): `cmd //c "taskkill /IM python.exe /F"`
- Check XTTS port: `cmd //c "netstat -ano | findstr :5002"`

## Piper Model Files Needed
- `resources/piper/models/nl_NL-mls-medium.onnx` + `.onnx.json`
- `resources/piper/models/zh_CN-huayan-medium.onnx` + `.onnx.json`
- Download from: huggingface.co/rhasspy/piper-voices

## Nano Banana API (Illustration)
- "Nano Banana" = Google AI Studio Gemini, model `gemini-3.1-flash-image-preview`
- Base URL: `https://generativelanguage.googleapis.com/v1beta/`
- Key: `nanoBananaApiKey` in electron-store — read via `store.get()` in IPC handler, NOT `process.env`
- Response: inline base64 image at `candidates[0].content.parts[0].inlineData.data`
- Only `aspectRatio` is valid in `imageConfig` — `thinkingLevel`/`imageSize` cause 400 errors
- Scene index 0 = book cover prompt (title + decorative border); index 1+ = inner page frame style

## XTTS Python Dependency Pins (do not upgrade)
- `transformers==4.39.3` — 4.40+ removed BeamSearchScorer used by TTS 0.22.0
- `huggingface_hub==0.21.4` — newer incompatible with transformers 4.39.3
- `tokenizers==0.15.2` — newer breaks transformers 4.39.3
- PyTorch 2.6+ `weights_only=True` default breaks model load — monkey-patched in xtts_server.py

## Critical Bug Patterns (avoid these)
- Scene IDs: `story:create` IPC MUST run scenes through `createScene()` — plain objects get no UUID → all scenes appear selected simultaneously
- Daughter profiles: always call `mergeVoiceSettings(project)` on `story:create` and `story:load` — project.json defaults are blank
- `scene:generate-narration`: MUST call `mergeVoiceSettings(project)` before reading voiceProfile — raw project.json lacks voiceSamplePath
- API keys: all keys saved to electron-store via Settings UI — pass from `store.get()` to util functions, never rely on `process.env` alone
- Parallel IPC writes race: `scene:generate-narration` and `scene:generate-illustration` re-read project.json FRESH immediately before `writeProjectJson()` — prevents concurrent parallel calls overwriting each other's paths (symptom: UI shows 'ready' but export pre-flight reports missing narration)
- `story:rename` MUST rebuild cover scene `illustrationPrompt` (index 0) — it embeds the story title via `buildScenePrompt()`

## Local File URLs (Renderer)
- NEVER use `file://` URLs — use `localfile:///` custom protocol instead (works from localhost:5173)
- Registered via `protocol.handle('localfile', req => electronNet.fetch('file:///'+...))` in main.js
- `protocol.registerSchemesAsPrivileged([{scheme:'localfile',...}])` MUST be called BEFORE `app.whenReady()`
- Import Electron's `net` as `electronNet` — avoids conflict with Node's built-in `net` module
- `webSecurity: app.isPackaged` — false in dev so renderer can load localfile:// assets
- Path conversion: `` `localfile:///${path.replace(/\\/g, '/')}` ``

## XTTS torchaudio 2.9+ Fix
- torchaudio 2.9+ requires TorchCodec for both `load` and `save` — torchcodec is NOT installed
- Fix: fully replace `torchaudio.load` AND `torchaudio.save` in xtts_server.py with soundfile implementations BEFORE importing TTS
- `backend` kwarg is accepted but silently IGNORED — partial patching does NOT work, must fully replace the functions
- Confirm patch active: look for `[xtts] torchaudio.load/save patched` in server startup output

## Voice Sample Processing
- Recording pipeline (webm→wav): `highpass=f=80, afftdn=nf=-25, loudnorm=I=-16:TP=-1.5:LRA=11`
- Additional `loudnorm` applied at synthesis time in xtts_server.py
- Dev data paths use local folder (not userData) to avoid Windows username spaces breaking paths:
  `app.isPackaged ? path.join(app.getPath('userData'), x) : path.join(__dirname, '..', x)`

## Animation Types (FFmpeg filter_complex)
- `page-curl` → xfade `diagtl` (closest built-in approximation)
- `slide`     → xfade `slideright`
- `fade`      → xfade `fade`
- `zoom`      → xfade `smoothup`

## FFmpeg filter_complex Rules
- `pad` filter uses colon separators: `pad=${W}:${H}:x:y:color` — NOT `pad=1920x1080:...` (`x` format invalid here, only `scale` accepts it)
- Font for `drawtext` on Windows: use `font=Arial` (fontconfig name) NOT `fontfile=C:/Windows/...` — Windows drive-letter colon breaks FFmpeg 8.x filter parsing regardless of escaping method (single-quote, `\:`, etc.). For Chinese: `font=Microsoft YaHei`
- Chinese (zh-CN): use `msyh.ttc` / `simsun.ttc`; Dutch (nl-NL): `arial.ttf`
- `drawtext` text: escape `%` → `\%`, replace newlines with space; truncate to ~80 chars (no line wrapping)
- Always include FFmpeg stderr tail in thrown Error so it shows in the UI

## ElevenLabs In-App Voice Cloning
- `elevenlabs:clone-voice` IPC: WebM → WAV (44100Hz + cleaning pipeline) → POST /v1/voices/add → voiceId
- voiceId written to electron-store IMMEDIATELY by IPC (no need to click Save Settings first)
- VoiceRecorder: injectable `onSave(arrayBuffer)`/`onCloneDone({voiceId})`/`processingLabel` props — XTTS path unchanged
- `ElevenLabsVoiceSection` in Settings.jsx replaces static Voice ID field when engine = 'elevenlabs'
- `useElevenLabsCloneVoice()` mutation hook in useIPC.js
- `audioBust` state in SceneEditor forces audio element remount after narration regeneration
- FFmpeg path resolved inline (no `getFfmpegPath()` function — does not exist)
- Top-level requires in main.js: `os`, `axios`, `FormData` (form-data npm package)

## Next Steps / Known Improvements
- Configure Daughter 2 profile (name, voice engine, voiceId)
- Test character reference image consistency across generated illustrations
- Generate All only runs on `pending` scenes — add "Regenerate failed" for `illustration-done`/`narration-done`
- Subtitle display: `drawtext` is single-line only — consider wrapped text box overlay
- Test full Dutch + Chinese end-to-end export
