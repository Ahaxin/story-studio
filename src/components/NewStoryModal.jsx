// NewStoryModal.jsx — Create a new story: name, language, paste text, split into scenes.

import React, { useState, useEffect, useRef } from 'react'
import useStore from '../store/useStore'
import { useCreateProject } from '../hooks/useIPC'

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

  const [step, setStep] = useState(1)   // 1 = info, 2 = text + split preview
  const [name, setName] = useState('')
  const nameInputRef = useRef(null)
  const textareaRef = useRef(null)
  const [language, setLanguage] = useState('nl-NL')
  const [narrator, setNarrator] = useState('daughter1')
  const [storyText, setStoryText] = useState('')
  const [splitResult, setSplitResult] = useState(null)
  const [splitError, setSplitError] = useState('')
  const [error, setError] = useState('')

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

  async function handleCreate() {
    if (!splitResult) return
    setError('')

    // Prepend a dedicated cover scene (index 0) using the story title.
    // Story paragraphs follow as scenes 1..N. Only the cover (index 0) gets cover-style illustration.
    const coverScene = { text: name.trim(), index: 0, narrator, transition: 'zoom' }
    const storyScenes = splitResult.map((text, i) => ({
      text,
      index: i + 1,
      narrator,
      transition: i === splitResult.length - 1 ? 'fade' : 'page-curl',
    }))
    const scenes = [coverScene, ...storyScenes]

    try {
      await createProject.mutateAsync({ name: name.trim(), language, scenes })
      closeNewStoryModal()
    } catch (err) {
      setError(err.message)
    }
  }

  // Electron on Windows doesn't reliably honour autoFocus — force focus via ref
  useEffect(() => {
    const timer = setTimeout(() => nameInputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (step === 2) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [step])

  const estimatedSecs = splitResult ? splitResult.length * 8 : 0
  const estimatedMin = Math.floor(estimatedSecs / 60)
  const estimatedSec = estimatedSecs % 60

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-story-purple to-story-purple-light px-8 py-6">
          <h2 className="text-2xl font-black text-white">✨ New Story</h2>
          <p className="text-purple-200 text-sm mt-1 font-medium">
            Step {step} of 2 — {step === 1 ? 'Story details' : 'Paste your story'}
          </p>
        </div>

        <div className="px-8 py-6">
          {step === 1 && (
            <div className="space-y-5">
              {/* Story name */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  Story title
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="De Kleine Beer en de Ster"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-800 font-medium focus:border-story-purple focus:outline-none transition-colors"
                />
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Language
                </label>
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

              {/* Narrator */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Narrator
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'daughter1', label: '👧 Daughter 1' },
                    { value: 'daughter2', label: '👧 Daughter 2' },
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
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
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

              {/* Split button */}
              <button
                onClick={handleSplit}
                disabled={!storyText.trim()}
                className="w-full bg-story-yellow hover:bg-story-yellow-dark text-white font-bold py-2.5 rounded-xl transition-colors disabled:opacity-40"
              >
                ✂️ Split into Scenes
              </button>

              {/* Error */}
              {splitError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">
                  ⚠️ {splitError}
                </div>
              )}

              {/* Split preview */}
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
                disabled={!splitResult || createProject.isPending}
                className="px-6 py-2.5 rounded-xl bg-story-purple text-white font-bold hover:bg-story-purple-dark transition-colors disabled:opacity-40"
              >
                {createProject.isPending ? 'Creating…' : '🎬 Create Story'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
