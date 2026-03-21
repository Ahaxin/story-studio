// StylePicker.jsx — Modal for choosing an illustration style preset.
// Shows a 4-column grid of style cards with AI-generated preview images.

import React, { useState } from 'react'
import { STYLE_PRESETS } from '../utils/stylePresets'
import { useStylePreviews, useGenerateStylePreviews } from '../hooks/useIPC'

export default function StylePicker({ selectedStyleId, onSelect, onClose, showResetOption }) {
  const [pendingStyleId, setPendingStyleId] = useState(selectedStyleId || STYLE_PRESETS[0].id)
  const { data: previews = {} } = useStylePreviews()
  const generatePreviews = useGenerateStylePreviews()

  const pendingPreset = STYLE_PRESETS.find(p => p.id === pendingStyleId) || STYLE_PRESETS[0]

  // Count how many previews are missing
  const missingCount = STYLE_PRESETS.filter(p => !previews[p.id]).length

  function handleApply(clearPrompts) {
    onSelect(pendingPreset, clearPrompts)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-story-purple to-story-purple-light px-8 py-5">
          <h2 className="text-xl font-black text-white">🎨 Choose Illustration Style</h2>
          <p className="text-purple-200 text-sm mt-0.5 font-medium">
            Pick the visual style for all scene illustrations
          </p>
        </div>

        <div className="px-6 pt-5 pb-3">
          {/* Style grid — 4 columns × 2 rows */}
          <div className="grid grid-cols-4 gap-3">
            {STYLE_PRESETS.map(preset => {
              const previewPath = previews[preset.id]
              const isSelected = preset.id === pendingStyleId

              return (
                <button
                  key={preset.id}
                  onClick={() => setPendingStyleId(preset.id)}
                  className={`rounded-2xl border-2 overflow-hidden text-left transition-all hover:shadow-md focus:outline-none ${
                    isSelected
                      ? 'border-story-purple ring-2 ring-story-purple shadow-md'
                      : 'border-gray-200 hover:border-story-purple/50'
                  }`}
                >
                  {/* Preview image or gradient placeholder */}
                  <div className="aspect-video relative overflow-hidden">
                    {previewPath ? (
                      <img
                        src={`localfile:///${previewPath.replace(/\\/g, '/')}`}
                        alt={preset.label}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${preset.gradient} flex items-center justify-center`}>
                        <span className="text-3xl">{preset.emoji}</span>
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 bg-story-purple text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-black">
                        ✓
                      </div>
                    )}
                  </div>

                  {/* Label + description */}
                  <div className="px-2.5 py-2">
                    <p className="font-bold text-gray-800 text-xs leading-tight">{preset.label}</p>
                    <p className="text-gray-400 text-xs mt-0.5 leading-tight">{preset.description}</p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Generate previews prompt */}
          {missingCount > 0 && (
            <div className="mt-4 flex items-center gap-3">
              {generatePreviews.isPending ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <svg className="animate-spin h-4 w-4 text-story-purple" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  <span>Generating previews… ({STYLE_PRESETS.length - missingCount}/{STYLE_PRESETS.length} done)</span>
                </div>
              ) : (
                <button
                  onClick={() => generatePreviews.mutate()}
                  className="text-sm font-bold text-story-purple hover:text-story-purple-dark transition-colors flex items-center gap-1.5"
                >
                  ✨ Generate AI Previews
                  <span className="text-xs font-normal text-gray-400">({missingCount} missing)</span>
                </button>
              )}
              {generatePreviews.isError && (
                <span className="text-xs text-red-500">{generatePreviews.error?.message}</span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors text-sm"
          >
            Cancel
          </button>

          <div className="flex gap-2">
            {showResetOption ? (
              <>
                <button
                  onClick={() => handleApply(false)}
                  className="px-5 py-2.5 rounded-xl border-2 border-story-purple text-story-purple font-bold hover:bg-purple-50 transition-colors text-sm"
                >
                  Apply Style
                </button>
                <button
                  onClick={() => handleApply(true)}
                  className="px-5 py-2.5 rounded-xl bg-story-purple text-white font-bold hover:bg-story-purple-dark transition-colors text-sm"
                >
                  Apply &amp; Reset Prompts
                </button>
              </>
            ) : (
              <button
                onClick={() => handleApply(false)}
                className="px-6 py-2.5 rounded-xl bg-story-purple text-white font-bold hover:bg-story-purple-dark transition-colors text-sm"
              >
                Select
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
