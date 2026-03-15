// StoryEditor.jsx — Main two-panel editing view: SceneList (left) + SceneEditor (right).

import React, { useState, useRef } from 'react'
import useStore from '../store/useStore'
import SceneList from '../components/SceneList'
import SceneEditor from '../components/SceneEditor'
import { useRenameProject } from '../hooks/useIPC'

const LANG_FLAG = { 'nl-NL': '🇳🇱', 'zh-CN': '🇨🇳' }
const LANG_LABEL = { 'nl-NL': 'Nederlands', 'zh-CN': 'Chinese' }

export default function StoryEditor() {
  const { currentProject, updateProjectField } = useStore(s => ({
    currentProject: s.currentProject,
    updateProjectField: s.updateProjectField,
  }))
  const renameProject = useRenameProject()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameDoneRef = useRef(false)

  function startRename() {
    setRenameValue(currentProject.name)
    renameDoneRef.current = false
    setRenaming(true)
  }

  function submitRename() {
    if (renameDoneRef.current) return   // guard against onBlur firing after Enter
    renameDoneRef.current = true
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== currentProject.name) {
      updateProjectField('name', trimmed)   // optimistic — show new name immediately
      renameProject.mutate({ projectId: currentProject.id, name: trimmed })
    }
    setRenaming(false)
  }

  if (!currentProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cream">
        <div className="text-center max-w-sm">
          <div className="text-7xl mb-5">📖</div>
          <h2 className="text-2xl font-black text-gray-700 mb-2">
            No story open
          </h2>
          <p className="text-gray-400 font-medium">
            Select a story from the sidebar or create a new one.
          </p>
        </div>
      </div>
    )
  }

  const readyCount = currentProject.scenes.filter(s => s.status === 'ready').length

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 px-5 py-3 flex items-center gap-4 shrink-0">
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(false) }}
              autoFocus
              className="font-black text-gray-800 text-lg w-full border-b-2 border-story-purple outline-none bg-transparent truncate"
            />
          ) : (
            <h2
              onClick={startRename}
              title="Click to rename"
              className="font-black text-gray-800 text-lg truncate cursor-pointer hover:text-story-purple transition-colors"
            >
              {currentProject.name} ✏️
            </h2>
          )}
          <p className="text-xs text-gray-400 font-medium">
            {currentProject.scenes.length} scenes · {readyCount} ready
          </p>
        </div>

        {/* Language badge */}
        <div className="flex items-center gap-1.5 bg-gray-100 rounded-xl px-3 py-1.5">
          <span className="text-base">{LANG_FLAG[currentProject.language]}</span>
          <span className="text-xs font-bold text-gray-600">{LANG_LABEL[currentProject.language]}</span>
        </div>

        {/* Active narrator toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {['daughter1', 'daughter2'].map(d => {
            const profile = currentProject.style[d]
            const label = profile?.name || (d === 'daughter1' ? 'D1' : 'D2')
            const isActive = currentProject.style.activeNarrator === d
            return (
              <button
                key={d}
                onClick={() => updateProjectField('style', {
                  ...currentProject.style,
                  activeNarrator: d,
                })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-white text-story-purple shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                👧 {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Two-panel editor */}
      <div className="flex flex-1 min-h-0">
        <SceneList />
        <SceneEditor />
      </div>
    </div>
  )
}
