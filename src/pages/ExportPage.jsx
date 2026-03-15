// ExportPage.jsx — Export controls: pre-flight checklist, settings, progress, output.

import React, { useState, useEffect } from 'react'
import useStore from '../store/useStore'

const STATUS_ICON = {
  pending:             '⬜',
  'illustration-done': '🖼',
  'narration-done':    '🎙',
  ready:               '✅',
}

export default function ExportPage() {
  const {
    currentProject,
    exportProgress,
    isExporting,
    setExportProgress,
    setIsExporting,
  } = useStore()

  const [resolution, setResolution] = useState('1920x1080')
  const [fps, setFps] = useState('30')
  const [outputPath, setOutputPath] = useState('')
  const [exportError, setExportError] = useState('')
  const [exportDone, setExportDone] = useState(false)

  useEffect(() => {
    if (!currentProject) return
    setOutputPath(currentProject.export?.outputPath || '')
  }, [currentProject?.id])

  // Listen for video progress events from main process
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.onVideoProgress(({ percent }) => {
      setExportProgress(percent)
      if (percent >= 100) setExportDone(true)
    })
    return () => window.electronAPI.offVideoProgress()
  }, [])

  if (!currentProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cream">
        <p className="text-gray-400 font-medium">Open a story to export it.</p>
      </div>
    )
  }

  const { scenes } = currentProject
  const readyScenes = scenes.filter(s => s.status === 'ready')
  const notReadyScenes = scenes.filter(s => s.status !== 'ready')
  const canExport = readyScenes.length === scenes.length && !isExporting

  async function handleExport() {
    setExportError('')
    setExportDone(false)
    setIsExporting(true)
    setExportProgress(0)

    try {
      const res = await window.electronAPI.videoAssemble({ projectId: currentProject.id })
      if (!res.success) throw new Error(res.error)
      setOutputPath(res.data.outputPath)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setIsExporting(false)
    }
  }

  function openOutputFolder() {
    if (!outputPath || !window.electronAPI) return
    window.electronAPI.showItemInFolder(outputPath)
  }

  const totalDuration = readyScenes.reduce((sum, s) => sum + (s.duration || 0), 0)
  const durationMin = Math.floor(totalDuration / 60)
  const durationSec = Math.round(totalDuration % 60)

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h2 className="text-2xl font-black text-gray-800">📤 Export Video</h2>
          <p className="text-gray-400 font-medium mt-1">{currentProject.name}</p>
        </div>

        {/* Scene readiness checklist */}
        <div className="bg-white rounded-2xl shadow-card p-5">
          <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
            Scene Checklist
            <span className="ml-auto text-sm font-medium text-gray-400">
              {readyScenes.length}/{scenes.length} ready
            </span>
          </h3>

          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {scenes.map(scene => (
              <div key={scene.id} className="flex items-center gap-3 py-1.5">
                <span className="text-lg">{STATUS_ICON[scene.status] ?? '⬜'}</span>
                <span className="text-sm font-medium text-gray-700 flex-1 truncate">
                  Scene {scene.index + 1}: {scene.text.substring(0, 50)}…
                </span>
                <span className={`text-xs font-bold ${scene.status === 'ready' ? 'text-green-600' : 'text-red-400'}`}>
                  {scene.status === 'ready' ? 'Ready' : scene.status}
                </span>
              </div>
            ))}
          </div>

          {notReadyScenes.length > 0 && (
            <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2.5 text-sm text-yellow-800 font-medium">
              ⚠️ {notReadyScenes.length} scene{notReadyScenes.length > 1 ? 's' : ''} not ready.
              Generate illustration + narration for all scenes before exporting.
            </div>
          )}
        </div>

        {/* Export settings */}
        <div className="bg-white rounded-2xl shadow-card p-5">
          <h3 className="font-bold text-gray-700 mb-4">Export Settings</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                Resolution
              </label>
              <div className="flex gap-2">
                {['1920x1080', '1280x720'].map(r => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                      resolution === r
                        ? 'border-story-purple bg-purple-50 text-story-purple'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {r === '1920x1080' ? '1080p' : '720p'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                Frame Rate
              </label>
              <div className="flex gap-2">
                {['30', '24'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFps(f)}
                    className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                      fps === f
                        ? 'border-story-purple bg-purple-50 text-story-purple'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          {readyScenes.length > 0 && (
            <div className="mt-4 text-xs text-gray-400 font-medium">
              Estimated duration: ~{durationMin}:{durationSec.toString().padStart(2, '0')} · {readyScenes.length} scenes
            </div>
          )}
        </div>

        {/* Export button + progress */}
        <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="w-full bg-story-purple hover:bg-story-purple-dark disabled:opacity-40 text-white font-black py-4 rounded-xl text-lg transition-colors shadow-story"
          >
            {isExporting ? '⏳ Exporting…' : '📤 Export MP4'}
          </button>

          {isExporting && (
            <div>
              <div className="flex justify-between text-sm font-bold text-gray-600 mb-1.5">
                <span>Encoding video…</span>
                <span>{exportProgress}%</span>
              </div>
              <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-story-purple h-full rounded-full transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5 font-medium">
                This may take a few minutes. Do not close the app.
              </p>
            </div>
          )}

          {exportError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">
              ❌ {exportError}
            </div>
          )}

          {exportDone && outputPath && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <p className="text-green-800 font-bold text-sm mb-1">✅ Export complete!</p>
              <p className="text-green-700 text-xs font-medium break-all">{outputPath}</p>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => window.electronAPI.openPath(outputPath)}
                  className="flex-1 bg-story-purple hover:bg-story-purple-dark text-white font-bold py-2 rounded-xl text-xs transition-colors"
                >
                  ▶ Play Video
                </button>
                <button
                  onClick={openOutputFolder}
                  className="flex-1 border-2 border-gray-200 hover:border-gray-300 text-gray-600 font-bold py-2 rounded-xl text-xs transition-colors"
                >
                  📁 Open Folder
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
