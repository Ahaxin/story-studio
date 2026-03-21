// SceneList.jsx — Left panel: scrollable list of scene cards with status badges.

import React, { useState } from 'react'
import useStore from '../store/useStore'
import { useGenerateIllustration, useGenerateNarration, useAutoDiscoverCharacters } from '../hooks/useIPC'

const STATUS_CONFIG = {
  pending:           { label: 'Pending',    color: 'bg-gray-100 text-gray-500' },
  'illustration-done': { label: 'Art ✓',   color: 'bg-blue-100 text-blue-600' },
  'narration-done':  { label: 'Audio ✓',   color: 'bg-yellow-100 text-yellow-700' },
  ready:             { label: 'Ready ✅',   color: 'bg-green-100 text-green-700' },
}

export default function SceneList() {
  const { currentProject, selectedSceneId, setSelectedSceneId, generatingScenes, reorderScenes } = useStore()
  const genIllustration = useGenerateIllustration()
  const genNarration = useGenerateNarration()

  const autoDiscover = useAutoDiscoverCharacters()

  const [generatingType, setGeneratingType] = useState(null) // null | 'discovering' | 'images' | 'sounds'
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 })
  const [discoverResult, setDiscoverResult] = useState(null) // { added: [], skipped: [] } | null

  if (!currentProject) return null
  const { scenes } = currentProject

  async function handleGenerateAllImages() {
    const targets = scenes.filter(s => s.status === 'pending' || s.status === 'narration-done')
    if (targets.length === 0) return

    // Step 1: Auto-discover characters and generate reference portraits for any new ones
    setGeneratingType('discovering')
    setDiscoverResult(null)
    try {
      const result = await autoDiscover.mutateAsync({ projectId: currentProject.id })
      setDiscoverResult(result)
      console.log(`[SceneList] Auto-discover: +${result.added.length} new, ${result.skipped.length} known`)
    } catch (err) {
      // Non-fatal — log and continue (LM Studio may be offline)
      console.warn('[SceneList] Character auto-discover failed (continuing):', err.message)
    }

    // Step 2: Generate illustrations for all pending scenes
    setGeneratingType('images')
    setGenProgress({ done: 0, total: targets.length })

    for (const scene of targets) {
      try {
        await genIllustration.mutateAsync({ projectId: currentProject.id, sceneId: scene.id })
      } catch (err) {
        console.error(`Scene ${scene.index + 1} illustration failed:`, err)
      }
      setGenProgress(p => ({ ...p, done: p.done + 1 }))
    }

    setGeneratingType(null)
  }

  async function handleGenerateAllSounds() {
    const targets = scenes.filter(s => s.status === 'pending' || s.status === 'illustration-done')
    if (targets.length === 0) return

    setGeneratingType('sounds')
    const CONCURRENCY = 3
    setGenProgress({ done: 0, total: targets.length })

    // ElevenLabs benefits from true parallelism; XTTS queues internally but still works.
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        batch.map(scene =>
          genNarration.mutateAsync({ projectId: currentProject.id, sceneId: scene.id })
            .catch(err => console.error(`Scene ${scene.index + 1} narration failed:`, err))
            .finally(() => setGenProgress(p => ({ ...p, done: p.done + 1 })))
        )
      )
    }

    setGeneratingType(null)
  }

  function move(index, direction) {
    const toIndex = index + direction
    if (toIndex < 0 || toIndex >= scenes.length) return
    reorderScenes(index, toIndex)
  }

  const imagesNeededCount = scenes.filter(s => s.status === 'pending' || s.status === 'narration-done').length
  const soundsNeededCount = scenes.filter(s => s.status === 'pending' || s.status === 'illustration-done').length
  const readyCount = scenes.filter(s => s.status === 'ready').length

  return (
    <div className="w-72 min-w-[260px] flex flex-col bg-white border-r border-gray-100 h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-gray-700">Scenes</h3>
          <span className="text-xs text-gray-400 font-medium">
            {readyCount}/{scenes.length} ready
          </span>
        </div>

        {/* Generate All Images / Sounds buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={handleGenerateAllImages}
            disabled={!!generatingType || imagesNeededCount === 0}
            className="flex-1 bg-story-green hover:bg-story-green-dark disabled:opacity-40 text-white font-bold py-2 rounded-xl text-xs transition-colors"
          >
            {generatingType === 'discovering'
              ? '🔍 Characters…'
              : generatingType === 'images'
              ? `🖼️ ${genProgress.done}/${genProgress.total}`
              : `🖼️ Images (${imagesNeededCount})`}
          </button>
          <button
            onClick={handleGenerateAllSounds}
            disabled={!!generatingType || soundsNeededCount === 0}
            className="flex-1 bg-story-purple hover:bg-story-purple-dark disabled:opacity-40 text-white font-bold py-2 rounded-xl text-xs transition-colors"
          >
            {generatingType === 'sounds'
              ? `🔊 ${genProgress.done}/${genProgress.total}`
              : `🔊 Sounds (${soundsNeededCount})`}
          </button>
        </div>

        {/* Progress bar */}
        {generatingType === 'discovering' && (
          <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div className="h-full rounded-full bg-story-yellow animate-pulse" style={{ width: '100%' }} />
          </div>
        )}
        {generatingType === 'images' && (
          <>
            {discoverResult && discoverResult.added.length > 0 && (
              <p className="text-xs text-story-green font-medium mt-1.5">
                ✨ {discoverResult.added.length} new character{discoverResult.added.length > 1 ? 's' : ''} found: {discoverResult.added.map(c => c.name).join(', ')}
              </p>
            )}
            <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 bg-story-green"
                style={{ width: `${(genProgress.done / genProgress.total) * 100}%` }}
              />
            </div>
          </>
        )}
        {generatingType === 'sounds' && (
          <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 bg-story-purple"
              style={{ width: `${(genProgress.done / genProgress.total) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Scene cards */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {scenes.map((scene, idx) => {
          const isSelected = scene.id === selectedSceneId
          const isGenerating = generatingScenes.has(scene.id) || generatingScenes.has(scene.id + '_audio')
          const statusConfig = STATUS_CONFIG[scene.status] ?? STATUS_CONFIG.pending

          return (
            <div
              key={scene.id}
              onClick={() => setSelectedSceneId(scene.id)}
              className={`relative rounded-xl cursor-pointer transition-all border-2 ${
                isSelected
                  ? 'border-story-purple bg-purple-50'
                  : 'border-transparent hover:border-gray-200 bg-gray-50 hover:bg-white'
              }`}
            >
              <div className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  {/* Scene number / cover badge */}
                  <span className={`shrink-0 w-6 h-6 rounded-lg text-xs font-black flex items-center justify-center mt-0.5 ${
                    isSelected ? 'bg-story-purple text-white' : scene.index === 0 ? 'bg-story-yellow text-white' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {scene.index === 0 ? '⭐' : scene.index}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 font-medium leading-relaxed line-clamp-2">
                      {scene.text.substring(0, 80)}{scene.text.length > 80 ? '…' : ''}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {isGenerating ? (
                        <span className="text-xs bg-story-yellow/20 text-story-yellow-dark px-2 py-0.5 rounded-full font-bold animate-pulse">
                          Generating…
                        </span>
                      ) : (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      )}
                      <span className="text-xs text-gray-300">{scene.wordCount}w</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reorder buttons — visible on hover */}
              <div className="absolute right-1 top-1 hidden group-hover:flex flex-col gap-0.5">
                <button
                  onClick={e => { e.stopPropagation(); move(idx, -1) }}
                  disabled={idx === 0}
                  className="w-5 h-5 rounded bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs disabled:opacity-30 flex items-center justify-center"
                >
                  ▲
                </button>
                <button
                  onClick={e => { e.stopPropagation(); move(idx, 1) }}
                  disabled={idx === scenes.length - 1}
                  className="w-5 h-5 rounded bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs disabled:opacity-30 flex items-center justify-center"
                >
                  ▼
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
