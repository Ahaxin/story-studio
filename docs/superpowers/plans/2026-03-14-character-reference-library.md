# Character Reference Library Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global character reference image library so any named character can have a reference image that is automatically included in illustration generation when their name appears in the scene text.

**Architecture:** Store the library as a `characters` array in electron-store. Three new IPC handlers manage CRUD. The `generateIllustration()` function is updated to accept an array of reference image paths instead of a single string. The `scene:generate-illustration` handler collects all matching character reference paths (narrator + library matches) and passes them as the array. A new "Character References" section is added to Settings.jsx.

**Tech Stack:** Electron IPC, electron-store, CommonJS, React 18, React Query v5 (object-argument form), Tailwind CSS, Zustand

**Spec:** `docs/superpowers/specs/2026-03-14-character-reference-library-design.md`

---

## Chunk 1: Backend — IPC handlers, preload, and nanoBanana

### Task 1: Add `characters` default to electron-store

**Files:**
- Modify: `electron/main.js:27-39` (the `initStore()` function)

- [ ] **Step 1: Add `characters: []` to the `defaults` object in `initStore()`**

  In `electron/main.js`, locate `initStore()`. The current `defaults` object ends at the `daughters` key. Add `characters: []` after it:

  ```js
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
  ```

- [ ] **Step 2: Restart Electron to confirm store initialises without error**

  Run: `cmd //c "taskkill /IM electron.exe /F"` then `npm run electron`
  Expected: App boots cleanly, no crash or store error in the terminal.

---

### Task 2: Add three `character:*` IPC handlers to `main.js`

**Files:**
- Modify: `electron/main.js` — add three new handlers after the `avatar:upload-reference` handler (around line 407)

- [ ] **Step 1: Add the `character:list` handler**

  After the closing `})` of the `avatar:upload-reference` handler, add:

  ```js
  // character:list — Return the global character reference library
  ipcMain.handle('character:list', async () => {
    try {
      return { success: true, data: store.get('characters', []) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
  ```

- [ ] **Step 2: Add the `character:add` handler immediately after**

  ```js
  // character:add — File dialog → copy image → append to character library
  ipcMain.handle('character:add', async (event, { name }) => {
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
      const updated = [...freshExisting, { name: trimmedName, imagePath: destPath }]
      store.set('characters', updated)

      return { success: true, data: updated }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
  ```

- [ ] **Step 3: Add the `character:remove` handler immediately after**

  ```js
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
  ```

- [ ] **Step 4: Restart Electron and verify the three handlers register without error**

  Run: `cmd //c "taskkill /IM electron.exe /F"` then `npm run electron`
  Expected: App boots cleanly. No IPC registration errors in terminal.

---

### Task 3: Expose the three channels in `preload.js`

**Files:**
- Modify: `electron/preload.js:6-42`

- [ ] **Step 1: Add the three character bindings to `contextBridge.exposeInMainWorld`**

  In `electron/preload.js`, find the last entry before the closing `})` of `exposeInMainWorld` — it is `offXttsStatusUpdate`. Add after it:

  ```js
  // Character reference library
  characterList:   ()     => ipcRenderer.invoke('character:list'),
  characterAdd:    (args) => ipcRenderer.invoke('character:add', args),
  characterRemove: (args) => ipcRenderer.invoke('character:remove', args),
  ```

- [ ] **Step 2: Restart Electron and verify `window.electronAPI.characterList` is defined in the renderer**

  In the app's DevTools console (Ctrl+Shift+I), run:
  ```js
  window.electronAPI.characterList().then(console.log)
  ```
  Expected: `{ success: true, data: [] }` (empty array on first run)

---

### Task 4: Update `generateIllustration()` to accept an array of reference paths

**Files:**
- Modify: `src/utils/nanoBanana.js:83-110`

- [ ] **Step 1: Replace the single-path parameter with an array parameter**

  In `src/utils/nanoBanana.js`, replace the `generateIllustration` function signature and `parts`-building block.

  Replace:
  ```js
  /**
   * Generate an illustration via Nano Banana (Gemini image generation API).
   * Returns the local file path of the saved PNG.
   *
   * @param {string} referenceImagePath — optional path to a character reference PNG/JPG.
   *   When provided, the image is sent as an inline part so Gemini can match the character's look.
   */
  async function generateIllustration(prompt, projectId, sceneId, sceneDir, apiKey, referenceImagePath = '') {
    if (!apiKey) apiKey = process.env.NANO_BANANA_API_KEY
    if (!apiKey) {
      throw new Error('Nano Banana API key is not set. Go to Settings → API Keys to add it.')
    }

    console.log(`[nanoBanana] Generating illustration for scene ${sceneId}`)
    console.log(`[nanoBanana] Prompt: ${prompt.substring(0, 100)}...`)

    // Build parts array — reference image first (if available), then the text prompt
    const parts = []

    if (referenceImagePath && fs.existsSync(referenceImagePath)) {
      const ext = path.extname(referenceImagePath).toLowerCase().replace('.', '')
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png'
      const imageData = fs.readFileSync(referenceImagePath).toString('base64')
      parts.push({ inlineData: { mimeType, data: imageData } })
      console.log(`[nanoBanana] Including character reference image: ${path.basename(referenceImagePath)}`)
    }

    parts.push({ text: prompt })
  ```

  With:
  ```js
  /**
   * Generate an illustration via Nano Banana (Gemini image generation API).
   * Returns the local file path of the saved PNG.
   *
   * @param {string[]} referenceImagePaths — array of paths to character reference images (PNG/JPG/WebP).
   *   Each image is sent as an inline part before the text prompt so Gemini can match character looks.
   *   Pass an empty array when no reference images are needed.
   */
  async function generateIllustration(prompt, projectId, sceneId, sceneDir, apiKey, referenceImagePaths = []) {
    if (!apiKey) apiKey = process.env.NANO_BANANA_API_KEY
    if (!apiKey) {
      throw new Error('Nano Banana API key is not set. Go to Settings → API Keys to add it.')
    }

    console.log(`[nanoBanana] Generating illustration for scene ${sceneId}`)
    console.log(`[nanoBanana] Prompt: ${prompt.substring(0, 100)}...`)

    // Build parts array — reference images first (if any), then the text prompt
    const parts = []

    for (const refPath of referenceImagePaths) {
      if (refPath && fs.existsSync(refPath)) {
        const ext = path.extname(refPath).toLowerCase().replace('.', '')
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : 'image/png'
        const imageData = fs.readFileSync(refPath).toString('base64')
        parts.push({ inlineData: { mimeType, data: imageData } })
        console.log(`[nanoBanana] Including reference image: ${path.basename(refPath)}`)
      } else if (refPath) {
        console.warn(`[nanoBanana] Reference image not found, skipping: ${refPath}`)
      }
    }

    parts.push({ text: prompt })
  ```

- [ ] **Step 2: Verify the file has no syntax errors by restarting Electron**

  Run: `cmd //c "taskkill /IM electron.exe /F"` then `npm run electron`
  Expected: App boots. The CommonJS `require('../src/utils/nanoBanana')` in the IPC handler would throw on syntax error.

---

### Task 5: Update the `scene:generate-illustration` call site in `main.js`

**Files:**
- Modify: `electron/main.js:204-247` (the `scene:generate-illustration` handler)

- [ ] **Step 1: Replace the single `referenceImagePath` collection and call with array collection**

  In the `scene:generate-illustration` handler, find and replace this exact two-line block:

  ```js
  const narrator = project.style[scene.narrator] || project.style[project.style.activeNarrator]
  const referenceImagePath = narrator?.characterReferencePath || ''
  ```

  Replace it with:

  ```js
  const narrator = project.style[scene.narrator] || project.style[project.style.activeNarrator]

  // Collect all reference images: narrator reference + any character library matches
  const refPaths = []
  if (narrator?.characterReferencePath) refPaths.push(narrator.characterReferencePath)

  const allCharacters = store.get('characters', [])
  for (const char of allCharacters) {
    if (char.imagePath && scene.text.includes(char.name)) {
      refPaths.push(char.imagePath)
    }
  }

  if (refPaths.length > 0) {
    console.log(`[generate-illustration] Using ${refPaths.length} reference image(s):`, refPaths.map(p => path.basename(p)))
  }
  ```

  Then find the `generateIllustration` call line further down in the same handler:

  ```js
  const illustrationPath = await generateIllustration(prompt, projectId, sceneId, sceneDir, apiKey, referenceImagePath)
  ```

  Replace it with:

  ```js
  const illustrationPath = await generateIllustration(prompt, projectId, sceneId, sceneDir, apiKey, refPaths)
  ```

- [ ] **Step 2: Restart Electron and do an end-to-end illustration generation smoke test**

  In the app:
  1. Open any existing project with at least one scene
  2. Click "Generate Illustration" on a scene
  Expected: Illustration generates successfully. Terminal shows `[generate-illustration] Using N reference image(s)` (or no log if no references set). No errors.

- [ ] **Step 3: Commit Chunk 1**

  ```bash
  git add electron/main.js electron/preload.js src/utils/nanoBanana.js
  git commit -m "feat: add character reference library backend (IPC handlers + generateIllustration array)"
  ```

---

## Chunk 2: Frontend — Hooks and Settings UI

### Task 6: Add three character hooks to `useIPC.js`

**Files:**
- Modify: `src/hooks/useIPC.js` — add after the last existing hook

- [ ] **Step 1: Add the three hooks at the bottom of `useIPC.js`**

  Open `src/hooks/useIPC.js`. After the last exported hook (scroll to the end of the file), add:

  ```js
  // ── Character Reference Library hooks ─────────────────────────────────────────

  /** Return the global character reference library as an array of { name, imagePath }. */
  export function useCharacterList() {
    return useQuery({
      queryKey: ['characters'],
      queryFn: async () => {
        const res = await api.characterList()
        if (!res.success) throw new Error(res.error)
        return res.data  // { name, imagePath }[]
      },
    })
  }

  /** Add a named character to the library (opens file dialog for image selection). */
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
      },
    })
  }

  /** Remove a character from the library by name and delete their image file. */
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
      },
    })
  }
  ```

  Note: `api` is the alias used throughout `useIPC.js` for `window.electronAPI`. Confirm the alias name at the top of the file — it is `const api = window.electronAPI`. If the file uses `window.electronAPI` directly instead of an alias, use `window.electronAPI` in the hooks.

- [ ] **Step 2: Verify imports are present**

  `useQuery`, `useMutation`, and `useQueryClient` must be imported at the top. They already are — confirm the import line includes all three:
  ```js
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  ```

- [ ] **Step 3: Verify the hooks are reachable from the renderer (hot-reload check)**

  With Vite dev server running, saving `useIPC.js` should hot-reload without errors. Check the browser DevTools console — no import errors expected.

---

### Task 7: Add "Character References" section to `Settings.jsx`

**Files:**
- Modify: `src/pages/Settings.jsx` — add new section + two new sub-components

- [ ] **Step 1: Add `useCharacterList`, `useAddCharacter`, `useRemoveCharacter` to the import line**

  Find the existing import at the top of `Settings.jsx`:
  ```js
  import { useSettings, useSaveSettings, useXttsStatus, useUploadCharacterReference, useElevenLabsCloneVoice } from '../hooks/useIPC'
  ```

  Replace with:
  ```js
  import { useSettings, useSaveSettings, useXttsStatus, useUploadCharacterReference, useElevenLabsCloneVoice, useCharacterList, useAddCharacter, useRemoveCharacter } from '../hooks/useIPC'
  ```

- [ ] **Step 2: Insert the `<CharacterReferencesSection />` into the Settings JSX**

  In the `Settings()` return, find the `{/* Save button */}` block:
  ```jsx
  {/* Save button */}
  <div className="flex justify-end pb-4">
  ```

  Insert the new section directly above the save button block:
  ```jsx
  {/* Character reference library */}
  <CharacterReferencesSection />

  {/* Save button */}
  <div className="flex justify-end pb-4">
  ```

- [ ] **Step 3: Add the `CharacterReferencesSection` component**

  Add the following after the `CharacterReferenceUpload` component (around line 427) and before the `// ── Shared sub-components` comment:

  ```jsx
  // ── Character Reference Library ───────────────────────────────────────────────

  function CharacterReferencesSection() {
    const { data: characters = [], isLoading, isError } = useCharacterList()
    const addCharacter = useAddCharacter()
    const removeCharacter = useRemoveCharacter()

    const [showAddForm, setShowAddForm] = useState(false)
    const [newName, setNewName] = useState('')
    const [addError, setAddError] = useState('')
    const [removingName, setRemovingName] = useState(null)

    async function handleAdd() {
      if (!newName.trim()) return
      setAddError('')
      addCharacter.reset()
      try {
        await addCharacter.mutateAsync({ name: newName.trim() })
        setNewName('')
        setShowAddForm(false)
      } catch (err) {
        // Suppress "No file selected" — user cancelled the dialog, keep form open
        if (err.message !== 'No file selected') {
          setAddError(err.message)
        }
      }
    }

    async function handleRemove(name) {
      setRemovingName(name)
      try {
        await removeCharacter.mutateAsync({ name })
      } finally {
        setRemovingName(null)
      }
    }

    return (
      <Section title="🎭 Character References">
        <p className="text-xs text-gray-400 -mt-2">
          Add reference images for named characters. Names are matched exactly in scene text when generating illustrations.
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
            <div className="w-4 h-4 border-2 border-story-purple border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        )}

        {isError && (
          <p className="text-xs text-red-500">Failed to load character library.</p>
        )}

        {!isLoading && characters.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {characters.map(char => (
              <CharacterCard
                key={char.name}
                character={char}
                onRemove={() => handleRemove(char.name)}
                isRemoving={removingName === char.name}
              />
            ))}
          </div>
        )}

        {!isLoading && characters.length === 0 && !showAddForm && (
          <p className="text-xs text-gray-400 italic">No characters added yet.</p>
        )}

        {showAddForm ? (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-3 space-y-2">
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide">
              Character Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={e => { setNewName(e.target.value); setAddError('') }}
              placeholder="e.g. Grandma"
              autoFocus
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 focus:border-story-purple focus:outline-none"
            />
            {addError && (
              <p className="text-xs text-red-500">{addError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || addCharacter.isPending}
                className="flex-1 bg-story-purple hover:bg-story-purple-dark text-white font-bold py-2 rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                {addCharacter.isPending ? 'Selecting…' : '🖼 Choose Image'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewName(''); setAddError('') }}
                className="px-4 py-2 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:border-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full border-2 border-dashed border-gray-300 hover:border-story-purple text-gray-500 hover:text-story-purple font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            + Add Character
          </button>
        )}
      </Section>
    )
  }

  function CharacterCard({ character, onRemove, isRemoving }) {
    return (
      <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2 border border-gray-100">
        {character.imagePath && (
          <img
            src={`localfile:///${character.imagePath.replace(/\\/g, '/')}`}
            alt={character.name}
            className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-gray-200"
          />
        )}
        <span className="flex-1 text-sm font-bold text-gray-700 truncate">{character.name}</span>
        <button
          onClick={onRemove}
          disabled={isRemoving}
          className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none disabled:opacity-40 flex-shrink-0"
          title="Remove character"
        >
          ×
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 4: Manual smoke test — add a character**

  In the running app:
  1. Go to Settings
  2. Scroll to "Character References" section
  3. Click "Add Character"
  4. Type a name (e.g. "Grandma")
  5. Click "Choose Image" — file dialog opens, select any PNG/JPG
  Expected: Dialog closes, character card appears in the grid with thumbnail and name.

- [ ] **Step 5: Manual smoke test — duplicate name rejection**

  1. Click "Add Character" again
  2. Type the same name as the one just added
  3. Click "Choose Image"
  Expected: Error message "A character with that name already exists" appears inline. Form stays open.

- [ ] **Step 6: Manual smoke test — remove a character**

  1. Click × on the character card
  Expected: Card disappears from the grid.

- [ ] **Step 7: Manual smoke test — illustration generation uses character references**

  1. Add a character named exactly as a word that appears in one of your scene texts (e.g. "Grandma")
  2. Go to a scene whose text contains that word
  3. Generate the illustration
  Expected: Terminal shows `[generate-illustration] Using N reference image(s)` with the character's filename listed. Illustration generates successfully.

- [ ] **Step 8: Commit Chunk 2**

  ```bash
  git add src/hooks/useIPC.js src/pages/Settings.jsx
  git commit -m "feat: add Character References section in Settings and useIPC hooks"
  ```
