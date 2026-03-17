// SceneEditor.jsx — Right panel: full editing controls for the selected scene.

import React, { useState, useEffect, useRef } from 'react'
import useStore from '../store/useStore'
import {
  useGenerateIllustration,
  useGenerateNarration,
  useUpdateScene,
  useSaveSceneRecording,
  useGeneratePrompt,
} from '../hooks/useIPC'

const TRANSITIONS = [
  { value: 'page-curl', label: '🌀 Page Curl' },
  { value: 'slide',     label: '➡️ Slide' },
  { value: 'fade',      label: '🌫️ Fade' },
  { value: 'zoom',      label: '🔍 Zoom' },
]

export default function SceneEditor() {
  const { currentProject, selectedSceneId, generatingScenes, updateScene } = useStore()
  const genIllustration = useGenerateIllustration()
  const genNarration = useGenerateNarration()
  const saveRecording = useSaveSceneRecording()
  const updateSceneMutation = useUpdateScene()
  const generatePrompt = useGeneratePrompt()
  const [audioBust, setAudioBust] = useState(0)
  const [recordingBust, setRecordingBust] = useState(0)
  const [illustrationBust, setIllustrationBust] = useState(0)
  const [localText, setLocalText] = useState('')
  const [textDirty, setTextDirty] = useState(false)
  const [localPrompt, setLocalPrompt] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)
  const saveTimer = useRef(null)
  const promptTimer = useRef(null)
  const wasGeneratingIllustration = useRef(false)

  const scene = currentProject?.scenes?.find(s => s.id === selectedSceneId)

  // Sync local state when selected scene changes
  useEffect(() => {
    if (scene) {
      setLocalText(scene.text)
      setLocalPrompt(scene.illustrationPrompt || '')
      setTextDirty(false)
      setPromptDirty(false)
    }
  }, [selectedSceneId])

  // Keep prompt in sync after generation (only if user hasn't edited it locally)
  useEffect(() => {
    if (scene && !promptDirty) {
      setLocalPrompt(scene.illustrationPrompt || '')
    }
  }, [scene?.illustrationPrompt, scene?.illustrationPath])

  // Bust illustration cache when generation finishes (covers both Regenerate and Generate All)
  const isGeneratingIllustrationNow = scene ? generatingScenes.has(scene.id) : false
  useEffect(() => {
    if (wasGeneratingIllustration.current && !isGeneratingIllustrationNow) {
      setIllustrationBust(b => b + 1)
    }
    wasGeneratingIllustration.current = isGeneratingIllustrationNow
  }, [isGeneratingIllustrationNow])

  // Auto-save text after 1s of no typing
  useEffect(() => {
    if (!textDirty || !scene) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const words = localText.trim().split(/\s+/).filter(Boolean).length
      updateSceneMutation.mutate({
        projectId: currentProject.id,
        sceneId: scene.id,
        updates: { text: localText, wordCount: words },
      })
      setTextDirty(false)
    }, 1000)
    return () => clearTimeout(saveTimer.current)
  }, [localText, textDirty])

  // Auto-save illustration prompt after 1s of no typing
  useEffect(() => {
    if (!promptDirty || !scene) return
    clearTimeout(promptTimer.current)
    promptTimer.current = setTimeout(() => {
      updateSceneMutation.mutate({
        projectId: currentProject.id,
        sceneId: scene.id,
        updates: { illustrationPrompt: localPrompt },
      })
      setPromptDirty(false)
    }, 1000)
    return () => clearTimeout(promptTimer.current)
  }, [localPrompt, promptDirty])

  function handleTextChange(e) {
    setLocalText(e.target.value)
    setTextDirty(true)
  }

  function handleTransitionChange(transition) {
    updateScene(scene.id, { transition })
    updateSceneMutation.mutate({
      projectId: currentProject.id,
      sceneId: scene.id,
      updates: { transition },
    })
  }

  function handleNarratorChange(narrator) {
    updateScene(scene.id, { narrator })
    updateSceneMutation.mutate({
      projectId: currentProject.id,
      sceneId: scene.id,
      updates: { narrator },
    })
  }


  async function handleAiPrompt() {
    if (!scene) return
    generatePrompt.reset()
    try {
      const prompt = await generatePrompt.mutateAsync({
        sceneText: scene.text,
        language: currentProject.language,
        storyTitle: currentProject.name,
        illustrationStyle: currentProject.style.illustrationStyle || 'watercolor children\'s book',
      })
      setLocalPrompt(prompt)
      setPromptDirty(true)
    } catch (_) {
      // Error shown inline via generatePrompt.isError
    }
  }

  if (!scene) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-300">
        <div className="text-center">
          <div className="text-6xl mb-4">👈</div>
          <p className="text-lg font-semibold">Select a scene to edit</p>
        </div>
      </div>
    )
  }

  const isGeneratingIllustration = generatingScenes.has(scene.id)
  const isGeneratingNarration = generatingScenes.has(scene.id + '_audio')
  const narrator = scene.narrator || currentProject.style.activeNarrator
  const narratorProfile = currentProject.style[narrator]

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">

        {/* Scene header */}
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-story-purple text-white font-black flex items-center justify-center">
            {scene.index + 1}
          </span>
          <div>
            <h2 className="font-black text-gray-800 text-lg">
            {scene.index === 0 ? '⭐ Cover Page' : `Scene ${scene.index}`}
          </h2>
            <p className="text-xs text-gray-400 font-medium">{scene.wordCount} words · {scene.duration ? `${scene.duration.toFixed(1)}s` : 'duration TBD'}</p>
          </div>
          <div className="ml-auto">
            <StatusPill status={scene.status} />
          </div>
        </div>

        {/* Illustration panel */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <div className="relative bg-gray-100 aspect-video flex items-center justify-center">
            {isGeneratingIllustration ? (
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <div className="w-10 h-10 border-4 border-story-purple border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-semibold">Generating illustration…</p>
              </div>
            ) : scene.illustrationPath ? (
              <img
                key={illustrationBust}
                src={`localfile:///${scene.illustrationPath.replace(/\\/g, '/')}?t=${illustrationBust}`}
                alt={`Scene ${scene.index + 1}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-300">
                <span className="text-5xl">🖼</span>
                <p className="text-sm font-medium">No illustration yet</p>
              </div>
            )}
          </div>

          <div className="p-4 space-y-2">
            <button
              onClick={() => genIllustration.mutate({ projectId: currentProject.id, sceneId: scene.id })}
              disabled={isGeneratingIllustration}
              className="w-full bg-story-blue hover:bg-story-blue-dark disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
            >
              {scene.illustrationPath ? '🔄 Regenerate' : '🖼 Generate Illustration'}
            </button>
            {genIllustration.isError && (
              <p className="text-xs text-red-600 font-medium px-1">
                ❌ {genIllustration.error?.message}
              </p>
            )}
          </div>

          {/* Editable illustration prompt */}
          <div className="px-4 pb-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                Illustration Prompt
                {promptDirty && <span className="ml-2 font-normal normal-case text-story-yellow">saving…</span>}
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAiPrompt}
                  disabled={generatePrompt.isPending}
                  className="text-xs font-bold text-story-purple hover:text-story-purple-dark disabled:opacity-40 transition-colors"
                  title="Generate illustration prompt with AI (LM Studio)"
                >
                  {generatePrompt.isPending ? '⏳' : '✨ AI'}
                </button>
                {localPrompt && (
                  <button
                    onClick={() => {
                      setLocalPrompt('')
                      setPromptDirty(true)
                    }}
                    className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                    title="Clear prompt — next generate will auto-build"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            {generatePrompt.isError && (
              <p className="text-xs text-red-500">{generatePrompt.error?.message}</p>
            )}
            <textarea
              value={localPrompt}
              onChange={e => { setLocalPrompt(e.target.value); setPromptDirty(true) }}
              rows={3}
              placeholder={scene.index === 0
                ? 'Auto-builds cover style on first generate…'
                : 'Auto-builds from scene text on first generate…'}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 focus:border-story-purple focus:outline-none resize-none"
            />
            <p className="text-xs text-gray-400">
              Edit to customize. Clear to auto-rebuild on next generate.
              {scene.index === 0 && ' Cover page style is preserved on auto-build.'}
            </p>
          </div>
        </div>

        {/* Scene text */}
        <div className="bg-white rounded-2xl shadow-card p-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            Scene Text
            {textDirty && <span className="ml-2 text-xs text-story-yellow font-medium">saving…</span>}
            {!textDirty && updateSceneMutation.isSuccess && <span className="ml-2 text-xs text-green-500 font-medium">saved</span>}
          </label>
          <textarea
            value={localText}
            onChange={handleTextChange}
            rows={4}
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-gray-700 font-medium text-sm focus:border-story-purple focus:outline-none transition-colors resize-none leading-relaxed"
          />
        </div>

        {/* Narrator + TTS engine */}
        <div className="bg-white rounded-2xl shadow-card p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Narrator</h3>
          <div className="grid grid-cols-2 gap-3">
            {['daughter1', 'daughter2'].map(d => {
              const profile = currentProject.style[d]
              const label = profile?.name || (d === 'daughter1' ? 'Daughter 1' : 'Daughter 2')
              return (
                <button
                  key={d}
                  onClick={() => handleNarratorChange(d)}
                  className={`py-3 px-4 rounded-xl border-2 text-left transition-all ${
                    narrator === d
                      ? 'border-story-purple bg-purple-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="font-bold text-sm text-gray-800">👧 {label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {profile?.voiceEngine === 'elevenlabs' ? '☁️ ElevenLabs'
                    : '💻 Local Clone (XTTS)'}
                    {profile?.voiceEngine === 'elevenlabs' && profile?.voiceId && ` · ${profile.voiceId}`}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Narration audio */}
        <div className="bg-white rounded-2xl shadow-card p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Narration</h3>

          {scene.narrationPath && (
            <audio
              key={`${scene.narrationPath}-${audioBust}`}
              controls
              src={`localfile:///${scene.narrationPath.replace(/\\/g, '/')}?t=${audioBust}`}
              className="w-full mb-3"
              style={{ height: 36 }}
            />
          )}

          <button
            onClick={() => genNarration.mutate({ projectId: currentProject.id, sceneId: scene.id }, { onSuccess: () => setAudioBust(b => b + 1) })}
            disabled={isGeneratingNarration}
            className="w-full bg-story-pink hover:bg-story-pink-dark disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            {isGeneratingNarration
              ? '⏳ Generating…'
              : scene.narrationPath
              ? '🔄 Regenerate Narration'
              : '🎙 Generate Narration'}
          </button>
          {genNarration.isError && (
            <p className="text-xs text-red-600 font-medium px-1 mt-2">
              ❌ {genNarration.error?.message}
            </p>
          )}
        </div>

        {/* Direct recording */}
        <div className="bg-white rounded-2xl shadow-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700">Direct Recording</h3>
            {scene.recordingPath && scene.narrationPath && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                Recording active
              </span>
            )}
            {!scene.recordingPath && scene.narrationPath && (
              <span className="text-xs font-medium text-gray-400">Generated audio active</span>
            )}
          </div>

          {scene.recordingPath && (
            <audio
              key={`${scene.recordingPath}-${recordingBust}`}
              controls
              src={`localfile:///${scene.recordingPath.replace(/\\/g, '/')}?t=${recordingBust}`}
              className="w-full mb-3"
              style={{ height: 36 }}
            />
          )}

          <SceneRecorder
            projectId={currentProject.id}
            sceneId={scene.id}
            hasRecording={!!scene.recordingPath}
            saveRecording={saveRecording}
            onDone={() => setRecordingBust(b => b + 1)}
          />
          {saveRecording.isError && (
            <p className="text-xs text-red-600 font-medium px-1 mt-2">
              ❌ {saveRecording.error?.message}
            </p>
          )}
        </div>

        {/* Transition picker */}
        <div className="bg-white rounded-2xl shadow-card p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Transition into this scene</h3>
          <div className="grid grid-cols-4 gap-2">
            {TRANSITIONS.map(t => (
              <button
                key={t.value}
                onClick={() => handleTransitionChange(t.value)}
                className={`py-2.5 px-2 rounded-xl border-2 text-xs font-bold transition-all text-center ${
                  scene.transition === t.value
                    ? 'border-story-purple bg-purple-50 text-story-purple'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SceneRecorder({ projectId, sceneId, hasRecording, saveRecording, onDone }) {
  const [recState, setRecState] = useState('idle')  // 'idle'|'recording'|'processing'|'done'|'error'
  const [seconds, setSeconds] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  function startTimer() {
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }
  function stopTimer() { clearInterval(timerRef.current) }

  async function startRecording() {
    setErrorMsg('')
    setRecState('recording')
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stopTimer()
        streamRef.current?.getTracks().forEach(t => t.stop())
        setRecState('processing')

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const audioBuffer = await blob.arrayBuffer()
          await saveRecording.mutateAsync({ projectId, sceneId, audioBuffer })
          setRecState('done')
          onDone?.()
        } catch (err) {
          setErrorMsg(err.message)
          setRecState('error')
        }
      }

      recorder.start(250)
      startTimer()
    } catch (err) {
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Microphone access denied. Please allow microphone access.'
          : err.message
      )
      setRecState('error')
    }
  }

  function stopRecording() { recorderRef.current?.stop() }

  function reset() {
    stopTimer()
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    setRecState('idle')
    setSeconds(0)
    setErrorMsg('')
  }

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="space-y-2">
      {recState === 'recording' && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="font-black text-red-700 text-lg tabular-nums">{formatTime(seconds)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={stopRecording}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-xl text-sm transition-colors"
            >
              ⏹ Stop Recording
            </button>
            <button
              onClick={reset}
              className="px-4 py-2 rounded-xl border-2 border-gray-200 text-gray-500 font-bold text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {recState === 'processing' && (
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
          <div className="w-5 h-5 border-2 border-story-yellow border-t-transparent rounded-full animate-spin shrink-0" />
          <p className="text-sm font-medium text-yellow-800">Processing recording…</p>
        </div>
      )}

      {recState === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <p className="text-xs font-bold text-red-700">❌ {errorMsg}</p>
        </div>
      )}

      {(recState === 'idle' || recState === 'done' || recState === 'error') && (
        <button
          onClick={startRecording}
          className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
        >
          🔴 {hasRecording ? 'Re-record' : 'Record Narration'}
        </button>
      )}

      {!hasRecording && recState === 'idle' && (
        <p className="text-xs text-gray-400 text-center">
          Recording is preferred over generated audio for export
        </p>
      )}
    </div>
  )
}

function StatusPill({ status }) {
  const config = {
    pending:             { label: 'Pending',    className: 'bg-gray-100 text-gray-500' },
    'illustration-done': { label: 'Art done',   className: 'bg-blue-100 text-blue-600' },
    'narration-done':    { label: 'Audio done', className: 'bg-yellow-100 text-yellow-700' },
    ready:               { label: '✅ Ready',   className: 'bg-green-100 text-green-700' },
  }[status] ?? { label: status, className: 'bg-gray-100 text-gray-500' }

  return (
    <span className={`text-xs font-bold px-3 py-1 rounded-full ${config.className}`}>
      {config.label}
    </span>
  )
}

