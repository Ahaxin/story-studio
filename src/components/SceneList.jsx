// SceneList.jsx — Left panel: scrollable list of scene cards with status badges.

import React, { useState } from 'react'
import useStore from '../store/useStore'
import { useGenerateIllustration, useGenerateNarration } from '../hooks/useIPC'

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

  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 })

  if (!currentProject) return null
  const { scenes } = currentProject

  async function handleGenerateAll() {
    const pending = scenes.filter(s => s.status === 'pending')
    if (pending.length === 0) return

    const total = pending.length * 2  // illustration + narration per scene
    setGenerating(true)
    setGenProgress({ done: 0, total })

    // Pass 1: illustrations sequentially (avoids API rate-limit bursts)
    for (const scene of pending) {
      try {
        await genIllustration.mutateAsync({ projectId: currentProject.id, sceneId: scene.id })
      } catch (err) {
        console.error(`Scene ${scene.index + 1} illustration failed:`, err)
      }
      setGenProgress(p => ({ ...p, done: p.done + 1 }))
    }

    // Pass 2: narrations in parallel (concurrency 3)
    // ElevenLabs benefits from true parallelism; XTTS queues internally but still works.
    const CONCURRENCY = 3
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        batch.map(scene =>
          genNarration.mutateAsync({ projectId: currentProject.id, sceneId: scene.id })
            .catch(err => console.error(`Scene ${scene.index + 1} narration failed:`, err))
            .finally(() => setGenProgress(p => ({ ...p, done: p.done + 1 })))
        )
      )
    }

    setGenerating(false)
  }

  function move(index, direction) {
    const toIndex = index + direction
    if (toIndex < 0 || toIndex >= scenes.length) return
    reorderScenes(index, toIndex)
  }

  const pendingCount = scenes.filter(s => s.status === 'pending').length
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

        {/* Generate All button */}
        <button
          onClick={handleGenerateAll}
          disabled={generating || pendingCount === 0}
          className="w-full bg-story-green hover:bg-story-green-dark disabled:opacity-40 text-white font-bold py-2 rounded-xl text-sm transition-colors"
        >
          {generating
            ? `Generating… ${genProgress.done}/${genProgress.total} steps`
            : `⚡ Generate All (${pendingCount} pending)`}
        </button>

        {/* Progress bar */}
        {generating && (
          <div className="mt-2 bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-story-green h-full rounded-full transition-all duration-500"
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
