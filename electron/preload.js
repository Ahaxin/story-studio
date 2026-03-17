// Preload script — exposes IPC channels to the renderer via contextBridge.
// Only channels explicitly listed here are accessible from React.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Story management
  storyCreate: (args) => ipcRenderer.invoke('story:create', args),
  storyLoad: (args) => ipcRenderer.invoke('story:load', args),
  storyList: () => ipcRenderer.invoke('story:list'),
  storyDelete: (args) => ipcRenderer.invoke('story:delete', args),
  storyRename: (args) => ipcRenderer.invoke('story:rename', args),

  // Scene operations
  sceneGenerateIllustration: (args) => ipcRenderer.invoke('scene:generate-illustration', args),
  sceneGenerateNarration: (args) => ipcRenderer.invoke('scene:generate-narration', args),
  sceneSaveRecording: (args) => ipcRenderer.invoke('scene:save-recording', args),
  sceneUpdate: (args) => ipcRenderer.invoke('scene:update', args),

  // Video assembly
  videoAssemble: (args) => ipcRenderer.invoke('video:assemble', args),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
  onVideoProgress: (callback) => ipcRenderer.on('video:progress', (_event, data) => callback(data)),
  offVideoProgress: () => ipcRenderer.removeAllListeners('video:progress'),

  // Avatar
  avatarUpload: (args) => ipcRenderer.invoke('avatar:upload', args),
  avatarUploadReference: (args) => ipcRenderer.invoke('avatar:upload-reference', args),

  // Settings
  settingsGet: (args) => ipcRenderer.invoke('settings:get', args),
  settingsSet: (args) => ipcRenderer.invoke('settings:set', args),

  // Voice cloning (XTTS + ElevenLabs)
  voiceSaveSample: (args) => ipcRenderer.invoke('voice:save-sample', args),
  elevenLabsCloneVoice: (args) => ipcRenderer.invoke('elevenlabs:clone-voice', args),
  xttsStatus: () => ipcRenderer.invoke('xtts:status'),
  onXttsStatusUpdate: (callback) =>
    ipcRenderer.on('xtts:status-update', (_event, data) => callback(data)),
  offXttsStatusUpdate: () =>
    ipcRenderer.removeAllListeners('xtts:status-update'),

  // Character reference library
  characterList:   ()     => ipcRenderer.invoke('character:list'),
  characterAdd:    (args) => ipcRenderer.invoke('character:add', args),
  characterRemove: (args) => ipcRenderer.invoke('character:remove', args),

  // LM Studio (local LLM)
  lmStudioStatus:          ()     => ipcRenderer.invoke('lmstudio:status'),
  lmStudioGenerateStory:   (args) => ipcRenderer.invoke('lmstudio:generate-story', args),
  lmStudioGeneratePrompt:  (args) => ipcRenderer.invoke('lmstudio:generate-prompt', args),
})
