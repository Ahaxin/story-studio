// VoiceRecorder.jsx — Record a daughter's voice sample for XTTS cloning.
// Uses the browser MediaRecorder API (mic permission granted by Electron main).
// Sends the recorded WebM buffer to main via IPC → converted to WAV there.

import React, { useState, useRef, useEffect } from 'react'

const MIN_SECONDS = 6    // XTTS v2 minimum for acceptable quality
const TARGET_SECONDS = 15  // recommended duration shown in UI

// Recording prompt text shown to the user so they have something to read
const PROMPTS = {
  'nl-NL': 'Hallo! Mijn naam is... Ik vertel je vandaag een mooi verhaal over avontuur en vriendschap. Er was eens een kleine beer die de wereld wilde ontdekken.',
  'zh-CN': '你好！我的名字是……今天我要给你讲一个关于冒险和友谊的美丽故事。从前有一只小熊，它想去探索世界。',
}

export default function VoiceRecorder({ daughter, existingSample, language = 'nl-NL', onSampleSaved, onSave, onCloneDone, processingLabel }) {
  const [state, setState] = useState('idle')  // 'idle'|'recording'|'processing'|'done'|'error'
  const [seconds, setSeconds] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [savedPath, setSavedPath] = useState(existingSample || '')

  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  // Keep savedPath in sync if prop changes (e.g. settings reloaded)
  useEffect(() => {
    if (existingSample) setSavedPath(existingSample)
  }, [existingSample])

  function startTimer() {
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }

  function stopTimer() {
    clearInterval(timerRef.current)
  }

  async function startRecording() {
    setErrorMsg('')
    setState('recording')
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
        setState('processing')

        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const arrayBuffer = await blob.arrayBuffer()

          if (onSave) {
            const result = await onSave(arrayBuffer)  // result = { voiceId }
            setState('done')
            onCloneDone?.(result)
          } else {
            const res = await window.electronAPI.voiceSaveSample({ daughter, audioBuffer: arrayBuffer })
            if (!res.success) throw new Error(res.error)
            setSavedPath(res.data.voiceSamplePath)
            setState('done')
            onSampleSaved?.(res.data.voiceSamplePath)
          }
        } catch (err) {
          setErrorMsg(err.message)
          setState('error')
        }
      }

      recorder.start(250)  // collect data every 250ms
      startTimer()
    } catch (err) {
      // Common: user denied mic permission
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Please allow microphone access and try again.'
          : err.message
      )
      setState('error')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  function reset() {
    stopTimer()
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    setState('idle')
    setSeconds(0)
    setErrorMsg('')
  }

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const tooShort = seconds < MIN_SECONDS
  const prompt = PROMPTS[language] || PROMPTS['nl-NL']

  return (
    <div className="space-y-3">
      {/* Existing sample indicator */}
      {savedPath && state !== 'recording' && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
          <span className="text-green-600 text-sm">✅</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-green-800">Voice sample recorded</p>
            <p className="text-xs text-green-600 truncate">{savedPath.split(/[\\/]/).pop()}</p>
          </div>
          <audio
            controls
            preload="metadata"
            src={`localfile:///${savedPath.replace(/\\/g, '/')}`}
            className="h-7"
            style={{ minWidth: 140 }}
          />
        </div>
      )}

      {/* Reading prompt */}
      {state === 'idle' && (
        <div className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2.5">
          <p className="text-xs font-bold text-purple-700 mb-1">
            Read this aloud when recording:
          </p>
          <p className="text-xs text-purple-600 leading-relaxed italic">
            "{prompt}"
          </p>
          <p className="text-xs text-purple-400 mt-1.5 font-medium">
            Aim for {TARGET_SECONDS}+ seconds in a natural, expressive voice.
          </p>
        </div>
      )}

      {/* Recording UI */}
      {state === 'recording' && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
            {/* Pulsing red dot */}
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="font-black text-red-700 text-lg tabular-nums">
              {formatTime(seconds)}
            </span>
            {tooShort && (
              <span className="text-xs text-red-500 font-medium">
                Keep going… (min {MIN_SECONDS}s)
              </span>
            )}
          </div>

          <p className="text-xs text-red-600 italic leading-relaxed">
            "{prompt}"
          </p>

          <button
            onClick={stopRecording}
            disabled={tooShort}
            className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 rounded-xl text-sm transition-colors"
          >
            {tooShort
              ? `⏸ Stop (wait ${MIN_SECONDS - seconds}s more…)`
              : '⏹ Stop Recording'}
          </button>
        </div>
      )}

      {/* Processing */}
      {state === 'processing' && (
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
          <div className="w-5 h-5 border-2 border-story-yellow border-t-transparent rounded-full animate-spin shrink-0" />
          <p className="text-sm font-medium text-yellow-800">
            {processingLabel || 'Converting recording… (one moment)'}
          </p>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <p className="text-xs font-bold text-red-700">❌ {errorMsg}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {(state === 'idle' || state === 'error' || state === 'done') && (
          <button
            onClick={startRecording}
            className="flex-1 flex items-center justify-center gap-2 bg-story-pink hover:bg-story-pink-dark text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            🎙 {savedPath ? 'Re-record Sample' : 'Record Voice Sample'}
          </button>
        )}

        {state === 'recording' && (
          <button
            onClick={reset}
            className="px-4 py-2.5 rounded-xl border-2 border-gray-200 text-gray-500 font-bold text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
