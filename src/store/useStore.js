// useStore.js — Global UI state via Zustand.
// Async data (IPC calls) lives in React Query hooks. This store handles
// navigation, selected scene, modal visibility, and optimistic UI updates.

import { create } from 'zustand'

const useStore = create((set, get) => ({
  // ── Navigation ────────────────────────────────────────────────────────────
  currentPage: 'home',   // 'home' | 'editor' | 'export' | 'settings'
  setPage: (page) => set({ currentPage: page }),

  // ── Project state ─────────────────────────────────────────────────────────
  projectList: [],
  setProjectList: (list) => set({ projectList: list }),

  currentProject: null,
  setCurrentProject: (project) => set({
    currentProject: project,
    selectedSceneId: project?.scenes?.[0]?.id ?? null,
    currentPage: 'editor',
  }),

  // Patch the in-memory project (after IPC write succeeds)
  updateProjectField: (field, value) => set((state) => ({
    currentProject: state.currentProject
      ? { ...state.currentProject, [field]: value }
      : null,
  })),

  // Update a single scene in the current project
  updateScene: (sceneId, updates) => set((state) => ({
    currentProject: state.currentProject ? {
      ...state.currentProject,
      scenes: state.currentProject.scenes.map(s =>
        s.id === sceneId ? { ...s, ...updates } : s
      ),
    } : null,
  })),

  reorderScenes: (fromIndex, toIndex) => set((state) => {
    if (!state.currentProject) return {}
    const scenes = [...state.currentProject.scenes]
    const [moved] = scenes.splice(fromIndex, 1)
    scenes.splice(toIndex, 0, moved)
    // Re-index
    const reindexed = scenes.map((s, i) => ({ ...s, index: i }))
    return { currentProject: { ...state.currentProject, scenes: reindexed } }
  }),

  // ── Scene selection ───────────────────────────────────────────────────────
  selectedSceneId: null,
  setSelectedSceneId: (id) => set({ selectedSceneId: id }),

  // ── Modal ─────────────────────────────────────────────────────────────────
  isNewStoryModalOpen: false,
  openNewStoryModal: () => set({ isNewStoryModalOpen: true }),
  closeNewStoryModal: () => set({ isNewStoryModalOpen: false }),

  // ── Export state ──────────────────────────────────────────────────────────
  exportProgress: 0,
  isExporting: false,
  setExportProgress: (p) => set({ exportProgress: p }),
  setIsExporting: (v) => set({ isExporting: v }),

  // ── Per-scene generation loading ──────────────────────────────────────────
  generatingScenes: new Set(),   // Set of sceneIds currently being generated
  addGenerating: (sceneId) => set((state) => ({
    generatingScenes: new Set([...state.generatingScenes, sceneId]),
  })),
  removeGenerating: (sceneId) => set((state) => {
    const next = new Set(state.generatingScenes)
    next.delete(sceneId)
    return { generatingScenes: next }
  }),
}))

export default useStore
