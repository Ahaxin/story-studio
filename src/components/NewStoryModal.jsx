// NewStoryModal.jsx — Create a new story: name, language, paste text, split into scenes.

import React, { useState, useEffect, useRef, useCallback } from 'react'
import useStore from '../store/useStore'
import { useCreateProject, useGenerateStory, useLmStudioStatus, useAutoDiscoverCharacters, useSaveDiscoveredCharacters, useRegeneratePortrait } from '../hooks/useIPC'
import { STYLE_PRESETS } from '../utils/stylePresets'
import StylePicker from './StylePicker'

// storySplitter runs in renderer just for preview — actual write happens via IPC
function splitPreview(text) {
  const paragraphs = text
    .split(/\n\n+/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(p => p.length > 0)
  return paragraphs
}

export default function NewStoryModal() {
  const { closeNewStoryModal } = useStore()
  const createProject = useCreateProject()
  const generateStory = useGenerateStory()
  const { data: lmStudioData } = useLmStudioStatus()
  const autoDiscover = useAutoDiscoverCharacters()
  const saveDiscovered = useSaveDiscoveredCharacters()
  const regeneratePortrait = useRegeneratePortrait()

  const [step, setStep] = useState(1)           // 1 = info, 2 = text/AI
  const [tab, setTab] = useState('paste')        // 'paste' | 'ai'
  const [name, setName] = useState('')
  const nameInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [language, setLanguage] = useState('nl-NL')
  const [narrator, setNarrator] = useState('daughter1')
  const [selectedStyle, setSelectedStyle] = useState(STYLE_PRESETS[0])
  const [showStylePicker, setShowStylePicker] = useState(false)

  // Paste tab state
  const [storyText, setStoryText] = useState('')
  const [splitResult, setSplitResult] = useState(null)   // array of strings
  const [splitError, setSplitError] = useState('')

  // Write for Me tab state
  const [idea, setIdea] = useState('')
  const [sceneCount, setSceneCount] = useState(8)
  const [aiResult, setAiResult] = useState(null)         // { scenes: [{text, illustrationPrompt}], warned }
  const [aiError, setAiError] = useState('')
  const [genProgress, setGenProgress] = useState(0)  // 0–100

  const [error, setError] = useState('')

  // Step 3: character review
  const [discoveredChars, setDiscoveredChars] = useState([])   // [{name, imagePath, description}]
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [autoDiscoverError, setAutoDiscoverError] = useState(false)
  const [regeneratingIndices, setRegeneratingIndices] = useState(new Set())
  const [cardErrors, setCardErrors] = useState({})             // { [cardIndex]: string }
  const [saveError, setSaveError] = useState('')
  const [bustKeys, setBustKeys] = useState({})                 // { [cardIndex]: number } — forces img remount on regenerate

  // ── Paste tab: split ──────────────────────────────────────────────────────
  function handleSplit() {
    setSplitError('')
    const paragraphs = splitPreview(storyText)
    if (paragraphs.length < 5) {
      setSplitError(`Only ${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'} found. Need at least 5. Separate scenes with blank lines.`)
      setSplitResult(null)
      return
    }
    if (paragraphs.length > 15) {
      setSplitError(`${paragraphs.length} paragraphs found. Maximum is 15. Please split into two projects.`)
      setSplitResult(null)
      return
    }
    setSplitResult(paragraphs)
  }

  // ── Progress bar: ticks up while generating, stops at 90% until done ────────
  useEffect(() => {
    if (!generateStory.isPending) return
    setGenProgress(0)
    // Increment toward 90% asymptotically — slows as it approaches the cap
    const interval = setInterval(() => {
      setGenProgress(p => {
        const remaining = 90 - p
        return p + Math.max(0.3, remaining * 0.03)
      })
    }, 500)
    return () => clearInterval(interval)
  }, [generateStory.isPending])

  // ── AI tab: generate ──────────────────────────────────────────────────────
  async function handleGenerate() {
    setAiError('')
    setAiResult(null)
    setGenProgress(0)
    generateStory.reset()
    try {
      const result = await generateStory.mutateAsync({ idea: idea.trim(), language, sceneCount })
      setGenProgress(100)
      setAiResult(result)
    } catch (err) {
      setGenProgress(0)
      setAiError(err.message)
    }
  }

  // ── Create project ────────────────────────────────────────────────────────
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
      if (result.warning) {
        setAutoDiscoverError(true)
      } else {
        setDiscoveredChars((result.added ?? []).map((c, idx) => ({ ...c, _key: `${c.name}-${idx}` })))
      }
    } catch (err) {
      setAutoDiscoverError(true)
    } finally {
      setIsDiscovering(false)
    }
  }

  async function handleRegenerate(i) {
    setCardErrors(prev => { const e = { ...prev }; delete e[i]; return e })
    setRegeneratingIndices(prev => new Set([...prev, i]))
    try {
      const result = await regeneratePortrait.mutateAsync({
        name: discoveredChars[i].name,
        description: discoveredChars[i].description,
      })
      setDiscoveredChars(prev => prev.map((c, idx) =>
        idx === i ? { ...c, imagePath: result.imagePath } : c
      ))
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
      await saveDiscovered.mutateAsync({ characters: discoveredChars })
      closeNewStoryModal()
    } catch (err) {
      setSaveError('Failed to save characters — try again.')
    }
  }

  // ── Focus management ──────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => nameInputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (step === 2 && tab === 'paste') {
      const timer = setTimeout(() => textareaRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [step, tab])

  // ── Derived ───────────────────────────────────────────────────────────────
  const pasteSceneCount = splitResult ? splitResult.length : 0
  const aiSceneCount    = aiResult    ? aiResult.scenes.length : 0
  const activeCount     = tab === 'paste' ? pasteSceneCount : aiSceneCount
  const estimatedSecs   = activeCount * 8
  const estimatedMin    = Math.floor(estimatedSecs / 60)
  const estimatedSec    = estimatedSecs % 60
  const canCreate       = tab === 'paste' ? !!splitResult : !!aiResult
  const lmOnline        = lmStudioData?.online && lmStudioData?.modelId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-story-purple to-story-purple-light px-8 py-6">
          <h2 className="text-2xl font-black text-white">✨ New Story</h2>
          <p className="text-purple-200 text-sm mt-1 font-medium">
            Step {step} of 3 — {step === 1 ? 'Story details' : step === 2 ? 'Story content' : 'Characters'}
          </p>
        </div>

        <div className="px-8 py-6">
          {/* ── Step 1: name / language / narrator ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">Story title</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="De Kleine Beer en de Ster"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-800 font-medium focus:border-story-purple focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Language</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'nl-NL', label: '🇳🇱 Nederlands' },
                    { value: 'zh-CN', label: '🇨🇳 Chinese' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setLanguage(opt.value)}
                      className={`py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all ${
                        language === opt.value
                          ? 'border-story-purple bg-purple-50 text-story-purple'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Narrator</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'daughter1',   label: '👧 Daughter 1' },
                    { value: 'daughter2',   label: '👧 Daughter 2' },
                    { value: 'alternating', label: '🔄 Alternating' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setNarrator(opt.value)}
                      className={`py-2.5 px-3 rounded-xl border-2 font-bold text-xs transition-all ${
                        narrator === opt.value
                          ? 'border-story-purple bg-purple-50 text-story-purple'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Illustration Style</label>
                <button
                  onClick={() => setShowStylePicker(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-gray-200 hover:border-story-purple/50 transition-colors text-left"
                >
                  <span className="text-xl">{selectedStyle.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 text-sm">{selectedStyle.label}</p>
                    <p className="text-xs text-gray-400">{selectedStyle.description}</p>
                  </div>
                  <span className="text-gray-400 text-xs font-medium shrink-0">Change ▾</span>
                </button>
              </div>
            </div>
          )}

          {showStylePicker && (
            <StylePicker
              selectedStyleId={selectedStyle.id}
              onSelect={(preset) => setSelectedStyle(preset)}
              onClose={() => setShowStylePicker(false)}
              showResetOption={false}
            />
          )}

          {/* ── Step 2: tab toggle + content ── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Tab toggle */}
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setTab('paste')}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                    tab === 'paste'
                      ? 'bg-white shadow text-gray-800'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  ✏️ Paste Text
                </button>
                <button
                  onClick={() => setTab('ai')}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                    tab === 'ai'
                      ? 'bg-white shadow text-gray-800'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🤖 Write for Me
                  {!lmOnline && <span className="ml-1 text-xs font-normal text-gray-400">(offline)</span>}
                </button>
              </div>

              {/* ── Paste tab ── */}
              {tab === 'paste' && (
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
                    <ScenePreview scenes={splitResult.map(t => ({ text: t }))} estimatedMin={estimatedMin} estimatedSec={estimatedSec} />
                  )}
                </div>
              )}

              {/* ── Write for Me tab ── */}
              {tab === 'ai' && (
                <div className="space-y-3">
                  {!lmOnline && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 font-medium">
                      LM Studio is offline or no model is loaded. Start LM Studio and load a model, then come back.
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1.5">
                      Story idea
                    </label>
                    <textarea
                      value={idea}
                      onChange={e => { setIdea(e.target.value); setAiResult(null); setAiError('') }}
                      placeholder="A little bear who wants to touch the stars and goes on a nighttime adventure through the forest…"
                      rows={4}
                      className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-700 font-medium focus:border-story-purple focus:outline-none transition-colors resize-none text-sm leading-relaxed"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-bold text-gray-700 shrink-0">Scenes:</label>
                    <input
                      type="number"
                      min={5}
                      max={15}
                      value={sceneCount}
                      onChange={e => setSceneCount(Math.min(15, Math.max(5, Number(e.target.value))))}
                      className="w-20 border-2 border-gray-200 rounded-xl px-3 py-2 text-center font-bold text-gray-700 focus:border-story-purple focus:outline-none"
                    />
                    <span className="text-xs text-gray-400">(5–15)</span>
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={!idea.trim() || !lmOnline || generateStory.isPending}
                    className="w-full bg-story-purple hover:bg-story-purple-dark disabled:opacity-40 text-white font-bold py-2.5 rounded-xl transition-colors"
                  >
                    {generateStory.isPending ? '✍️ Writing story…' : '🤖 Generate Story'}
                  </button>
                  {generateStory.isPending && (
                    <div className="space-y-1.5">
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-story-purple transition-all duration-500"
                          style={{ width: `${Math.min(genProgress, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-400 text-center font-medium">
                        {genProgress < 30 ? 'Setting the scene…'
                          : genProgress < 60 ? 'Writing scenes…'
                          : genProgress < 85 ? 'Crafting illustration prompts…'
                          : 'Almost done…'}
                      </p>
                    </div>
                  )}
                  {aiError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">
                      ❌ {aiError}
                    </div>
                  )}
                  {aiResult && (
                    <>
                      {aiResult.warned && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-800 font-medium">
                          The model returned {aiResult.scenes.length} scenes instead of {sceneCount}. You can still create the story.
                        </div>
                      )}
                      <ScenePreview scenes={aiResult.scenes} estimatedMin={estimatedMin} estimatedSec={estimatedSec} showPrompts />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

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
                      <div key={char._key} className="relative border-2 border-gray-200 rounded-2xl overflow-hidden">
                        {/* Remove button */}
                        <button
                          onClick={() => setDiscoveredChars(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1.5 right-1.5 z-10 bg-white/80 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors"
                          title="Remove character"
                        >
                          ×
                        </button>
                        {/* Portrait */}
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

          {/* General error */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="px-8 pb-6 flex gap-3 justify-end">
          <button
            onClick={closeNewStoryModal}
            className="px-5 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>

          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className="px-6 py-2.5 rounded-xl bg-story-purple text-white font-bold hover:bg-story-purple-dark transition-colors disabled:opacity-40"
            >
              Next →
            </button>
          )}

          {step === 2 && (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-5 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleCreate}
                disabled={!canCreate || createProject.isPending}
                className="px-6 py-2.5 rounded-xl bg-story-purple text-white font-bold hover:bg-story-purple-dark transition-colors disabled:opacity-40"
              >
                {createProject.isPending ? 'Creating…' : '🎬 Create Story'}
              </button>
            </>
          )}

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
        </div>
      </div>
    </div>
  )
}

// ── Scene preview list (shared by both tabs) ──────────────────────────────────

function ScenePreview({ scenes, estimatedMin, estimatedSec, showPrompts = false }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
      <p className="text-green-800 font-bold text-sm mb-2">
        ✅ {scenes.length} scenes — estimated {estimatedMin}:{estimatedSec.toString().padStart(2, '0')} video
      </p>
      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
        {scenes.map((s, i) => (
          <div key={i} className="flex gap-2 text-xs text-green-700">
            <span className="font-bold w-6 shrink-0">#{i + 1}</span>
            <span className="truncate">
              {s.text.substring(0, 60)}{s.text.length > 60 ? '…' : ''}
              {showPrompts && s.illustrationPrompt && (
                <span className="text-green-500 ml-1">· {s.illustrationPrompt.substring(0, 40)}…</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
