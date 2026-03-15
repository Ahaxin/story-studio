// Sidebar.jsx — Project list, New Story button, navigation icons.

import React from 'react'
import useStore from '../store/useStore'
import { useProjectList, useLoadProject, useDeleteProject } from '../hooks/useIPC'

const LANG_FLAG = { 'nl-NL': '🇳🇱', 'zh-CN': '🇨🇳' }

export default function Sidebar() {
  const { currentPage, setPage, openNewStoryModal, currentProject } = useStore()
  const { data: projects = [], isLoading } = useProjectList()
  const loadProject = useLoadProject()
  const deleteProject = useDeleteProject()

  function handleProjectClick(projectId) {
    if (currentProject?.id === projectId) {
      setPage('editor')
      return
    }
    loadProject.mutate(projectId)
  }

  return (
    <aside className="w-64 min-w-[240px] bg-white border-r border-gray-100 flex flex-col h-full shadow-sm">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <h1 className="text-2xl font-black text-story-purple leading-none">
          Story<span className="text-story-yellow">Studio</span>
        </h1>
        <p className="text-xs text-gray-400 font-semibold mt-1 uppercase tracking-wide">
          Kids Video Maker
        </p>
      </div>

      {/* New Story button */}
      <div className="px-4 py-3">
        <button
          onClick={openNewStoryModal}
          className="w-full bg-story-purple hover:bg-story-purple-dark text-white font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-story"
        >
          <span className="text-lg">+</span> New Story
        </button>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">
          Your Stories
        </p>

        {isLoading && (
          <div className="text-center py-8 text-gray-300 text-sm">Loading...</div>
        )}

        {!isLoading && projects.length === 0 && (
          <div className="text-center py-8 text-gray-300 text-sm">
            No stories yet.<br />Create your first one!
          </div>
        )}

        {projects.map(p => {
          const isActive = currentProject?.id === p.id
          return (
            <div key={p.id} className="relative group/item mb-1">
              <button
                onClick={() => handleProjectClick(p.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors pr-8 ${
                  isActive
                    ? 'bg-story-purple text-white'
                    : 'hover:bg-purple-50 text-gray-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{LANG_FLAG[p.language] ?? '📖'}</span>
                  <span className={`font-semibold text-sm truncate flex-1 ${isActive ? 'text-white' : ''}`}>
                    {p.name}
                  </span>
                </div>
                <p className={`text-xs mt-0.5 pl-6 ${isActive ? 'text-purple-200' : 'text-gray-400'}`}>
                  {new Date(p.createdAt).toLocaleDateString()}
                </p>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`Delete "${p.name}"? This cannot be undone.`)) {
                    deleteProject.mutate(p.id)
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all text-xs"
                title="Delete story"
              >
                🗑
              </button>
            </div>
          )
        })}
      </div>

      {/* Bottom nav */}
      <div className="border-t border-gray-100 px-4 py-3 flex gap-2">
        {currentProject && (
          <NavIcon
            active={currentPage === 'editor'}
            onClick={() => setPage('editor')}
            title="Back to Editor"
          >
            📖
          </NavIcon>
        )}
        {currentProject && (
          <NavIcon
            active={currentPage === 'export'}
            onClick={() => setPage('export')}
            title="Export"
          >
            📤
          </NavIcon>
        )}
        <NavIcon
          active={currentPage === 'settings'}
          onClick={() => setPage('settings')}
          title="Settings"
        >
          ⚙️
        </NavIcon>
      </div>
    </aside>
  )
}

function NavIcon({ children, active, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 py-2 rounded-xl text-xl transition-colors ${
        active ? 'bg-story-purple text-white' : 'hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}
