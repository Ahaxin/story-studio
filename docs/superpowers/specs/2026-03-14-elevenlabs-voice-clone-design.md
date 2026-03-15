# ElevenLabs In-App Voice Cloning — Design Spec
Date: 2026-03-14

## Overview

Add an in-app voice recording + upload flow for ElevenLabs Instant Voice Cloning. When a daughter profile uses the ElevenLabs engine, the user can record a voice sample directly in Story Studio, which is uploaded to the ElevenLabs API to create a permanent cloned voice. The returned `voice_id` is auto-saved to the daughter's profile local state; the user then clicks Save Settings to persist it.

## Goals

- Record a voice sample in-app and clone it via ElevenLabs in one action
- Named after the daughter's display name in the profile
- Clone is permanent in the user's ElevenLabs account
- Manual Voice ID override field remains available for users who already have a voice in ElevenLabs
- No file upload from disk — in-app recording only

## Architecture

### 1. VoiceRecorder — make `onSave` injectable

**File:** `src/components/VoiceRecorder.jsx`

Add three optional props:
- `onSave(arrayBuffer: ArrayBuffer) => Promise<{ voiceId: string }>` — custom async handler; replaces the default `voice:save-sample` IPC call when provided
- `onCloneDone({ voiceId: string }) => void` — called after a successful clone (only when `onSave` is provided)
- `processingLabel?: string` — optional override for the processing state message

**Backward compatibility:** `onSampleSaved` continues to receive a `string` path and is only called on the XTTS path (when `onSave` is absent). No existing callsites change.

**Two changes in VoiceRecorder:**

**a) Processing state JSX** — replace the hardcoded string:
```jsx
// Before:
Converting recording… (one moment)
// After:
{processingLabel || 'Converting recording… (one moment)'}
```

**b) `onstop` handler inner body** — the `if (onSave)` branch replaces only the inner body of the existing try/catch; the surrounding `catch` → `setErrorMsg` / `setState('error')` is unchanged:

```js
const blob = new Blob(chunksRef.current, { type: mimeType })
const arrayBuffer = await blob.arrayBuffer()

if (onSave) {
  const result = await onSave(arrayBuffer)   // result = { voiceId }
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

### 2. ElevenLabsVoiceSection — new component

**File:** `src/pages/Settings.jsx`

Replaces the current static Voice ID text input when `voiceEngine === 'elevenlabs'`.

Props received from `DaughterSection`: `daughterKey`, `profile`, `onUpdate(field, value)`.

**`onSave` closure** — passes a closure (not `mutateAsync` directly) to inject `daughter` and `name`. Calls `cloneVoice.reset()` before `mutateAsync` so the stale success banner is cleared when the user starts a new recording:

```js
const cloneVoice = useElevenLabsCloneVoice()

const handleSave = async (arrayBuffer) => {
  cloneVoice.reset()
  return cloneVoice.mutateAsync({
    daughter: daughterKey,
    audioBuffer: arrayBuffer,
    name: profile.name,
  })
  // mutateAsync returns res.data = { voiceId } on success, throws on failure
}
```

`handleSave` is passed as `onSave`. `onCloneDone` is: `({ voiceId }) => onUpdate('voiceId', voiceId)`.

**Note on unsaved changes:** if the user clones a voice and navigates away without clicking Save, the voiceId is lost. This matches all other daughter profile fields and is acceptable behavior.

**VoiceRecorder usage in this component:**
```jsx
<VoiceRecorder
  daughter={daughterKey}
  existingSample={null}
  language="nl-NL"
  onSave={handleSave}
  onCloneDone={({ voiceId }) => onUpdate('voiceId', voiceId)}
  processingLabel="Uploading to ElevenLabs…"
/>
```
(`language="nl-NL"` is hardcoded — Settings has no project context, the prompt is just a reading guide.)

**UI layout (top to bottom):**
1. **Guard**: if `profile.name` is empty, show inline warning "Set a name above before cloning" and disable recorder
2. **VoiceRecorder** as above
3. **Success banner** (shown when `cloneVoice.isSuccess`): "Voice cloned! ID: `<voiceId>`" + copy button using `navigator.clipboard.writeText(voiceId)`
4. **Manual Voice ID field**: always visible, labeled "Or paste an existing ElevenLabs Voice ID" — pre-populated with `profile.voiceId`, editable via `onUpdate('voiceId', value)`

### 3. useIPC.js — new mutation hook

**File:** `src/hooks/useIPC.js`

```js
export function useElevenLabsCloneVoice() {
  return useMutation({
    mutationFn: async (args) => {
      const res = await window.electronAPI.elevenLabsCloneVoice(args)
      if (!res.success) throw new Error(res.error)
      return res.data  // { voiceId }
    },
  })
}
```

Errors thrown here are caught by VoiceRecorder's existing `catch` block and displayed in the error state UI.

### 4. IPC handler — `elevenlabs:clone-voice`

**File:** `electron/main.js`

```
ipcMain.handle('elevenlabs:clone-voice', async (event, { daughter, audioBuffer, name }) => { ... })
```

**Requires** (add at top of handler or top of main.js if not already present):
```js
const os = require('os')
const FormData = require('form-data')  // npm package 'form-data', not the browser global
```

**Steps:**
1. Validate `daughter` is in `['daughter1', 'daughter2']` — error if not
2. Read `elevenLabsApiKey` from `store.get('elevenLabsApiKey')` — error if missing or empty
3. Validate `name` is non-empty; trim and truncate to 100 characters
4. Write `audioBuffer` (WebM) to a uniquely named temp file:
   `path.join(os.tmpdir(), \`el_clone_${daughter}_${Date.now()}.webm\`)`
5. Convert temp WebM → WAV using an inline FFmpeg spawn (do NOT call `convertWebmToWav` — that function hard-codes 22050 Hz which degrades quality for ElevenLabs). Use `-ar 44100 -ac 1` and the cleaning pipeline:
   `highpass=f=80, afftdn=nf=-25, loudnorm=I=-16:TP=-1.5:LRA=11`
   WAV path: same base name, `.wav` extension.
   Collect FFmpeg stderr into a buffer (`proc.stderr.on('data', chunk => stderrBuf += chunk)`); on non-zero exit, throw with stderr content in the message.
6. POST multipart to `https://api.elevenlabs.io/v1/voices/add` using `axios` + `form-data`:
   ```js
   const form = new FormData()
   form.append('name', name)
   form.append('files', fs.createReadStream(wavPath), { filename: 'sample.wav', contentType: 'audio/wav' })
   const response = await axios.post(url, form, {
     headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
   })
   ```
   **`form.getHeaders()` must be spread** so multipart boundary is included.
7. Extract `voice_id` from `response.data.voice_id`
8. Return `{ success: true, data: { voiceId: response.data.voice_id } }`

**Temp file cleanup:** `finally` block deletes both `.webm` and `.wav` temp files.

**Error cases** (all return `{ success: false, error: '<message>' }`):
- Invalid `daughter` → `'Invalid daughter key.'`
- Missing API key → `'ElevenLabs API key is not set. Go to Settings → API Keys.'`
- Missing name → `'Set a daughter name before cloning.'`
- FFmpeg non-zero exit → include collected stderr
- ElevenLabs API error → extract:
  ```js
  const detail = err.response?.data?.detail
  const msg = typeof detail === 'string' ? detail : detail?.message
  return { success: false, error: msg || err.message }
  ```

### 5. preload.js — expose new IPC

**File:** `electron/preload.js`

Add to `contextBridge.exposeInMainWorld`:
```js
elevenLabsCloneVoice: (args) => ipcRenderer.invoke('elevenlabs:clone-voice', args),
```

## Data Flow

```
User records in ElevenLabsVoiceSection
  → VoiceRecorder.onSave(arrayBuffer)
  → handleSave closure: cloneVoice.reset() then mutateAsync({ daughter, audioBuffer, name })
  → IPC: elevenlabs:clone-voice
  → main.js:
      validate inputs (daughter, apiKey, name)
      write temp .webm
      FFmpeg 44100 Hz WAV + cleaning pipeline (stderr collected)
      POST /v1/voices/add (axios + form-data + form.getHeaders())
      parse voice_id
      delete temp files (finally)
      return { success: true, data: { voiceId } }
  → mutationFn unwraps res.data → returns { voiceId }
  → VoiceRecorder: setState('done'), onCloneDone({ voiceId })
  → ElevenLabsVoiceSection: onUpdate('voiceId', voiceId) → local React state
  → User clicks Save Settings → handleSave() → settingsSet({ key: 'daughters', value: daughters })
```

## Files Changed

| File | Change |
|---|---|
| `src/components/VoiceRecorder.jsx` | Add `onSave`, `onCloneDone`, `processingLabel` props; update processing JSX; branch in `onstop` handler |
| `src/pages/Settings.jsx` | Add `ElevenLabsVoiceSection`; swap into `DaughterSection` when engine is `elevenlabs` |
| `src/hooks/useIPC.js` | Add `useElevenLabsCloneVoice()` mutation hook |
| `electron/main.js` | Add `elevenlabs:clone-voice` IPC handler |
| `electron/preload.js` | Expose `elevenLabsCloneVoice` on `window.electronAPI` |

## Out of Scope

- Deleting/replacing voices in ElevenLabs from within the app
- Uploading existing audio files from disk
- Listing existing ElevenLabs voices
- Google TTS or Piper changes
