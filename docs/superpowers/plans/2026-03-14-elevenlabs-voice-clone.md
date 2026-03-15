# ElevenLabs In-App Voice Cloning — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to record a voice sample in-app and clone it to ElevenLabs with one click, auto-populating the daughter's Voice ID.

**Architecture:** New `elevenlabs:clone-voice` IPC handler converts WebM → WAV and POSTs to ElevenLabs `/v1/voices/add`, returning the voice_id. VoiceRecorder gets an injectable `onSave` prop so the ElevenLabs path reuses the existing recording UI without modifying the XTTS path. A new `ElevenLabsVoiceSection` component replaces the current static Voice ID field when the daughter's engine is `elevenlabs`.

**Tech Stack:** Electron 28, React 18, axios, form-data (^4.0.0 — already in package.json), React Query useMutation

**Spec:** `docs/superpowers/specs/2026-03-14-elevenlabs-voice-clone-design.md`

---

## Chunk 1: IPC + Preload

### Task 1: Add `elevenlabs:clone-voice` IPC handler

**Files:**
- Modify: `electron/main.js` — add require statements + IPC handler
- Modify: `electron/preload.js` — expose new IPC method

---

- [ ] **Step 1: Add top-level requires to main.js**

  Open `electron/main.js`. At the top where other `require` calls live, add all three — unconditionally. Note: `axios` may already appear inline inside the `xtts:status` handler body (scoped there only), but it is NOT in scope for the new handler. Add all three at module scope:

  ```js
  const os = require('os')
  const axios = require('axios')
  const FormData = require('form-data')
  ```

  Both `axios` and `form-data` are in `package.json` `dependencies` (verified: `"axios": "^1.6.7"`, `"form-data": "^4.0.0"`).

- [ ] **Step 2: Add the IPC handler to main.js**

  Find the block of `ipcMain.handle(...)` calls (after `voice:save-sample`). Add this handler:

  ```js
  // elevenlabs:clone-voice — record WebM → WAV → upload to ElevenLabs Instant Voice Clone API
  ipcMain.handle('elevenlabs:clone-voice', async (event, { daughter, audioBuffer, name }) => {
    const tmpWebm = path.join(os.tmpdir(), `el_clone_${daughter}_${Date.now()}.webm`)
    const tmpWav  = tmpWebm.replace(/\.webm$/, '.wav')

    try {
      // Validate inputs
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
        const ffmpegPath = getFfmpegPath()
        let stderrBuf = ''
        const proc = spawn(ffmpegPath, [
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

      return { success: true, data: { voiceId: response.data.voice_id } }

    } catch (err) {
      const detail = err.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail?.message || err.message)
      return { success: false, error: msg }
    } finally {
      if (fs.existsSync(tmpWebm)) fs.unlinkSync(tmpWebm)
      if (fs.existsSync(tmpWav))  fs.unlinkSync(tmpWav)
    }
  })
  ```

  > **Note:** `getFfmpegPath`, `spawn`, `fs`, and `path` are already in scope in main.js. `store` is the electron-store instance.

- [ ] **Step 3: Expose the handler in preload.js**

  Open `electron/preload.js`. Inside `contextBridge.exposeInMainWorld('electronAPI', { ... })`, add alongside the other voice methods:

  ```js
  elevenLabsCloneVoice: (args) => ipcRenderer.invoke('elevenlabs:clone-voice', args),
  ```

- [ ] **Step 4: Verify Electron starts without errors**

  Run: `npm run electron` (assuming Vite is already running on 5173, or use `npm run dev`).

  Expected: Electron opens, no crash in terminal, no `ReferenceError` for `os` or `FormData`.

- [ ] **Step 5: Commit**

  ```bash
  git add electron/main.js electron/preload.js
  git commit -m "feat: add elevenlabs:clone-voice IPC handler"
  ```

---

## Chunk 2: React Query Hook

### Task 2: Add `useElevenLabsCloneVoice` mutation hook

**Files:**
- Modify: `src/hooks/useIPC.js` — add hook at the end of the ElevenLabs/XTTS section

---

- [ ] **Step 1: Add the hook**

  Open `src/hooks/useIPC.js`. After the `useXttsStatus` export (end of file), add:

  ```js
  /** Upload a recorded voice sample to ElevenLabs Instant Voice Clone. Returns { voiceId }. */
  export function useElevenLabsCloneVoice() {
    return useMutation({
      mutationFn: async (args) => {
        const res = await api.elevenLabsCloneVoice(args)
        if (!res.success) throw new Error(res.error)
        return res.data  // { voiceId }
      },
    })
  }
  ```

- [ ] **Step 2: Verify hot-reload**

  The Vite dev server should accept the change without errors. Check the browser console for any import errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/hooks/useIPC.js
  git commit -m "feat: add useElevenLabsCloneVoice mutation hook"
  ```

---

## Chunk 3: VoiceRecorder — injectable onSave

### Task 3: Make VoiceRecorder support a custom save handler

**Files:**
- Modify: `src/components/VoiceRecorder.jsx`

The existing XTTS flow must be completely unchanged. The `onSave` prop is purely additive.

---

- [ ] **Step 1: Add the three new props to the function signature**

  Open `src/components/VoiceRecorder.jsx`. Change the function signature from:

  ```js
  export default function VoiceRecorder({ daughter, existingSample, language = 'nl-NL', onSampleSaved }) {
  ```

  to:

  ```js
  export default function VoiceRecorder({ daughter, existingSample, language = 'nl-NL', onSampleSaved, onSave, onCloneDone, processingLabel }) {
  ```

- [ ] **Step 2: Update the processing state JSX**

  Find the processing state render block. It currently contains the literal string `Converting recording… (one moment)`. Replace that literal with:

  ```jsx
  {processingLabel || 'Converting recording… (one moment)'}
  ```

- [ ] **Step 3: Update the `onstop` inner body**

  In the `recorder.onstop` async handler, find the existing block that starts with:
  ```js
  const blob = new Blob(chunksRef.current, { type: mimeType })
  const arrayBuffer = await blob.arrayBuffer()

  const res = await window.electronAPI.voiceSaveSample({ daughter, audioBuffer: arrayBuffer })
  if (!res.success) throw new Error(res.error)

  setSavedPath(res.data.voiceSamplePath)
  setState('done')
  onSampleSaved?.(res.data.voiceSamplePath)
  ```

  Replace it with:

  ```js
  const blob = new Blob(chunksRef.current, { type: mimeType })
  const arrayBuffer = await blob.arrayBuffer()

  if (onSave) {
    const result = await onSave(arrayBuffer)  // result = { voiceId }
    setState('done')
    onCloneDone?.(result)
  } else {
    const res = await window.electronAPI.voiceSaveSample({ daughter, audioBuffer: arrayBuffer })
    if (!res.success) throw new Error(res.error)
    setSavedPath(res.data.voiceSamplePath)
    setState('done')
    onSampleSaved?.(res.data.voiceSamplePath)
  }
  ```

  > The surrounding `try { ... } catch (err) { setErrorMsg(err.message); setState('error') }` must remain unchanged — the new branch sits inside it.

- [ ] **Step 4: Verify XTTS flow is unbroken**

  In the running app, go to Settings → Daughter 1 (XTTS engine). The VoiceRecorder should look and behave exactly as before. Record a short sample — it should still process and show the green "Voice sample recorded" banner.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/VoiceRecorder.jsx
  git commit -m "feat: add injectable onSave/onCloneDone props to VoiceRecorder"
  ```

---

## Chunk 4: ElevenLabsVoiceSection UI

### Task 4: Add ElevenLabsVoiceSection and wire it into DaughterSection

**Files:**
- Modify: `src/pages/Settings.jsx`

---

- [ ] **Step 1: Import the new hook**

  At the top of `src/pages/Settings.jsx`, add `useElevenLabsCloneVoice` to the existing import:

  ```js
  import { useSettings, useSaveSettings, useXttsStatus, useUploadCharacterReference, useElevenLabsCloneVoice } from '../hooks/useIPC'
  ```

- [ ] **Step 2: Add the `ElevenLabsVoiceSection` component**

  In `Settings.jsx`, after the `XttsVoiceSection` function definition (around line 268), add:

  ```jsx
  // ── ElevenLabs voice cloning section within a daughter card ──────────────────

  function ElevenLabsVoiceSection({ daughterKey, profile, onUpdate }) {
    const cloneVoice = useElevenLabsCloneVoice()
    const [copied, setCopied] = useState(false)

    const nameEmpty = !(profile.name || '').trim()

    const handleSave = async (arrayBuffer) => {
      cloneVoice.reset()
      return cloneVoice.mutateAsync({
        daughter: daughterKey,
        audioBuffer: arrayBuffer,
        name: profile.name,
      })
    }

    function handleCloneDone({ voiceId }) {
      onUpdate('voiceId', voiceId)
    }

    async function handleCopy() {
      await navigator.clipboard.writeText(profile.voiceId || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }

    return (
      <div className="space-y-3">
        {/* Guard: name must be set */}
        {nameEmpty && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <p className="text-xs font-bold text-amber-800">Set a name above before cloning.</p>
          </div>
        )}

        {/* Recorder */}
        <div className={nameEmpty ? 'opacity-40 pointer-events-none' : ''}>
          <VoiceRecorder
            daughter={daughterKey}
            existingSample={null}
            language="nl-NL"
            onSave={handleSave}
            onCloneDone={handleCloneDone}
            processingLabel="Uploading to ElevenLabs…"
          />
        </div>

        {/* Success banner */}
        {cloneVoice.isSuccess && profile.voiceId && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-green-800">Voice cloned!</p>
              <p className="text-xs text-green-600 font-mono truncate">{profile.voiceId}</p>
            </div>
            <button
              onClick={handleCopy}
              className="text-xs text-green-700 font-bold px-2 py-1 rounded-lg hover:bg-green-100 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {/* Manual Voice ID override */}
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
            Or paste an existing ElevenLabs Voice ID
          </label>
          <input
            type="text"
            value={profile.voiceId || ''}
            onChange={e => onUpdate('voiceId', e.target.value)}
            placeholder="21m00Tcm4TlvDq8ikWAM"
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 focus:border-story-purple focus:outline-none font-mono"
          />
        </div>

        <p className="text-xs text-gray-400 leading-relaxed">
          Record 10–20 seconds of your daughter speaking naturally.
          ElevenLabs will clone her voice — remember to click Save Settings after cloning.
        </p>
      </div>
    )
  }
  ```

- [ ] **Step 3: Swap ElevenLabsVoiceSection into DaughterSection**

  In `DaughterSection`, find the block that switches on `profile.voiceEngine`:

  ```jsx
  {profile.voiceEngine === 'elevenlabs' ? (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
        ElevenLabs Voice ID
        ...
      </label>
      <input ... />
      <p ...>Clone your daughter's voice in ElevenLabs, then paste the voice ID here.</p>
    </div>
  ) : (
    <XttsVoiceSection ... />
  )}
  ```

  Replace the entire `elevenlabs` branch (the `<div>...</div>` block) with:

  ```jsx
  {profile.voiceEngine === 'elevenlabs' ? (
    <ElevenLabsVoiceSection
      daughterKey={daughterKey}
      profile={profile}
      onUpdate={onUpdate}
    />
  ) : (
    <XttsVoiceSection
      daughterKey={daughterKey}
      profile={profile}
      xttsStatus={xttsStatus}
      onSampleSaved={onSampleSaved}
    />
  )}
  ```

- [ ] **Step 4: Manual end-to-end test**

  1. Open Settings → Daughter 1
  2. Set engine to **ElevenLabs**
  3. Verify the recorder appears (same UI as XTTS), manual Voice ID field is below it
  4. Leave name blank — verify amber "Set a name above" warning appears and recorder is disabled
  5. Type a name → warning disappears, recorder becomes active
  6. Click **Record Voice Sample**, speak for 10s, click **Stop Recording**
  7. Status shows "Uploading to ElevenLabs…"
  8. On success: green "Voice cloned!" banner with the voice_id appears; manual field auto-populates
  9. Click **Copy** → paste somewhere to verify the ID
  10. Click **Save Settings** → reload app → verify voice_id is persisted
  11. Switch engine back to XTTS → XTTS recorder still works normally

- [ ] **Step 5: Test error path**

  1. Clear the ElevenLabs API key in Settings, save, then try to clone
  2. Expected: recorder shows red error state with "ElevenLabs API key is not set. Go to Settings → API Keys."
  3. Restore the API key

- [ ] **Step 6: Commit**

  ```bash
  git add src/pages/Settings.jsx
  git commit -m "feat: add ElevenLabsVoiceSection with in-app voice cloning"
  ```

---

## Done

All four tasks complete. The ElevenLabs voice cloning flow is fully wired:
- Record in-app → convert to 44100 Hz WAV → POST to ElevenLabs → voice_id auto-saved
- XTTS recording flow is unchanged
- Manual Voice ID field preserved for users with existing ElevenLabs voices
