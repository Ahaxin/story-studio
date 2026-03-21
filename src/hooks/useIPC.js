// useIPC.js — React Query hooks that wrap window.electronAPI IPC calls.
// All Electron communication flows through these hooks.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import useStore from '../store/useStore'

// Safe wrapper in case electronAPI isn't available (e.g. browser-only dev)
const api = window.electronAPI ?? {}

// ── Project hooks ─────────────────────────────────────────────────────────────

export function useProjectList() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.storyList()
      if (!res.success) throw new Error(res.error)
      return res.data
    },
  })
}

export function useRenameProject() {
  const qc = useQueryClient()
  const { updateProjectField, updateScene } = useStore(s => ({
    updateProjectField: s.updateProjectField,
    updateScene: s.updateScene,
  }))

  return useMutation({
    mutationFn: async ({ projectId, name }) => {
      const res = await api.storyRename({ projectId, name })
      if (!res.success) throw new Error(res.error)
      return { name, coverScene: res.data }
    },
    onSuccess: ({ name, coverScene }) => {
      updateProjectField('name', name)
      if (coverScene) updateScene(coverScene.id, coverScene)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  const { currentProject, setCurrentProject } = useStore(s => ({
    currentProject: s.currentProject,
    setCurrentProject: s.setCurrentProject,
  }))

  return useMutation({
    mutationFn: async (projectId) => {
      const res = await api.storyDelete({ projectId })
      if (!res.success) throw new Error(res.error)
      return projectId
    },
    onSuccess: (projectId) => {
      if (currentProject?.id === projectId) setCurrentProject(null)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  const setCurrentProject = useStore(s => s.setCurrentProject)

  return useMutation({
    mutationFn: async ({ name, language, scenes, illustrationStyle, styleId }) => {
      const res = await api.storyCreate({ name, language, scenes, illustrationStyle, styleId })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      setCurrentProject(project)
    },
  })
}

export function useLoadProject() {
  const setCurrentProject = useStore(s => s.setCurrentProject)

  return useMutation({
    mutationFn: async (projectId) => {
      const res = await api.storyLoad({ projectId })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: (project) => {
      setCurrentProject(project)
    },
  })
}

// ── Scene hooks ───────────────────────────────────────────────────────────────

export function useGenerateIllustration() {
  const updateScene = useStore(s => s.updateScene)
  const addGenerating = useStore(s => s.addGenerating)
  const removeGenerating = useStore(s => s.removeGenerating)

  return useMutation({
    mutationFn: async ({ projectId, sceneId }) => {
      addGenerating(sceneId)
      const res = await api.sceneGenerateIllustration({ projectId, sceneId })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: (scene) => {
      updateScene(scene.id, scene)
      removeGenerating(scene.id)
    },
    onError: (_, { sceneId }) => {
      removeGenerating(sceneId)
    },
  })
}

export function useGenerateNarration() {
  const updateScene = useStore(s => s.updateScene)
  const addGenerating = useStore(s => s.addGenerating)
  const removeGenerating = useStore(s => s.removeGenerating)

  return useMutation({
    mutationFn: async ({ projectId, sceneId }) => {
      addGenerating(sceneId + '_audio')
      const res = await api.sceneGenerateNarration({ projectId, sceneId })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: (scene) => {
      updateScene(scene.id, scene)
      removeGenerating(scene.id + '_audio')
    },
    onError: (_, { sceneId }) => {
      removeGenerating(sceneId + '_audio')
    },
  })
}

export function useSaveSceneRecording() {
  const updateScene = useStore(s => s.updateScene)

  return useMutation({
    mutationFn: async ({ projectId, sceneId, audioBuffer }) => {
      const res = await api.sceneSaveRecording({ projectId, sceneId, audioBuffer })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: (scene) => {
      updateScene(scene.id, scene)
    },
  })
}

export function useUpdateScene() {
  const updateScene = useStore(s => s.updateScene)

  return useMutation({
    mutationFn: async ({ projectId, sceneId, updates }) => {
      const res = await api.sceneUpdate({ projectId, sceneId, updates })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    onSuccess: (scene) => {
      updateScene(scene.id, scene)
    },
  })
}

// ── Settings hooks ────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await api.settingsGet({})
      if (!res.success) throw new Error(res.error)
      return res.data
    },
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ key, value }) => {
      const res = await api.settingsSet({ key, value })
      if (!res.success) throw new Error(res.error)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

// ── Avatar hook ───────────────────────────────────────────────────────────────

export function useUploadAvatar() {
  return useMutation({
    mutationFn: async ({ projectId, daughter }) => {
      const res = await api.avatarUpload({ projectId, daughter })
      if (!res.success) throw new Error(res.error)
      return res.data
    },
  })
}

export function useUploadCharacterReference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ daughter }) => {
      const res = await api.avatarUploadReference({ daughter })
      if (!res.success) throw new Error(res.error)
      return res.data  // { characterReferencePath }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

// ── XTTS voice cloning hooks ──────────────────────────────────────────────────

/** Save a recorded voice sample (WebM ArrayBuffer → WAV conversion in main process) */
export function useSaveVoiceSample() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ daughter, audioBuffer }) => {
      const res = await api.voiceSaveSample({ daughter, audioBuffer })
      if (!res.success) throw new Error(res.error)
      return res.data  // { voiceSamplePath }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

/** Upload a recorded voice sample to ElevenLabs Instant Voice Clone. Returns { voiceId }. */
export function useElevenLabsCloneVoice() {
  return useMutation({
    mutationFn: async (args) => {
      const res = await api.elevenLabsCloneVoice(args)
      if (!res.success) throw new Error(res.error)
      return res.data  // { voiceId }
    },
  })
}

/** Poll XTTS server status every 5s — shows loading/ready/offline in Settings */
export function useXttsStatus() {
  return useQuery({
    queryKey: ['xtts-status'],
    queryFn: async () => {
      const res = await api.xttsStatus()
      if (!res.success) throw new Error(res.error)
      return res.data  // { status: 'loading'|'ready'|'offline' }
    },
    refetchInterval: 5000,
    retry: false,
  })
}

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
    mutationFn: async ({ name, description = '' }) => {
      const res = await api.characterAdd({ name, description })
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
    mutationFn: async ({ name }) => {
      const res = await api.characterRemove({ name })
      if (!res.success) throw new Error(res.error)
      return res.data  // updated array
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] })
    },
  })
}

/**
 * Scan a project's story text, extract named characters via LM Studio,
 * and generate a portrait reference image for each new character.
 * On success, invalidates the character library query.
 */
export function useAutoDiscoverCharacters() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId }) => {
      const res = await api.characterAutoDiscover({ projectId })
      if (!res.success) throw new Error(res.error)
      return res.data  // { added: [{name, imagePath, description}], skipped: [names], warning? }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] })
    },
  })
}

// ── LM Studio hooks ───────────────────────────────────────────────────────────

/** Check if LM Studio is running. Only refetches when manually triggered via refetch(). */
export function useLmStudioStatus() {
  return useQuery({
    queryKey: ['lmstudio-status'],
    queryFn: async () => {
      const res = await api.lmStudioStatus()
      if (!res.success) throw new Error(res.error)
      return res.data  // { online: boolean, modelId: string|null }
    },
    staleTime: Infinity,
    retry: false,
  })
}

/** Generate a full story (scenes + illustration prompts) from an idea via LM Studio. */
export function useGenerateStory() {
  return useMutation({
    mutationFn: async ({ idea, language, sceneCount }) => {
      const res = await api.lmStudioGenerateStory({ idea, language, sceneCount })
      if (!res.success) {
        const err = new Error(res.error)
        err.rawResponse = res.rawResponse
        throw err
      }
      return res.data  // { scenes: [{text, illustrationPrompt}], warned }
    },
  })
}

/** Generate a single illustration prompt for a scene via LM Studio. */
export function useGeneratePrompt() {
  return useMutation({
    mutationFn: async ({ sceneText, language, storyTitle, illustrationStyle }) => {
      const res = await api.lmStudioGeneratePrompt({ sceneText, language, storyTitle, illustrationStyle })
      if (!res.success) throw new Error(res.error)
      return res.data  // string
    },
  })
}

// ── Style preset hooks ─────────────────────────────────────────────────────────

/** Update the illustration style preset for the current project. */
export function useUpdateProjectStyle() {
  const patchCurrentProject = useStore(s => s.patchCurrentProject)

  return useMutation({
    mutationFn: async ({ projectId, styleId, illustrationStyle, clearPrompts }) => {
      const res = await api.storyUpdateStyle({ projectId, styleId, illustrationStyle, clearPrompts })
      if (!res.success) throw new Error(res.error)
      return res.data  // full updated project
    },
    onSuccess: (project) => {
      patchCurrentProject(project)
    },
  })
}

/** Generate AI preview images for all style presets that don't have one yet. */
export function useGenerateStylePreviews() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const res = await api.styleGeneratePreviews()
      if (!res.success) throw new Error(res.error)
      return res.data  // [{id, imagePath?, skipped?, error?}]
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stylePreviews'] })
    },
  })
}

/** Return { id: absoluteFilePath | null } map for all 8 style presets. */
export function useStylePreviews() {
  return useQuery({
    queryKey: ['stylePreviews'],
    queryFn: async () => {
      const res = await api.styleListPreviews()
      if (!res.success) throw new Error(res.error)
      return res.data  // { id: path | null }
    },
  })
}
