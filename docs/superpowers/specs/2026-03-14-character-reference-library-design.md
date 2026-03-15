# Character Reference Library — Design Spec
**Date:** 2026-03-14
**Status:** Approved

## Overview

Add a global "Character Reference Library" that lets users associate a reference image with any named character. When generating an illustration for a scene, the system detects which character names appear in the scene text (exact match) and passes all their reference images to the Nano Banana API alongside the narrator's existing reference image.

## Scope

- Global — stored in electron-store, shared across all projects
- Exact string match (case-sensitive) against `scene.text`
- All matching character images are passed (not just first)

## Data Model

### electron-store

Add new top-level key. Must add `characters: []` to the `defaults` object in `initStore()`:

```json
{
  "characters": [
    { "name": "Grandma", "imagePath": "F:/PROJECTS/story-studio/voices/characters/Grandma_reference.png" },
    { "name": "The Dragon", "imagePath": "F:/PROJECTS/story-studio/voices/characters/The Dragon_reference.jpg" }
  ]
}
```

- Type: array of `{ name: string, imagePath: string }`
- Default: `[]` added to `ElectronStore` constructor `defaults` block in `initStore()`
- Order is preserved (insertion order)
- Names must be unique (enforced by IPC)
- Names must not contain Windows-illegal path characters: `\ / : * ? " < > |` (enforced by IPC)
- File storage: `voices/characters/` folder
  - Dev: `path.join(__dirname, '..', 'voices', 'characters')`
  - Prod: `path.join(app.getPath('userData'), 'voices', 'characters')`

## Files to Update

1. `electron/main.js` — three new IPC handlers + update `scene:generate-illustration` call site + add `characters: []` to `initStore()` defaults
2. `electron/preload.js` — expose three new IPC channels via `contextBridge`
3. `src/hooks/useIPC.js` — three new hooks
4. `src/pages/Settings.jsx` — new Character References section
5. `src/utils/nanoBanana.js` — update `generateIllustration()` signature

## IPC Handlers (`electron/main.js`)

All handlers return `{ success: true, data: ... }` or `{ success: false, error: '...' }` — consistent with existing handler pattern.

### `character:list`
- Returns `{ success: true, data: store.get('characters', []) }`

### `character:add`
- Input: `{ name: string }`
- Validation (return `{ success: false, error: '...' }` if any fail):
  - Name is non-empty
  - Name contains no Windows-illegal characters (`\ / : * ? " < > |`)
  - Name is not already in store (unique check)
- Ensures directory: `fs.mkdirSync(charactersDir, { recursive: true })`
- Opens file dialog filtered to PNG, JPG, JPEG, WebP
- If user cancels dialog: return `{ success: false, error: 'No file selected' }` (matches existing cancel pattern in `avatar:upload-reference`)
- Copies selected file to `voices/characters/{name}_reference{ext}`
- Appends `{ name, imagePath }` to store array and saves
- Returns `{ success: true, data: updatedArray }`

### `character:remove`
- Input: `{ name: string }`
- Filters store array to remove entry where `entry.name === name`; if name not found, filter is a no-op (silent success — idempotent)
- Deletes the image file from disk (wrapped in try/catch — failure only logged, does not throw)
- Returns `{ success: true, data: updatedArray }`

### `preload.js` additions

Add to `contextBridge.exposeInMainWorld` block:

```js
characterList:   ()     => ipcRenderer.invoke('character:list'),
characterAdd:    (args) => ipcRenderer.invoke('character:add', args),
characterRemove: (args) => ipcRenderer.invoke('character:remove', args),
```

## Settings UI (`src/pages/Settings.jsx`)

New **"Character References"** section below the existing daughter sections.

### Layout
- Section header: "Character References"
- Subheading: "Add reference images for named characters. Names are matched exactly in scene text."
- While `useCharacterList` is loading: show a spinner (same pattern as settings load guard elsewhere)
- If `useCharacterList` errors: show a brief error message
- Grid of character cards (similar style to existing daughter cards):
  - Thumbnail (60×60, `localfile:///` protocol)
  - Character name
  - Delete button (×) — calls `useRemoveCharacter`
- "Add Character" button at bottom of list

### Add Character Flow
1. User clicks "Add Character" → inline form appears: text input for name + "Choose Image" button
2. "Choose Image" is disabled until name is non-empty
3. On "Choose Image": calls `useAddCharacter` with `{ name }`
4. If IPC returns `error: 'No file selected'` (dialog cancelled): form stays open with name intact, no error shown
5. If IPC returns any other error (duplicate name, illegal characters, etc.): show error message inline, form stays open
6. On success: inline form closes, character list refreshes via query invalidation

### Hooks (`src/hooks/useIPC.js`)

Uses React Query v5 object-argument form (consistent with existing hooks):

```js
export function useCharacterList() {
  return useQuery({
    queryKey: ['characters'],
    queryFn: async () => {
      const res = await api.characterList()
      if (!res.success) throw new Error(res.error)
      return res.data  // character array
    }
  })
}

export function useAddCharacter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args) => {
      const res = await api.characterAdd(args)
      if (!res.success) throw new Error(res.error)
      return res.data  // updated array
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] })
    }
  })
}

export function useRemoveCharacter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args) => {
      const res = await api.characterRemove(args)
      if (!res.success) throw new Error(res.error)
      return res.data  // updated array
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] })
    }
  })
}
```

The Settings UI component calls `useAddCharacter().mutateAsync(...)` inside a `try/catch`. If `err.message === 'No file selected'` (dialog cancelled), the catch block returns silently without setting any error state — keeping the inline form open. Any other error is set in local state and shown as an inline message below the form.

## Illustration Generation Changes

### `electron/main.js` — `scene:generate-illustration` handler

After building the prompt and resolving the narrator's `characterReferencePath`, replace the existing single-path call:

```js
// Collect all reference images
const refPaths = []
if (narrator?.characterReferencePath) refPaths.push(narrator.characterReferencePath)

const allCharacters = store.get('characters', [])
for (const char of allCharacters) {
  if (scene.text.includes(char.name) && char.imagePath) {
    refPaths.push(char.imagePath)
  }
}

// Updated call — was: generateIllustration(..., referenceImagePath)
const illustrationPath = await generateIllustration(
  prompt, projectId, sceneId, sceneDir, apiKey, refPaths
)
```

### `src/utils/nanoBanana.js` — `generateIllustration()`

Change last parameter from `referenceImagePath` (string) to `referenceImagePaths` (string array):

```js
// Before:
async function generateIllustration(prompt, projectId, sceneId, sceneDir, apiKey, referenceImagePath)

// After:
async function generateIllustration(prompt, projectId, sceneId, sceneDir, apiKey, referenceImagePaths)
// referenceImagePaths: string[] — empty array means no reference images
```

Build `parts` array — loop all paths, push each as `inlineData` before the text prompt:

```js
const parts = []
for (const refPath of referenceImagePaths) {
  if (refPath && fs.existsSync(refPath)) {
    const ext = path.extname(refPath).toLowerCase().slice(1)
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : 'image/png'
    const imageData = fs.readFileSync(refPath).toString('base64')
    parts.push({ inlineData: { mimeType, data: imageData } })
  }
}
parts.push({ text: prompt })
```

Missing or non-existent files are silently skipped (logged to console, scene generation continues).

## File Layout

```
voices/
  characters/
    Grandma_reference.png
    The Dragon_reference.jpg
    ...
  daughter1_reference.wav
  daughter2_reference.wav
  ...
```

## Error Handling Summary

| Situation | Behaviour |
|---|---|
| Empty name | UI disables "Choose Image"; IPC also validates and returns error |
| Illegal characters in name | IPC returns error; UI shows inline message, form stays open |
| Duplicate name | IPC returns error; UI shows inline message, form stays open |
| File dialog cancelled | IPC returns `{ success: false, error: 'No file selected' }`; UI suppresses error, form stays open |
| File delete failure on remove | Logged only; store entry still removed |
| Missing reference file at generation time | Silently skipped; scene generation continues |
| Non-existent name on remove | No-op (idempotent filter), returns success |

## Out of Scope

- Fuzzy / case-insensitive matching
- Per-project character libraries
- Automatic character detection from text
- Character name rename (delete + re-add)
