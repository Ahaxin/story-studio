# Character Review Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mandatory Step 3 to the New Story wizard that shows auto-discovered characters with their AI-generated portraits, lets the user edit names/descriptions and regenerate portraits, and saves confirmed characters to the global library.

**Architecture:** Three backend IPC handlers are modified/added in `electron/main.js`; two new React Query hooks are added in `useIPC.js`; `NewStoryModal.jsx` gains step 3 UI inline; `SceneList.jsx` gets a save-batch call after silent auto-discovery in Generate All.

**Tech Stack:** Electron 28 IPC (ipcMain.handle), React 18, React Query (useMutation), Zustand (closeNewStoryModal), Tailwind CSS, `localfile:///` custom protocol for portrait images.

**Spec:** `docs/superpowers/specs/2026-03-21-character-review-modal-design.md`

---

## File Map

| File | Change |
|---|---|
| `electron/main.js` | Modify `characters:auto-discover` (remove store.set, fix bugs, add sanitizer); add `characters:save-batch`; add `character:regenerate-portrait` |
| `electron/preload.js` | Expose `charactersSaveBatch` and `characterRegeneratePortrait` channels |
| `src/hooks/useIPC.js` | Add `useSaveDiscoveredCharacters` and `useRegeneratePortrait`; remove fire-and-forget from `useCreateProject.onSuccess`; remove `onSuccess` invalidation from `useAutoDiscoverCharacters` |
| `src/components/SceneList.jsx` | Call `useSaveDiscoveredCharacters` after auto-discover in `handleGenerateAllImages` |
| `src/components/NewStoryModal.jsx` | Add step 3 state + inline step 3 JSX; update header to "of 3"; wire character review flow |

---

## Task 1: Backend — sanitizer + fix auto-discover

**Files:**
- Modify: `electron/main.js` — lines ~724–808 (`characters:auto-discover` handler)

### What to do

**Step 1.1** — Add `sanitizeCharacterName` helper just above the `characters:auto-discover` handler comment (around line 723). This function is used by both auto-discover and regenerate-portrait (added in Task 2), so it must be defined at module scope before either handler:

```js
function sanitizeCharacterName(name) {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_')
}
```

**Step 1.2** — Fix the broken `skipped` filter (line 753 currently references `knownNames` which is undefined — should be `knownNamesLower`). Replace lines 752–753:

```js
const newChars = extracted.filter(c => c.name && !knownNamesLower.has(c.name.toLowerCase()))
const skipped  = extracted.filter(c => c.name &&  knownNamesLower.has(c.name.toLowerCase())).map(c => c.name)
```

**Step 1.3** — Use the sanitizer for the destination path (line 783). Replace:
```js
const destPath = path.join(charactersDir, `${char.name}_reference.png`)
```
with:
```js
const destPath = path.join(charactersDir, `${sanitizeCharacterName(char.name)}_reference.png`)
```

**Step 1.4** — Remove the entire store-persistence block inside the per-character loop (lines 786–794). Delete these lines entirely:
```js
// Add to library (re-read fresh to avoid races with concurrent calls)
const freshChars = store.get('characters', [])
if (!freshChars.some(c => c.name === char.name)) {
  store.set('characters', [...freshChars, {
    name: char.name,
    imagePath: destPath,
    description: char.description || '',
  }])
}
```
The `added.push(...)` line immediately after should remain.

- [ ] **Step 1.1** Add `sanitizeCharacterName` helper above the `characters:auto-discover` handler

- [ ] **Step 1.2** Fix the `skipped` filter to use `knownNamesLower` with `.toLowerCase()`

- [ ] **Step 1.3** Apply `sanitizeCharacterName` to the `destPath` construction

- [ ] **Step 1.4** Delete the store-persistence block (lines 786–794) from the per-character loop

- [ ] **Step 1.5** Verify manually: start app, create a story, check that `voices/characters/` portrait files are created but Settings → Character References still shows empty (nothing saved yet)

- [ ] **Step 1.6** Commit
```bash
git add electron/main.js
git commit -m "fix: remove auto-save from auto-discover; add sanitizeCharacterName; fix skipped filter"
```

---

## Task 2: Backend — add characters:save-batch and character:regenerate-portrait

**Files:**
- Modify: `electron/main.js` — add two new IPC handlers after the `characters:auto-discover` handler

### What to add (insert after the closing `})` of auto-discover, around line 808)

**`characters:save-batch` handler:**
```js
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
```

**`character:regenerate-portrait` handler:**
```js
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
```

Note: `sanitizeCharacterName` is defined at module scope in Task 1 and is available to both handlers.

- [ ] **Step 2.1** Add `characters:save-batch` handler after the auto-discover handler

- [ ] **Step 2.2** Add `character:regenerate-portrait` handler after save-batch

- [ ] **Step 2.3** Commit
```bash
git add electron/main.js
git commit -m "feat: add characters:save-batch and character:regenerate-portrait IPC handlers"
```

---

## Task 3: Preload + hooks

**Files:**
- Modify: `electron/preload.js`
- Modify: `src/hooks/useIPC.js`

### preload.js — expose two new channels

Add to the `contextBridge.exposeInMainWorld('electronAPI', { ... })` block, after the existing `characterAutoDiscover` line:

```js
charactersSaveBatch:         (args) => ipcRenderer.invoke('characters:save-batch', args),
characterRegeneratePortrait: (args) => ipcRenderer.invoke('character:regenerate-portrait', args),
```

### useIPC.js — three changes

**Change 1 — Remove `onSuccess` from `useAutoDiscoverCharacters`.**

`characters:auto-discover` no longer saves characters to the store, so the `onSuccess` query invalidation in this hook now fires spuriously (nothing has changed in the store). Remove the entire `onSuccess` block from `useAutoDiscoverCharacters`:
```js
// Remove this:
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ['characters'] })
},
```
Also remove the `const qc = useQueryClient()` line inside that hook if it's only used for `onSuccess`. Cache invalidation now happens in `useSaveDiscoveredCharacters.onSuccess` instead.

**Change 2 — Add two new hooks** after the closing `})` of `useAutoDiscoverCharacters`:

```js
/** Save a confirmed list of discovered characters to the global library. */
export function useSaveDiscoveredCharacters() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ characters }) => {
      const res = await api.charactersSaveBatch({ characters })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] })
    },
  })
}

/** Regenerate a single character portrait with an updated description. */
export function useRegeneratePortrait() {
  return useMutation({
    mutationFn: async ({ name, description }) => {
      const res = await api.characterRegeneratePortrait({ name, description })
      if (!res.success) throw new Error(res.error)
      return res.data  // { name, imagePath }
    },
  })
}
```

**Change 3 — Remove fire-and-forget from `useCreateProject.onSuccess`.**

In `useCreateProject` (around line 74), remove only the fire-and-forget block. The `onSuccess` should become:
```js
onSuccess: (project) => {
  qc.invalidateQueries({ queryKey: ['projects'] })
  setCurrentProject(project)
},
```

- [ ] **Step 3.1** Add two new channel exposures to `preload.js`

- [ ] **Step 3.2** Remove `onSuccess` from `useAutoDiscoverCharacters` (and its `useQueryClient()` if unused)

- [ ] **Step 3.3** Add `useSaveDiscoveredCharacters` and `useRegeneratePortrait` hooks after `useAutoDiscoverCharacters`

- [ ] **Step 3.4** Remove the fire-and-forget auto-discover block from `useCreateProject.onSuccess`

- [ ] **Step 3.5** Restart Electron. In DevTools console confirm: `typeof window.electronAPI.charactersSaveBatch === 'function'` returns `true`

- [ ] **Step 3.6** Commit
```bash
git add electron/preload.js src/hooks/useIPC.js
git commit -m "feat: expose save-batch and regenerate-portrait IPC; add React Query hooks"
```

---

## Task 4: SceneList — save batch after silent auto-discover

**Files:**
- Modify: `src/components/SceneList.jsx`

### What to change

Import the new hook:
```js
import { useGenerateIllustration, useGenerateNarration, useAutoDiscoverCharacters, useSaveDiscoveredCharacters } from '../hooks/useIPC'
```

Instantiate hook after existing ones:
```js
const saveDiscovered = useSaveDiscoveredCharacters()
```

Inside `handleGenerateAllImages`, replace:
```js
      const result = await autoDiscover.mutateAsync({ projectId: currentProject.id })
      setDiscoverResult(result)
      console.log(`[SceneList] Auto-discover: +${result.added.length} new, ${result.skipped.length} known`)
```
with:
```js
      const result = await autoDiscover.mutateAsync({ projectId: currentProject.id })
      setDiscoverResult(result)
      console.log(`[SceneList] Auto-discover: +${result.added.length} new, ${result.skipped.length} known`)
      if (result.added.length > 0) {
        await saveDiscovered.mutateAsync({ characters: result.added })
      }
```

- [ ] **Step 4.1** Add `useSaveDiscoveredCharacters` to SceneList import and instantiation

- [ ] **Step 4.2** Add `saveDiscovered.mutateAsync` call after `setDiscoverResult(result)`

- [ ] **Step 4.3** Manually verify: click "Generate All Images" on a story, confirm characters appear in Settings → Character References after generation completes

- [ ] **Step 4.4** Commit
```bash
git add src/components/SceneList.jsx
git commit -m "feat: save auto-discovered characters to library after Generate All"
```

---

## Task 5: NewStoryModal — Step 3 character review UI

**Files:**
- Modify: `src/components/NewStoryModal.jsx`

### 5a — New state + hook imports

Add to the import line at the top:
```js
import { useCreateProject, useGenerateStory, useLmStudioStatus, useAutoDiscoverCharacters, useSaveDiscoveredCharacters, useRegeneratePortrait } from '../hooks/useIPC'
```

Add new state variables inside `NewStoryModal()` after existing state declarations:
```js
// Step 3: character review
const [discoveredChars, setDiscoveredChars] = useState([])   // [{name, imagePath, description}]
const [isDiscovering, setIsDiscovering] = useState(false)
const [autoDiscoverError, setAutoDiscoverError] = useState(false)
const [regeneratingIndices, setRegeneratingIndices] = useState(new Set())
const [cardErrors, setCardErrors] = useState({})             // { [cardIndex]: string }
const [saveError, setSaveError] = useState('')
const [bustKeys, setBustKeys] = useState({})                 // { [cardIndex]: number } — forces img remount on regenerate
```

Instantiate new hooks after existing hook calls:
```js
const autoDiscover = useAutoDiscoverCharacters()
const saveDiscovered = useSaveDiscoveredCharacters()
const regeneratePortrait = useRegeneratePortrait()
```

- [ ] **Step 5.1** Update import line to include the three new hooks

- [ ] **Step 5.2** Add the seven new state variables

- [ ] **Step 5.3** Instantiate the three new hooks

### 5b — Update header subtitle + handleCreate

Update the header subtitle line (currently `Step {step} of 2 — ...`):
```js
Step {step} of 3 — {step === 1 ? 'Story details' : step === 2 ? 'Story content' : 'Characters'}
```

Replace the entire `handleCreate` function with:

```js
async function handleCreate() {
  setError('')
  setSaveError('')

  let rawScenes
  if (tab === 'paste') {
    if (!splitResult) return
    rawScenes = splitResult.map(text => ({ text, illustrationPrompt: '' }))
  } else {
    if (!aiResult) return
    rawScenes = aiResult.scenes
  }

  const coverScene = { text: name.trim(), index: 0, narrator, transition: 'zoom', illustrationPrompt: '' }
  const storyScenes = rawScenes.map((s, i) => ({
    text: s.text,
    illustrationPrompt: s.illustrationPrompt || '',
    index: i + 1,
    narrator,
    transition: i === rawScenes.length - 1 ? 'fade' : 'page-curl',
  }))
  const scenes = [coverScene, ...storyScenes]

  let project
  try {
    project = await createProject.mutateAsync({
      name: name.trim(),
      language,
      scenes,
      styleId: selectedStyle.id,
      illustrationStyle: selectedStyle.prompt,
    })
  } catch (err) {
    setError(err.message)
    return
  }

  // Advance to step 3 and run auto-discover
  setStep(3)
  setIsDiscovering(true)
  setAutoDiscoverError(false)
  setDiscoveredChars([])
  try {
    const result = await autoDiscover.mutateAsync({ projectId: project.id })
    // result.warning is set when LM Studio is offline (handler returns success:true with warning)
    if (result.warning) {
      setAutoDiscoverError(true)
    } else {
      setDiscoveredChars(result.added ?? [])
    }
  } catch (err) {
    setAutoDiscoverError(true)
  } finally {
    setIsDiscovering(false)
  }
}
```

- [ ] **Step 5.4** Update the header subtitle from "of 2" to "of 3" with step 3 label

- [ ] **Step 5.5** Replace `handleCreate` with the new version above

### 5c — Regenerate and save handlers

Add `handleRegenerate` and `handleSaveCharacters` functions inside `NewStoryModal()`:

```js
async function handleRegenerate(i) {
  setCardErrors(prev => { const e = { ...prev }; delete e[i]; return e })
  setRegeneratingIndices(prev => new Set([...prev, i]))
  try {
    const result = await regeneratePortrait.mutateAsync({
      name: discoveredChars[i].name,
      description: discoveredChars[i].description,
    })
    // Update imagePath with clean path (no query string — bust handled via React key)
    setDiscoveredChars(prev => prev.map((c, idx) =>
      idx === i ? { ...c, imagePath: result.imagePath } : c
    ))
    // Increment bust key to force img element remount (localfile:// doesn't support query strings)
    setBustKeys(prev => ({ ...prev, [i]: (prev[i] ?? 0) + 1 }))
  } catch (err) {
    setCardErrors(prev => ({ ...prev, [i]: 'Regeneration failed — try again' }))
  } finally {
    setRegeneratingIndices(prev => { const s = new Set(prev); s.delete(i); return s })
  }
}

async function handleSaveCharacters() {
  setSaveError('')
  try {
    // Strip any bust keys from imagePaths before saving (imagePath should be a clean file path)
    await saveDiscovered.mutateAsync({ characters: discoveredChars })
    closeNewStoryModal()
  } catch (err) {
    setSaveError('Failed to save characters — try again.')
  }
}
```

- [ ] **Step 5.6** Add `handleRegenerate(i)` function

- [ ] **Step 5.7** Add `handleSaveCharacters()` function

### 5d — Step 3 JSX

Inside the `<div className="px-8 py-6">` block, after the existing `{step === 2 && (...)}` block, add:

```jsx
{/* ── Step 3: Character review ── */}
{step === 3 && (
  <div className="space-y-4">
    {isDiscovering ? (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <svg className="animate-spin h-8 w-8 text-story-purple" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <p className="text-sm font-bold text-gray-500">Discovering characters…</p>
      </div>
    ) : autoDiscoverError ? (
      <div className="text-center py-8 space-y-2">
        <div className="text-4xl">⚠️</div>
        <p className="font-bold text-gray-700">Character detection unavailable</p>
        <p className="text-sm text-gray-400">LM Studio is offline. You can add characters manually in Settings → Character References.</p>
      </div>
    ) : discoveredChars.length === 0 ? (
      <div className="text-center py-8 space-y-2">
        <div className="text-4xl">🎭</div>
        <p className="font-bold text-gray-700">No characters found</p>
        <p className="text-sm text-gray-400">No named characters were detected. You can add them manually in Settings → Character References.</p>
      </div>
    ) : (
      <>
        <div>
          <h3 className="font-black text-gray-800 text-base">🎭 Meet the Characters</h3>
          <p className="text-xs text-gray-400 mt-0.5">Review the portraits before saving to your character library.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
          {discoveredChars.map((char, i) => (
            <div key={i} className="relative border-2 border-gray-200 rounded-2xl overflow-hidden">
              {/* Remove button */}
              <button
                onClick={() => setDiscoveredChars(prev => prev.filter((_, idx) => idx !== i))}
                className="absolute top-1.5 right-1.5 z-10 bg-white/80 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors"
                title="Remove character"
              >
                ×
              </button>
              {/* Portrait — key prop changes on regenerate to force remount */}
              <div className="aspect-square bg-gray-100 overflow-hidden">
                {char.imagePath ? (
                  <img
                    key={bustKeys[i] ?? 0}
                    src={`localfile:///${char.imagePath.replace(/\\/g, '/')}`}
                    alt={char.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl">🎭</div>
                )}
              </div>
              {/* Card body */}
              <div className="p-2 space-y-1.5">
                <input
                  type="text"
                  value={char.name}
                  onChange={e => setDiscoveredChars(prev => prev.map((c, idx) =>
                    idx === i ? { ...c, name: e.target.value } : c
                  ))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 focus:border-story-purple focus:outline-none"
                />
                <textarea
                  value={char.description}
                  onChange={e => setDiscoveredChars(prev => prev.map((c, idx) =>
                    idx === i ? { ...c, description: e.target.value } : c
                  ))}
                  rows={2}
                  placeholder="Appearance description…"
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 focus:border-story-purple focus:outline-none resize-none"
                />
                {cardErrors[i] && (
                  <p className="text-xs text-red-500">{cardErrors[i]}</p>
                )}
                <button
                  onClick={() => handleRegenerate(i)}
                  disabled={regeneratingIndices.has(i)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-story-purple hover:bg-purple-50 border border-story-purple/30 rounded-lg py-1 transition-colors disabled:opacity-50"
                >
                  {regeneratingIndices.has(i) ? (
                    <>
                      <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      Regenerating…
                    </>
                  ) : '↻ Regenerate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </>
    )}
    {saveError && (
      <p className="text-xs text-red-500 text-center">{saveError}</p>
    )}
  </div>
)}
```

- [ ] **Step 5.8** Add the step 3 JSX block after the `{step === 2 && (...)}` block

### 5e — Footer buttons for step 3

In the footer `<div className="px-8 pb-6 ...">`, add step 3 buttons after the `{step === 2 && (...)}` block.

The existing Cancel button already calls `closeNewStoryModal()` and acts as the dismiss action for step 3 — keep it as-is (visible on all steps). Add the Save button only for step 3:

```jsx
{step === 3 && (
  discoveredChars.length > 0 ? (
    <button
      onClick={handleSaveCharacters}
      disabled={isDiscovering || saveDiscovered.isPending}
      className="px-6 py-2.5 rounded-xl bg-story-purple text-white font-bold hover:bg-story-purple-dark transition-colors disabled:opacity-40"
    >
      {saveDiscovered.isPending ? 'Saving…' : `Save ${discoveredChars.length} Character${discoveredChars.length === 1 ? '' : 's'} →`}
    </button>
  ) : (
    <button
      onClick={closeNewStoryModal}
      className="px-6 py-2.5 rounded-xl bg-story-purple text-white font-bold hover:bg-story-purple-dark transition-colors"
    >
      Close &amp; Start Editing →
    </button>
  )
)}
```

Note: the existing Cancel button is the "skip/dismiss" action for step 3. Do **not** hide it. Do **not** add a separate Skip button.

- [ ] **Step 5.9** Add step 3 footer buttons (Save or Close depending on card count)

### 5f — End-to-end verification

- [ ] **Step 5.10** Restart Electron (main.js changes require restart; src/ changes hot-reload via Vite)

- [ ] **Step 5.11** Create a new story with paste text (LM Studio online). Verify:
  - Header shows "Step 1 of 3", "Step 2 of 3", "Step 3 of 3"
  - After clicking "Create Story", spinner appears with "Discovering characters…"
  - Step 3 shows character cards
  - Portrait images load (not broken)

- [ ] **Step 5.12** Edit a card's description and click "↻ Regenerate". Verify portrait updates without a broken image.

- [ ] **Step 5.13** Remove a card with ×. Verify the count in "Save N Characters →" decrements.

- [ ] **Step 5.14** Click "Save N Characters →". Open Settings → Character References. Verify characters appear with correct name, image, and description.

- [ ] **Step 5.15** Create another story with the same characters. Verify they are skipped (not duplicated) in the library.

- [ ] **Step 5.16** Test with LM Studio offline. Verify the offline message appears and "Cancel" closes the modal cleanly.

- [ ] **Step 5.17** Test "Cancel" on step 3. Verify no characters are saved.

- [ ] **Step 5.18** Commit
```bash
git add src/components/NewStoryModal.jsx
git commit -m "feat: add step 3 character review to NewStoryModal wizard"
```

---

## Task 6: Final integration

- [ ] **Step 6.1** Full flow: create story → step 3 → save characters → open editor → Generate All → verify no duplicate characters appear in Settings

- [ ] **Step 6.2** Test Write for Me flow: generate a story with AI, confirm step 3 still appears

- [ ] **Step 6.3** Commit any remaining doc/config changes
```bash
git add .
git commit -m "docs: finalize character review modal implementation"
```
