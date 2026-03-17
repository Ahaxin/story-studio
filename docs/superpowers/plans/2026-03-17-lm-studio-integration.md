# LM Studio Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate LM Studio (local OpenAI-compatible LLM) into Story Studio so users can generate a full children's story + illustration prompts from a brief idea, and regenerate individual scene illustration prompts from the SceneEditor.

**Architecture:** A new CommonJS utility `src/utils/lmStudio.js` handles all LM Studio HTTP calls (status check, story generation, per-scene prompt generation). Three new IPC channels expose this to the renderer. The New Story modal gets a "Write for Me" tab alongside the existing paste flow. SceneEditor gets an AI button on the illustration prompt field. Settings shows LM Studio online/offline status.

**Tech Stack:** Electron 28, React 18, Vite 5, React Query, Zustand, axios (already installed), CommonJS utils pattern

**Spec:** `docs/superpowers/specs/2026-03-17-lm-studio-integration-design.md`

---

## Chunk 1: Utility + IPC + Preload

### Task 1: Create `src/utils/lmStudio.js`

**Files:**
- Create: `src/utils/lmStudio.js`

The LM Studio API base URL is `http://127.0.0.1:1234`. It speaks the OpenAI API format. `axios` is already available — use it (do not use `fetch`). All functions are CommonJS exports.

- [ ] **Step 1: Create `src/utils/lmStudio.js` with all three functions**

```js
// lmStudio.js — LM Studio (local OpenAI-compatible LLM) API client.
// LM Studio runs at http://127.0.0.1:1234 and speaks the OpenAI API format.

const axios = require('axios')

const LM_STUDIO_BASE = 'http://127.0.0.1:1234'
const LANGUAGE_NAMES = { 'nl-NL': 'Dutch', 'zh-CN': 'Chinese (Simplified)' }

/**
 * Check whether LM Studio is running and a model is loaded.
 * Never throws — returns { online: false } on any error.
 * @returns {{ online: boolean, modelId: string|null }}
 */
async function checkLmStudioStatus() {
  try {
    const res = await axios.get(`${LM_STUDIO_BASE}/v1/models`, { timeout: 5000 })
    const models = res.data?.data || []
    return {
      online: true,
      modelId: models.length > 0 ? models[0].id : null,
    }
  } catch {
    return { online: false, modelId: null }
  }
}

/**
 * Generate a children's story split into scenes, each with an illustration prompt.
 * Returns only story-body scenes (no cover) — the cover is created from the title by the caller.
 *
 * @param {{ idea: string, language: string, sceneCount?: number }} opts
 * @returns {{ scenes: Array<{ text: string, illustrationPrompt: string }>, warned: boolean }}
 */
async function generateStory({ idea, language, sceneCount = 8 }) {
  const langName = LANGUAGE_NAMES[language] || 'Dutch'

  const systemPrompt =
    `You are a children's book author. Write a children's story in ${langName} ` +
    `based on the following idea. The story must have exactly ${sceneCount} scenes (paragraphs). ` +
    `Each paragraph should be 20-40 words, warm, and safe for children aged 4-10.\n\n` +
    `Return ONLY valid JSON with no other text, in this exact shape:\n` +
    `{\n  "scenes": [\n    { "text": "...", "illustrationPrompt": "..." },\n    ...\n  ]\n}\n\n` +
    `For each scene, "illustrationPrompt" should be a vivid, specific description ` +
    `suitable for a watercolor children's book illustration — describe the setting, ` +
    `characters, mood, and action in 1-2 sentences.`

  let raw
  try {
    const res = await axios.post(
      `${LM_STUDIO_BASE}/v1/chat/completions`,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: idea },
        ],
        temperature: 0.8,
        max_tokens: 4096,
      },
      { timeout: 60000 }
    )
    raw = res.data?.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error('LM Studio took too long to respond.')
    }
    throw new Error('LM Studio is not running. Start it and load a model first.')
  }

  // Strip markdown code fences if model wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const err = new Error('Model returned invalid response. Try again.')
    err.rawResponse = raw
    throw err
  }

  if (!Array.isArray(parsed?.scenes)) {
    const err = new Error('Model returned invalid response. Try again.')
    err.rawResponse = raw
    throw err
  }

  const MIN = 5, MAX = 15
  const returned = parsed.scenes.length
  const warned = Math.abs(returned - sceneCount) > 2

  // Clamp to valid range
  const scenes = parsed.scenes
    .slice(0, MAX)
    .filter(s => s && typeof s.text === 'string' && s.text.trim())

  if (scenes.length < MIN) {
    const err = new Error(`Model returned only ${returned} scenes (minimum is ${MIN}). Try again.`)
    err.rawResponse = raw
    throw err
  }

  return { scenes, warned }
}

/**
 * Generate a single illustration prompt for a scene.
 * @param {{ sceneText: string, language: string, storyTitle: string, illustrationStyle: string }} opts
 * @returns {string} illustration prompt
 */
async function generateIllustrationPrompt({ sceneText, language, storyTitle, illustrationStyle }) {
  const langName = LANGUAGE_NAMES[language] || 'Dutch'

  const systemPrompt =
    `You are an art director for a children's picture book titled "${storyTitle}". ` +
    `The illustration style is: ${illustrationStyle}. ` +
    `Given the following story scene text (written in ${langName}), write a single illustration prompt ` +
    `for a watercolor children's book illustration in that style. Describe the setting, ` +
    `characters, mood, lighting, and action in 1-2 sentences. Be specific and vivid. ` +
    `Safe for children aged 4-10. No scary elements.\n\n` +
    `Return only the illustration prompt, no other text.`

  let raw
  try {
    const res = await axios.post(
      `${LM_STUDIO_BASE}/v1/chat/completions`,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Scene text: "${sceneText}"` },
        ],
        temperature: 0.7,
        max_tokens: 512,
      },
      { timeout: 30000 }
    )
    raw = res.data?.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error('LM Studio took too long to respond.')
    }
    throw new Error('LM Studio is not running. Start it and load a model first.')
  }

  const prompt = raw.trim()
  if (!prompt) throw new Error('Model returned an empty prompt. Try again.')
  return prompt
}

module.exports = { checkLmStudioStatus, generateStory, generateIllustrationPrompt }
```

- [ ] **Step 2: Smoke-test the file loads without syntax errors**

Run from the project root (this just checks the require resolves):
```bash
node -e "const m = require('./src/utils/lmStudio'); console.log(Object.keys(m))"
```
Expected output: `[ 'checkLmStudioStatus', 'generateStory', 'generateIllustrationPrompt' ]`

- [ ] **Step 3: Commit**

```bash
git add src/utils/lmStudio.js
git commit -m "feat: add lmStudio utility (status check, story gen, prompt gen)"
```

---

### Task 2: Expose new IPC channels in `electron/preload.js`

**Files:**
- Modify: `electron/preload.js`

The preload script is the security boundary. Every new IPC channel must be listed here before the renderer can call it. Three channels to add: `lmstudio:status`, `lmstudio:generate-story`, `lmstudio:generate-prompt`.

- [ ] **Step 1: Add LM Studio entries to `electron/preload.js`**

Open `electron/preload.js`. The file ends with the `character:*` entries before the closing `})`. Add the three new lines **after** `characterRemove` and **before** the closing `})`:

```js
  // LM Studio (local LLM)
  lmStudioStatus: () => ipcRenderer.invoke('lmstudio:status'),
  lmStudioGenerateStory: (args) => ipcRenderer.invoke('lmstudio:generate-story', args),
  lmStudioGeneratePrompt: (args) => ipcRenderer.invoke('lmstudio:generate-prompt', args),
})
```

**Note:** The `characterList`, `characterAdd`, `characterRemove` entries already exist in the file — do NOT duplicate them. Only add the three new `lmStudio*` lines above the closing `})`.

- [ ] **Step 2: Commit**

```bash
git add electron/preload.js
git commit -m "feat: expose lmstudio IPC channels in preload"
```

---

### Task 3: Add IPC handlers to `electron/main.js` + patch `story:create`

**Files:**
- Modify: `electron/main.js`

Two changes:
1. Add `require` for `lmStudio` and three IPC handlers near the other utility handlers.
2. Patch `story:create` to preserve incoming `illustrationPrompt` values after `createScene()` overwrites them with `''`.

- [ ] **Step 1: Add the `require` and three IPC handlers**

In `electron/main.js`, find the line near the top where utilities are required (e.g. around where `axios` and `FormData` are required, lines 1–18). Add the lmStudio require after the existing requires:

```js
const { checkLmStudioStatus, generateStory, generateIllustrationPrompt } = require('../src/utils/lmStudio')
```

Then, find the block of IPC handlers at the end of the file. Add these three handlers. Place them just before or after the `xtts:status` handler for logical grouping:

```js
// ─── LM Studio IPC handlers ───────────────────────────────────────────────────

// lmstudio:status — Check if LM Studio is running and a model is loaded
ipcMain.handle('lmstudio:status', async () => {
  try {
    const result = await checkLmStudioStatus()
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// lmstudio:generate-story — Generate story scenes + illustration prompts from a brief idea
ipcMain.handle('lmstudio:generate-story', async (event, { idea, language }) => {
  try {
    const result = await generateStory({ idea, language, sceneCount: 8 })
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message, rawResponse: err.rawResponse }
  }
})

// lmstudio:generate-prompt — Generate a single illustration prompt for a scene
ipcMain.handle('lmstudio:generate-prompt', async (event, { sceneText, language, storyTitle, illustrationStyle }) => {
  try {
    const prompt = await generateIllustrationPrompt({ sceneText, language, storyTitle, illustrationStyle })
    return { success: true, data: { prompt } }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
```

- [ ] **Step 2: Patch `story:create` to preserve incoming `illustrationPrompt`**

Find the `story:create` handler (currently around line 91). The current scene-mapping block looks like:

```js
    if (scenes && Array.isArray(scenes)) {
      const { createScene } = require('../src/utils/schema')
      project.scenes = scenes.map((s, i) =>
        createScene(i, s.text, s.narrator || 'daughter1', s.transition || 'page-curl')
      )
    }
```

Replace it with:

```js
    if (scenes && Array.isArray(scenes)) {
      const { createScene } = require('../src/utils/schema')
      project.scenes = scenes.map((s, i) => {
        const scene = createScene(i, s.text, s.narrator || 'daughter1', s.transition || 'page-curl')
        // Preserve LM-generated illustration prompts (createScene() always resets to '')
        if (s.illustrationPrompt && s.illustrationPrompt.trim()) {
          scene.illustrationPrompt = s.illustrationPrompt.trim()
        }
        return scene
      })
    }
```

`ensureIllustrationPrompts()` (called right after) already skips scenes where `illustrationPrompt` is non-empty, so LM-generated prompts will be preserved.

- [ ] **Step 3: Restart Electron and confirm no startup errors**

```bash
cmd //c "taskkill /IM electron.exe /F"
```
Then start again: `npm run electron` (with Vite already running on 5173).
Check the DevTools console — no errors expected.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat: add lmstudio IPC handlers + preserve illustrationPrompt in story:create"
```

---

### Task 4: Add React Query hooks to `src/hooks/useIPC.js`

**Files:**
- Modify: `src/hooks/useIPC.js`

Add three hooks. `useLmStudioStatus` is a query (refetch on mount, no polling). The other two are mutations.

- [ ] **Step 1: Add hooks to the end of `src/hooks/useIPC.js`**

```js
// ── LM Studio hooks ────────────────────────────────────────────────────────────

/** Check if LM Studio is running. Only refetches when manually triggered via refetch(). */
export function useLmStudioStatus() {
  return useQuery({
    queryKey: ['lmstudio-status'],
    queryFn: async () => {
      const res = await api.lmStudioStatus()
      if (!res.success) throw new Error(res.error)
      return res.data  // { online: boolean, modelId: string|null }
    },
    staleTime: Infinity,   // never auto-refetch; user triggers via Recheck button/badge
    retry: false,
  })
}

/** Generate a full story (scenes + illustration prompts) from a brief idea. */
export function useGenerateStory() {
  return useMutation({
    mutationFn: async ({ idea, language }) => {
      const res = await api.lmStudioGenerateStory({ idea, language })
      if (!res.success) {
        const err = new Error(res.error)
        err.rawResponse = res.rawResponse
        throw err
      }
      return res.data  // { scenes: [{text, illustrationPrompt}], warned: boolean }
    },
  })
}

/** Generate an illustration prompt for a single scene. */
export function useGeneratePrompt() {
  return useMutation({
    mutationFn: async ({ sceneText, language, storyTitle, illustrationStyle }) => {
      const res = await api.lmStudioGeneratePrompt({ sceneText, language, storyTitle, illustrationStyle })
      if (!res.success) throw new Error(res.error)
      return res.data  // { prompt: string }
    },
  })
}
```

- [ ] **Step 2: Verify import — no changes to existing imports needed**

`useQuery` and `useMutation` are already imported at the top of `useIPC.js`. No new imports required.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useIPC.js
git commit -m "feat: add useLmStudioStatus, useGenerateStory, useGeneratePrompt hooks"
```

---

## Chunk 2: UI — Settings + NewStoryModal + SceneEditor

### Task 5: Add LM Studio status section to `Settings.jsx`

**Files:**
- Modify: `src/pages/Settings.jsx`

Add a read-only status banner with a Recheck button. Uses `useLmStudioStatus()` hook. The banner appears in the API Keys section area (after XTTS status banner, before daughter profiles).

- [ ] **Step 1: Import the new hook at the top of `Settings.jsx`**

Find the existing import line:
```js
import { useSettings, useSaveSettings, useXttsStatus, useUploadCharacterReference, useElevenLabsCloneVoice, useCharacterList, useAddCharacter, useRemoveCharacter } from '../hooks/useIPC'
```

Add `useLmStudioStatus` to the import:
```js
import { useSettings, useSaveSettings, useXttsStatus, useUploadCharacterReference, useElevenLabsCloneVoice, useCharacterList, useAddCharacter, useRemoveCharacter, useLmStudioStatus } from '../hooks/useIPC'
```

- [ ] **Step 2: Use the hook in the `Settings` component**

Inside the `Settings` function body, after the existing `const { data: xttsData } = useXttsStatus()` line, add:

```js
  const { data: lmData, refetch: recheckLmStudio, isFetching: lmChecking } = useLmStudioStatus()
```

- [ ] **Step 3: Add the `LmStudioStatusBanner` component and render it**

At the bottom of `Settings.jsx`, add this component (after the existing helper components):

```jsx
// ── LM Studio Status Banner ────────────────────────────────────────────────────

function LmStudioStatusBanner({ data, onRecheck, checking }) {
  const online = data?.online
  const modelId = data?.modelId

  return (
    <div className="flex items-center justify-between bg-white border-2 border-gray-100 rounded-2xl px-5 py-3">
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-red-400'}`} />
        <div>
          <p className="font-bold text-gray-700 text-sm">LM Studio</p>
          <p className="text-xs text-gray-400 font-medium">
            {data === undefined
              ? 'Checking…'
              : online
                ? modelId
                  ? `Online — ${modelId}`
                  : 'Online — no model loaded'
                : 'Offline — start LM Studio and load a model'}
          </p>
        </div>
      </div>
      <button
        onClick={onRecheck}
        disabled={checking}
        className="text-xs font-bold text-story-purple hover:text-story-purple-dark disabled:opacity-40 transition-colors"
      >
        {checking ? 'Checking…' : 'Recheck'}
      </button>
    </div>
  )
}
```

Then in the JSX render, after `<XttsStatusBanner status={xttsStatus} />`, add:

```jsx
        {/* LM Studio status */}
        <LmStudioStatusBanner
          data={lmData}
          onRecheck={recheckLmStudio}
          checking={lmChecking}
        />
```

- [ ] **Step 4: Start the app and open Settings**

```bash
cmd //c "taskkill /IM electron.exe /F"
```
Then `npm run electron`. Open Settings. Confirm the LM Studio banner appears. If LM Studio is not running, it should show "Offline". Click Recheck — it should re-query.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Settings.jsx
git commit -m "feat: add LM Studio status banner to Settings"
```

---

### Task 6: Add "Write for Me" tab to `NewStoryModal.jsx`

**Files:**
- Modify: `src/components/NewStoryModal.jsx`

This is the largest UI change. The Step 2 of the modal gets a tab toggle. The existing paste flow is unchanged. The "Write for Me" tab calls `lmstudio:generate-story` and feeds the result into the existing `splitResult`/`handleCreate()` flow. `handleCreate()` is also modified to pass `illustrationPrompt` through to the IPC.

- [ ] **Step 1: Add imports to `NewStoryModal.jsx`**

Find the existing import at the top:
```js
import { useCreateProject } from '../hooks/useIPC'
```

Replace with:
```js
import { useCreateProject, useLmStudioStatus, useGenerateStory } from '../hooks/useIPC'
```

- [ ] **Step 2: Add new state variables inside the `NewStoryModal` component**

After the existing state declarations, add:

```js
  const [step2Tab, setStep2Tab] = useState('paste')  // 'paste' | 'ai'
  const [storyIdea, setStoryIdea] = useState('')
  const [aiScenes, setAiScenes] = useState(null)     // [{ text, illustrationPrompt }]
  const [aiWarn, setAiWarn] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiRawResponse, setAiRawResponse] = useState('')

  const { data: lmData, refetch: recheckLm } = useLmStudioStatus()
  const generateStory = useGenerateStory()
```

- [ ] **Step 3: Add `handleGenerate` function**

After `handleSplit()`, add:

```js
  async function handleGenerate() {
    setAiError('')
    setAiRawResponse('')
    setAiScenes(null)
    setAiWarn(false)
    try {
      const result = await generateStory.mutateAsync({ idea: storyIdea, language })
      setAiScenes(result.scenes)
      setAiWarn(result.warned)
    } catch (err) {
      setAiError(err.message || 'Generation failed.')
      setAiRawResponse(err.rawResponse || '')
    }
  }
```

- [ ] **Step 4: Modify `handleCreate()` to pass `illustrationPrompt`**

**First**, fix the early-return guard at the top of `handleCreate()`. The current code is:
```js
async function handleCreate() {
  if (!splitResult) return
```
Replace those two lines with:
```js
async function handleCreate() {
  if (step2Tab === 'paste' && !splitResult) return
  if (step2Tab === 'ai' && !aiScenes) return
```

**Next**, find the `storyScenes` construction currently is:

```js
    const storyScenes = splitResult.map((text, i) => ({
      text,
      index: i + 1,
      narrator,
      transition: i === splitResult.length - 1 ? 'fade' : 'page-curl',
    }))
```

Replace it with this version that handles both tabs:

```js
    // AI tab: aiScenes holds [{ text, illustrationPrompt }]
    // Paste tab: splitResult holds [string], no illustrationPrompts
    const sourceScenes = step2Tab === 'ai' && aiScenes
      ? aiScenes
      : (splitResult || []).map(text => ({ text, illustrationPrompt: '' }))

    const storyScenes = sourceScenes.map((s, i) => ({
      text: s.text,
      illustrationPrompt: s.illustrationPrompt || '',
      index: i + 1,
      narrator,
      transition: i === sourceScenes.length - 1 ? 'fade' : 'page-curl',
    }))
```

Also update the `disabled` check on the Create Story button — it needs to account for both tabs:

```js
  const canCreate = step2Tab === 'paste'
    ? !!splitResult
    : !!aiScenes
```

Then use `canCreate` in the button's `disabled` prop:
```jsx
disabled={!canCreate || createProject.isPending}
```

- [ ] **Step 5: Add the tab toggle and "Write for Me" tab UI to Step 2**

Find the Step 2 section in the JSX (the `{step === 2 && (` block). Replace the entire content of this block with:

```jsx
          {step === 2 && (
            <div className="space-y-4">
              {/* Tab toggle */}
              <div className="flex rounded-xl border-2 border-gray-200 overflow-hidden">
                {[
                  { value: 'paste', label: '✍️ Paste Story' },
                  { value: 'ai',    label: '✨ Write for Me' },
                ].map(tab => (
                  <button
                    key={tab.value}
                    onClick={() => setStep2Tab(tab.value)}
                    className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                      step2Tab === tab.value
                        ? 'bg-story-purple text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── Paste Story tab (existing flow, unchanged) ── */}
              {step2Tab === 'paste' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1.5">
                      Paste your story
                      <span className="font-normal text-gray-400 ml-2">— one paragraph per scene, separated by blank lines</span>
                    </label>
                    <textarea
                      ref={textareaRef}
                      value={storyText}
                      onChange={e => { setStoryText(e.target.value); setSplitResult(null); setSplitError('') }}
                      placeholder={"Er was eens een kleine beer die de sterren wilde aanraken.\n\nIedere nacht keek hij omhoog naar de hemel en droomde van avontuur.\n\n..."}
                      rows={9}
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-700 font-medium focus:border-story-purple focus:outline-none transition-colors resize-none text-sm leading-relaxed"
                    />
                  </div>
                  <button
                    onClick={handleSplit}
                    disabled={!storyText.trim()}
                    className="w-full bg-story-yellow hover:bg-story-yellow-dark text-white font-bold py-2.5 rounded-xl transition-colors disabled:opacity-40"
                  >
                    ✂️ Split into Scenes
                  </button>
                  {splitError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">
                      ⚠️ {splitError}
                    </div>
                  )}
                  {splitResult && (
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                      <p className="text-green-800 font-bold text-sm mb-2">
                        ✅ {splitResult.length} scenes — estimated {estimatedMin}:{estimatedSec.toString().padStart(2, '0')} video
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {splitResult.map((text, i) => (
                          <div key={i} className="flex gap-2 text-xs text-green-700">
                            <span className="font-bold w-6 shrink-0">#{i + 1}</span>
                            <span className="truncate">{text.substring(0, 60)}{text.length > 60 ? '…' : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Write for Me tab (AI generation) ── */}
              {step2Tab === 'ai' && (
                <div className="space-y-3">
                  {/* LM Studio status badge */}
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${lmData?.online ? 'bg-green-500' : 'bg-red-400'}`} />
                    <span className="text-xs text-gray-400 font-medium">
                      {lmData === undefined
                        ? 'Checking LM Studio…'
                        : lmData.online
                          ? lmData.modelId ? `LM Studio — ${lmData.modelId}` : 'LM Studio online (no model)'
                          : 'LM Studio offline'}
                    </span>
                    <button
                      onClick={recheckLm}
                      className="text-xs text-story-purple font-bold hover:underline ml-1"
                    >
                      Recheck
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1.5">
                      Describe your story idea
                      <span className="font-normal text-gray-400 ml-2">— a few sentences is enough</span>
                    </label>
                    <textarea
                      value={storyIdea}
                      onChange={e => { setStoryIdea(e.target.value); setAiScenes(null); setAiError('') }}
                      placeholder="Een konijn verliest zijn wortel in het bos en vraagt alle dieren om hulp. Aan het eind vinden ze hem samen terug."
                      rows={4}
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-700 font-medium focus:border-story-purple focus:outline-none transition-colors resize-none text-sm leading-relaxed"
                    />
                  </div>

                  <button
                    onClick={handleGenerate}
                    disabled={!storyIdea.trim() || !lmData?.online || generateStory.isPending}
                    className="w-full bg-story-purple hover:bg-story-purple-dark text-white font-bold py-2.5 rounded-xl transition-colors disabled:opacity-40"
                  >
                    {generateStory.isPending ? '✍️ Writing your story…' : '✨ Generate Story'}
                  </button>

                  {aiError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
                      <p className="text-red-700 font-bold mb-1">⚠️ {aiError}</p>
                      {aiRawResponse && (
                        <details className="mt-2">
                          <summary className="text-xs text-red-500 cursor-pointer font-medium">Show raw response</summary>
                          <pre className="mt-1 text-xs text-red-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{aiRawResponse}</pre>
                        </details>
                      )}
                    </div>
                  )}

                  {aiWarn && aiScenes && (
                    <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl px-4 py-2 text-xs font-medium">
                      ⚠️ Model returned a different number of scenes than requested. Scenes have been clamped to a valid range.
                    </div>
                  )}

                  {aiScenes && (
                    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                      <p className="text-green-800 font-bold text-sm mb-2">
                        ✅ {aiScenes.length} scenes generated — illustration prompts included
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {aiScenes.map((scene, i) => (
                          <div key={i} className="flex gap-2 text-xs text-green-700">
                            <span className="font-bold w-6 shrink-0">#{i + 1}</span>
                            <span className="truncate">{scene.text.substring(0, 60)}{scene.text.length > 60 ? '…' : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 6: Update the Create Story button's `disabled` prop**

Find the Create Story button (in the footer):
```jsx
              disabled={!splitResult || createProject.isPending}
```

Replace with:
```jsx
              disabled={!(step2Tab === 'paste' ? splitResult : aiScenes) || createProject.isPending}
```

- [ ] **Step 7: Restart and test the New Story modal**

Kill Electron and restart. Click "+ New Story", fill in name + language, go to Step 2. Verify:
- Tab toggle appears ("✍️ Paste Story" | "✨ Write for Me")
- Paste tab works exactly as before
- AI tab shows LM Studio status badge
- If LM Studio is offline, Generate button is disabled

- [ ] **Step 8: Commit**

```bash
git add src/components/NewStoryModal.jsx
git commit -m "feat: add Write for Me tab to NewStoryModal with LM Studio story generation"
```

---

### Task 7: Add AI prompt button to `SceneEditor.jsx`

**Files:**
- Modify: `src/components/SceneEditor.jsx`

Add a small "✨ AI" button next to the illustration prompt label. On click, calls `lmstudio:generate-prompt` and writes the result into `localPrompt` + sets `promptDirty = true` (triggers existing 1s auto-save).

- [ ] **Step 1: Add imports to `SceneEditor.jsx`**

Find:
```js
import {
  useGenerateIllustration,
  useGenerateNarration,
  useUpdateScene,
  useSaveSceneRecording,
} from '../hooks/useIPC'
```

Replace with:
```js
import {
  useGenerateIllustration,
  useGenerateNarration,
  useUpdateScene,
  useSaveSceneRecording,
  useLmStudioStatus,
  useGeneratePrompt,
} from '../hooks/useIPC'
```

- [ ] **Step 2: Add hook calls inside `SceneEditor`**

After the existing hook calls (after `const updateSceneMutation = useUpdateScene()`), add:

```js
  const { data: lmData } = useLmStudioStatus()
  const generatePrompt = useGeneratePrompt()
```

- [ ] **Step 3: Add `handleAiPrompt` function**

After `handleTransitionChange` (around line 100), add:

```js
  async function handleAiPrompt() {
    if (!scene || !currentProject) return
    try {
      const result = await generatePrompt.mutateAsync({
        sceneText: scene.text,
        language: currentProject.language,
        storyTitle: currentProject.name,
        illustrationStyle: currentProject.style?.illustrationStyle || "watercolor children's book, soft pastel colors, friendly",
      })
      setLocalPrompt(result.prompt)
      setPromptDirty(true)   // triggers existing 1s auto-save to project.json
    } catch (err) {
      // Error is silent — user can retry. Could add a toast here later.
      console.error('[SceneEditor] AI prompt generation failed:', err.message)
    }
  }
```

- [ ] **Step 4: Add the AI button next to the illustration prompt label**

The illustration prompt label is inside an existing `flex items-center justify-between` div that also contains a "Reset" button and a "saving…" indicator. Find this exact block (around line 195 of `SceneEditor.jsx`):

```jsx
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                Illustration Prompt
                {promptDirty && <span className="ml-2 font-normal normal-case text-story-yellow">saving…</span>}
              </label>
              {localPrompt && (
                <button
                  onClick={() => {
                    setLocalPrompt('')
                    setPromptDirty(true)
                  }}
                  className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                  title="Clear prompt — next generate will auto-build"
                >
                  Reset
                </button>
              )}
            </div>
```

Add the AI button **inside** the same flex row, between the `<label>` and the `{localPrompt && ...}` Reset button. Replace the block above with:

```jsx
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                Illustration Prompt
                {promptDirty && <span className="ml-2 font-normal normal-case text-story-yellow">saving…</span>}
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAiPrompt}
                  disabled={!lmData?.online || generatePrompt.isPending}
                  title={lmData?.online ? 'Generate prompt with LM Studio' : 'LM Studio is offline'}
                  className="flex items-center gap-1 text-xs font-bold text-story-purple hover:text-story-purple-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {generatePrompt.isPending
                    ? <span className="w-3 h-3 border-2 border-story-purple border-t-transparent rounded-full animate-spin" />
                    : '✨'}
                  AI
                </button>
                {localPrompt && (
                  <button
                    onClick={() => {
                      setLocalPrompt('')
                      setPromptDirty(true)
                    }}
                    className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                    title="Clear prompt — next generate will auto-build"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
```

This preserves the existing Reset button and saving indicator, adding the AI button as a sibling.

- [ ] **Step 5: Restart and test the AI prompt button**

Kill and restart Electron. Open a project, select a scene. Verify:
- "✨ AI" button appears next to "Illustration Prompt" label
- If LM Studio is offline, button is greyed out
- If LM Studio is online, clicking the button shows a spinner, then fills in the prompt textarea
- After ~1 second the prompt auto-saves (check project.json or generate illustration to confirm)

- [ ] **Step 6: Commit**

```bash
git add src/components/SceneEditor.jsx
git commit -m "feat: add AI illustration prompt button to SceneEditor"
```

---

## Chunk 3: End-to-End Verification

### Task 8: Full end-to-end test

Follow the verification steps from the spec exactly.

- [ ] **Step 1: Start LM Studio with a model loaded**

Open LM Studio, load any instruction-following model (e.g. Mistral 7B Instruct, Llama 3, Qwen 2.5). Ensure the server is running on port 1234.

- [ ] **Step 2: Verify Settings page shows LM Studio online**

Open Story Studio Settings. Confirm the LM Studio banner shows green `●` and the model name. Click Recheck — it should stay green.

- [ ] **Step 3: Generate a Dutch story from idea**

Click `+ New Story`. Enter title: `De Wortel van Floris`. Language: Dutch. Click Next.

In Step 2, click the "✨ Write for Me" tab. Confirm:
- LM Studio status badge shows green
- Enter idea: `Een konijn verliest zijn wortel in het bos en vraagt dieren om hulp`
- Click "✨ Generate Story"
- After 10–30 seconds: 8 scenes appear in the preview, all in Dutch

- [ ] **Step 4: Create the story and verify scenes in editor**

Click "🎬 Create Story". Story opens in the editor. Verify:
- Sidebar shows `De Wortel van Floris`
- Scene list shows 9 scenes (1 cover + 8 body)
- Click Scene 2 — the illustration prompt textarea shows an AI-generated prompt (not the rule-based buildScenePrompt output)

- [ ] **Step 5: Test per-scene AI prompt regeneration**

Select Scene 3. Click the "✨ AI" button next to the illustration prompt label. Verify:
- Spinner appears briefly
- Prompt textarea updates with a new AI-generated prompt
- After ~1 second, no manual action needed — prompt is saved automatically

- [ ] **Step 6: Generate an illustration from the AI prompt**

With the AI prompt in the textarea, click "Generate Illustration". Verify:
- Illustration generates successfully using the AI prompt
- Scene status updates to `illustration-done`

- [ ] **Step 7: Commit final state**

```bash
git add -A
git status
git commit -m "chore: verify LM Studio integration end-to-end"
```

---

## Summary of Files Changed

| File | Change |
|---|---|
| `src/utils/lmStudio.js` | **New** — `checkLmStudioStatus`, `generateStory`, `generateIllustrationPrompt` |
| `electron/preload.js` | Add `lmStudioStatus`, `lmStudioGenerateStory`, `lmStudioGeneratePrompt` |
| `electron/main.js` | Add 3 IPC handlers; patch `story:create` to preserve `illustrationPrompt` |
| `src/hooks/useIPC.js` | Add `useLmStudioStatus`, `useGenerateStory`, `useGeneratePrompt` |
| `src/pages/Settings.jsx` | Add `LmStudioStatusBanner` component + render it |
| `src/components/NewStoryModal.jsx` | Add tab toggle + Write for Me tab + fix `handleCreate()` |
| `src/components/SceneEditor.jsx` | Add AI button + `handleAiPrompt` + hooks |
