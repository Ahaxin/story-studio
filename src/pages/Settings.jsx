// Settings.jsx — API keys, daughter voice profiles, Piper model paths, XTTS setup.

import React, { useState, useEffect } from 'react'
import { useSettings, useSaveSettings, useXttsStatus, useUploadCharacterReference, useElevenLabsCloneVoice, useCharacterList, useAddCharacter, useRemoveCharacter, useLmStudioStatus } from '../hooks/useIPC'
import VoiceRecorder from '../components/VoiceRecorder'

export default function Settings() {
  const { data: settings, isLoading } = useSettings()
  const saveSetting = useSaveSettings()
  const { data: xttsData } = useXttsStatus()
  const { data: lmStudioData, refetch: recheckLmStudio, isFetching: lmChecking } = useLmStudioStatus()

  const [nanoBananaKey, setNanoBananaKey] = useState('')
  const [elevenLabsKey, setElevenLabsKey] = useState('')
  const [piperModelsPath, setPiperModelsPath] = useState('')
  const [daughters, setDaughters] = useState({
    daughter1: { name: '', voiceEngine: 'xtts', voiceId: '', voiceSamplePath: '', characterPrompt: '' },
    daughter2: { name: '', voiceEngine: 'xtts', voiceId: '', voiceSamplePath: '', characterPrompt: '' },
  })
  const [saved, setSaved] = useState(false)
  const [xttsStatus, setXttsStatus] = useState('unknown')

  // Load settings into local state
  useEffect(() => {
    if (!settings) return
    setNanoBananaKey(settings.nanoBananaApiKey || '')
    setElevenLabsKey(settings.elevenLabsApiKey || '')
    setPiperModelsPath(settings.piperModelsPath || './resources/piper/models')
    if (settings.daughters) setDaughters(settings.daughters)
  }, [settings])

  // Track XTTS server status from polling + real-time events
  useEffect(() => {
    if (xttsData?.status) setXttsStatus(xttsData.status)
  }, [xttsData])

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.onXttsStatusUpdate(({ status }) => setXttsStatus(status))
    return () => window.electronAPI.offXttsStatusUpdate()
  }, [])

  async function handleSave() {
    await saveSetting.mutateAsync({ key: 'nanoBananaApiKey', value: nanoBananaKey })
    await saveSetting.mutateAsync({ key: 'elevenLabsApiKey', value: elevenLabsKey })
    await saveSetting.mutateAsync({ key: 'piperModelsPath', value: piperModelsPath })
    await saveSetting.mutateAsync({ key: 'daughters', value: daughters })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function updateDaughter(d, field, value) {
    setDaughters(prev => ({
      ...prev,
      [d]: { ...prev[d], [field]: value },
    }))
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-300">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-story-purple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="font-medium">Loading settings…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h2 className="text-2xl font-black text-gray-800">⚙️ Settings</h2>
          <p className="text-gray-400 font-medium mt-1">API keys and voice profiles</p>
        </div>

        {/* XTTS server status banner */}
        <XttsStatusBanner status={xttsStatus} />

        {/* LM Studio status banner */}
        <LmStudioStatusBanner data={lmStudioData} onRecheck={recheckLmStudio} checking={lmChecking} />

        {/* API Keys */}
        <Section title="🔑 API Keys">
          <ApiKeyField
            label="Nano Banana API Key (Google AI Studio)"
            value={nanoBananaKey}
            onChange={setNanoBananaKey}
            placeholder="AIza…"
          />
          <ApiKeyField
            label="ElevenLabs API Key"
            value={elevenLabsKey}
            onChange={setElevenLabsKey}
            placeholder="sk_…"
          />
        </Section>

        {/* Daughter profiles */}
        {['daughter1', 'daughter2'].map((d, i) => (
          <DaughterSection
            key={d}
            daughterKey={d}
            index={i}
            profile={daughters[d]}
            xttsStatus={xttsStatus}
            onUpdate={(field, value) => updateDaughter(d, field, value)}
            onSampleSaved={(path) => updateDaughter(d, 'voiceSamplePath', path)}
            onReferenceSaved={(path) => updateDaughter(d, 'characterReferencePath', path)}
          />
        ))}

        {/* Character reference library */}
        <CharacterReferencesSection />

        {/* Save button */}
        <div className="flex justify-end pb-4">
          <button
            onClick={handleSave}
            disabled={saveSetting.isPending}
            className="bg-story-purple hover:bg-story-purple-dark text-white font-black px-8 py-3 rounded-xl transition-colors shadow-story disabled:opacity-60"
          >
            {saved ? '✅ Saved!' : saveSetting.isPending ? 'Saving…' : '💾 Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Daughter Section ──────────────────────────────────────────────────────────

function DaughterSection({ daughterKey, index, profile, xttsStatus, onUpdate, onSampleSaved, onReferenceSaved }) {
  const VOICE_ENGINES = [
    { value: 'xtts',       label: '💻 Local Clone',  sub: 'Your daughter\'s voice · offline' },
    { value: 'elevenlabs', label: '☁️ ElevenLabs',   sub: 'Online clone · best quality' },
  ]

  return (
    <Section title={`👧 Daughter ${index + 1}`}>
      {/* Name */}
      <div>
        <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
          Name
        </label>
        <input
          type="text"
          value={profile.name || ''}
          onChange={e => onUpdate('name', e.target.value)}
          placeholder={index === 0 ? 'Emma' : 'Sophie'}
          className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 focus:border-story-purple focus:outline-none"
        />
      </div>

      {/* Voice engine selector */}
      <div>
        <label className="block text-xs font-bold text-gray-600 mb-2 uppercase tracking-wide">
          Voice Engine
        </label>
        <div className="grid grid-cols-2 gap-2">
          {VOICE_ENGINES.map(opt => (
            <button
              key={opt.value}
              onClick={() => onUpdate('voiceEngine', opt.value)}
              className={`py-2.5 px-3 rounded-xl border-2 text-left transition-all ${
                profile.voiceEngine === opt.value
                  ? 'border-story-purple bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className={`text-xs font-bold ${profile.voiceEngine === opt.value ? 'text-story-purple' : 'text-gray-700'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Engine-specific options */}
      {profile.voiceEngine === 'elevenlabs' ? (
        <ElevenLabsVoiceSection
          daughterKey={daughterKey}
          profile={profile}
          onUpdate={onUpdate}
        />
      ) : (
        <XttsVoiceSection
          daughterKey={daughterKey}
          profile={profile}
          xttsStatus={xttsStatus}
          onSampleSaved={onSampleSaved}
        />
      )}

      {/* Character prompt for AI avatar (shown for all engine types) */}
      <div>
        <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
          AI Avatar Character Prompt
        </label>
        <textarea
          value={profile.characterPrompt || ''}
          onChange={e => onUpdate('characterPrompt', e.target.value)}
          placeholder="A young girl with long brown hair, bright blue eyes, wearing a red dress, children's book watercolor style"
          rows={2}
          className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 focus:border-story-purple focus:outline-none resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">
          Used when Avatar Mode is set to "AI Generated" in Scene Editor.
        </p>
      </div>

      {/* Character reference image */}
      <CharacterReferenceUpload
        daughterKey={daughterKey}
        profile={profile}
        onReferenceSaved={onReferenceSaved}
      />
    </Section>
  )
}

// ── XTTS-specific section within a daughter card ──────────────────────────────

function XttsVoiceSection({ daughterKey, profile, xttsStatus, onSampleSaved }) {
  const serverOk = xttsStatus === 'ready'

  return (
    <div className="space-y-3">
      {/* Server not ready warning */}
      {!serverOk && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-xs font-bold text-amber-800 mb-1">
            {xttsStatus === 'loading'
              ? '⏳ XTTS model is loading — recording will work, but synthesis won\'t start until it\'s ready.'
              : '⚠️ XTTS server is offline.'}
          </p>
          {xttsStatus === 'offline' && (
            <p className="text-xs text-amber-700">
              You can still record a sample now. To enable synthesis, run:<br />
              <code className="bg-amber-100 px-1 rounded text-amber-900 font-mono">
                python resources/xtts_server.py
              </code>
            </p>
          )}
        </div>
      )}

      {/* VoiceRecorder */}
      <VoiceRecorder
        daughter={daughterKey}
        existingSample={profile.voiceSamplePath || null}
        language="nl-NL"
        onSampleSaved={onSampleSaved}
      />

      <p className="text-xs text-gray-400 leading-relaxed">
        Record 10–20 seconds of your daughter speaking naturally.
        XTTS will learn her voice timbre from this clip and apply it to any text in any language.
      </p>
    </div>
  )
}

// ── ElevenLabs voice cloning section within a daughter card ──────────────────

function ElevenLabsVoiceSection({ daughterKey, profile, onUpdate }) {
  const cloneVoice = useElevenLabsCloneVoice()
  const [copied, setCopied] = useState(false)

  const nameEmpty = !(profile.name || '').trim()

  const handleSave = async (arrayBuffer) => {
    cloneVoice.reset()
    return cloneVoice.mutateAsync({
      daughter: daughterKey,
      audioBuffer: arrayBuffer,
      name: profile.name,
    })
  }

  function handleCloneDone({ voiceId }) {
    onUpdate('voiceId', voiceId)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(profile.voiceId || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-3">
      {/* Guard: name must be set */}
      {nameEmpty && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-xs font-bold text-amber-800">Set a name above before cloning.</p>
        </div>
      )}

      {/* Recorder */}
      <div className={nameEmpty ? 'opacity-40 pointer-events-none' : ''}>
        <VoiceRecorder
          daughter={daughterKey}
          existingSample={null}
          language="nl-NL"
          onSave={handleSave}
          onCloneDone={handleCloneDone}
          processingLabel="Uploading to ElevenLabs…"
        />
      </div>

      {/* Success banner */}
      {cloneVoice.isSuccess && profile.voiceId && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-green-800">Voice cloned!</p>
            <p className="text-xs text-green-600 font-mono truncate">{profile.voiceId}</p>
          </div>
          <button
            onClick={handleCopy}
            className="text-xs text-green-700 font-bold px-2 py-1 rounded-lg hover:bg-green-100 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      {/* Manual Voice ID override */}
      <div>
        <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
          Or paste an existing ElevenLabs Voice ID
        </label>
        <input
          type="text"
          value={profile.voiceId || ''}
          onChange={e => onUpdate('voiceId', e.target.value)}
          placeholder="21m00Tcm4TlvDq8ikWAM"
          className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 focus:border-story-purple focus:outline-none font-mono"
        />
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Record 10–20 seconds of your daughter speaking naturally.
        ElevenLabs will clone her voice — remember to click Save Settings after cloning.
      </p>
    </div>
  )
}

// ── XTTS server status banner ─────────────────────────────────────────────────

function XttsStatusBanner({ status }) {
  if (status === 'unknown') return null

  const config = {
    ready:   { bg: 'bg-green-50 border-green-200',  text: 'text-green-800',  icon: '✅', msg: 'XTTS Voice Clone server is running and ready.' },
    loading: { bg: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-800', icon: '⏳', msg: 'XTTS server is loading the model (~1.9 GB on first run). This takes 1–3 minutes.' },
    offline: { bg: 'bg-gray-50 border-gray-200',     text: 'text-gray-600',   icon: '⚫', msg: 'XTTS server is offline. Voice Clone engine won\'t work until Python is set up.' },
    error:   { bg: 'bg-red-50 border-red-200',       text: 'text-red-700',    icon: '❌', msg: 'XTTS server error. Check the terminal for details.' },
  }[status] ?? null

  if (!config) return null

  return (
    <div className={`border rounded-xl px-4 py-3 flex items-start gap-2 ${config.bg}`}>
      <span className="text-sm mt-0.5">{config.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold ${config.text}`}>{config.msg}</p>
        {status === 'offline' && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-gray-500 font-medium">Setup (one-time):</p>
            <code className="block text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">
              python -m venv resources/xtts_venv
            </code>
            <code className="block text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">
              resources/xtts_venv/Scripts/activate
            </code>
            <code className="block text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">
              pip install -r resources/requirements.txt
            </code>
            <p className="text-xs text-gray-400 mt-1">
              Then restart Story Studio. The server starts automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Character Reference Image upload ─────────────────────────────────────────

function CharacterReferenceUpload({ daughterKey, profile, onReferenceSaved }) {
  const upload = useUploadCharacterReference()
  const refPath = profile.characterReferencePath || ''

  async function handleUpload() {
    const result = await upload.mutateAsync({ daughter: daughterKey })
    if (result?.characterReferencePath) {
      onReferenceSaved(result.characterReferencePath)
    }
  }

  return (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
        Character Reference Image
      </label>
      <div className="flex items-center gap-3">
        {refPath && (
          <img
            src={`localfile:///${refPath.replace(/\\/g, '/')}`}
            alt="Character reference"
            className="w-14 h-14 rounded-xl object-cover border-2 border-story-purple flex-shrink-0"
          />
        )}
        <div className="flex-1">
          <button
            onClick={handleUpload}
            disabled={upload.isPending}
            className="w-full border-2 border-dashed border-gray-300 hover:border-story-purple text-gray-500 hover:text-story-purple font-bold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-60"
          >
            {upload.isPending ? 'Selecting…' : refPath ? '🔄 Replace Reference' : '🖼 Upload Reference Image'}
          </button>
          <p className="text-xs text-gray-400 mt-1">
            Used as a visual reference for every illustration — keeps the character's look consistent across all scenes and projects.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Character Reference Library ───────────────────────────────────────────────

function CharacterReferencesSection() {
  const { data: characters = [], isLoading, isError } = useCharacterList()
  const addCharacter = useAddCharacter()
  const removeCharacter = useRemoveCharacter()

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')
  const [removingName, setRemovingName] = useState(null)

  async function handleAdd() {
    if (!newName.trim()) return
    setAddError('')
    addCharacter.reset()
    try {
      await addCharacter.mutateAsync({ name: newName.trim() })
      setNewName('')
      setShowAddForm(false)
    } catch (err) {
      // Suppress "No file selected" — user cancelled the dialog, keep form open
      if (err.message !== 'No file selected') {
        setAddError(err.message)
      }
    }
  }

  async function handleRemove(name) {
    setRemovingName(name)
    try {
      await removeCharacter.mutateAsync({ name })
    } finally {
      setRemovingName(null)
    }
  }

  return (
    <Section title="🎭 Character References">
      <p className="text-xs text-gray-400 -mt-2">
        Add reference images for named characters. Names are matched exactly in scene text when generating illustrations.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
          <div className="w-4 h-4 border-2 border-story-purple border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      )}

      {isError && (
        <p className="text-xs text-red-500">Failed to load character library.</p>
      )}

      {!isLoading && characters.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {characters.map(char => (
            <CharacterCard
              key={char.name}
              character={char}
              onRemove={() => handleRemove(char.name)}
              isRemoving={removingName === char.name}
            />
          ))}
        </div>
      )}

      {!isLoading && characters.length === 0 && !showAddForm && (
        <p className="text-xs text-gray-400 italic">No characters added yet.</p>
      )}

      {showAddForm ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-3 space-y-2">
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide">
            Character Name
          </label>
          <input
            type="text"
            value={newName}
            onChange={e => { setNewName(e.target.value); setAddError('') }}
            placeholder="e.g. Grandma"
            autoFocus
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 focus:border-story-purple focus:outline-none"
          />
          {addError && (
            <p className="text-xs text-red-500">{addError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || addCharacter.isPending}
              className="flex-1 bg-story-purple hover:bg-story-purple-dark text-white font-bold py-2 rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {addCharacter.isPending ? 'Selecting…' : '🖼 Choose Image'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewName(''); setAddError(''); addCharacter.reset() }}
              className="px-4 py-2 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:border-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full border-2 border-dashed border-gray-300 hover:border-story-purple text-gray-500 hover:text-story-purple font-bold py-2.5 rounded-xl text-sm transition-colors"
        >
          + Add Character
        </button>
      )}
    </Section>
  )
}

function CharacterCard({ character, onRemove, isRemoving }) {
  return (
    <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2 border border-gray-100">
      {character.imagePath && (
        <img
          src={`localfile:///${character.imagePath.replace(/\\/g, '/')}`}
          alt={character.name}
          className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-gray-200"
        />
      )}
      <span className="flex-1 text-sm font-bold text-gray-700 truncate">{character.name}</span>
      <button
        onClick={onRemove}
        disabled={isRemoving}
        className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none disabled:opacity-40 flex-shrink-0"
        title="Remove character"
      >
        ×
      </button>
    </div>
  )
}

// ── LM Studio status banner ───────────────────────────────────────────────────

function LmStudioStatusBanner({ data, onRecheck, checking }) {
  // data is undefined while loading — show nothing until first poll resolves
  if (!data) return null

  if (data.online) {
    return (
      <div className="border rounded-xl px-4 py-3 flex items-start gap-2 bg-green-50 border-green-200">
        <span className="text-sm mt-0.5">🤖</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-green-800">
            LM Studio is running
            {data.modelId ? ` · ${data.modelId}` : ' · no model loaded'}
          </p>
          <p className="text-xs text-green-600 mt-0.5">
            {data.modelId
              ? 'Write for Me is ready — open New Story to generate a story with AI.'
              : 'Load a model in LM Studio to enable Write for Me.'}
          </p>
        </div>
        <button
          onClick={onRecheck}
          disabled={checking}
          className="text-xs font-bold text-green-700 hover:text-green-900 disabled:opacity-40 transition-colors shrink-0"
        >
          {checking ? 'Checking…' : 'Recheck'}
        </button>
      </div>
    )
  }

  return (
    <div className="border rounded-xl px-4 py-3 flex items-start gap-2 bg-gray-50 border-gray-200">
      <span className="text-sm mt-0.5">🤖</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-gray-600">LM Studio is offline</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Start LM Studio and load a model to enable the Write for Me feature.
          Download from <span className="font-mono">lmstudio.ai</span>
        </p>
      </div>
      <button
        onClick={onRecheck}
        disabled={checking}
        className="text-xs font-bold text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors shrink-0"
      >
        {checking ? 'Checking…' : 'Recheck'}
      </button>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">
      <h3 className="font-bold text-gray-700 text-base border-b border-gray-100 pb-3">{title}</h3>
      {children}
    </div>
  )
}

function ApiKeyField({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 pr-12 text-sm font-medium text-gray-700 focus:border-story-purple focus:outline-none font-mono"
        />
        <button
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
        >
          {show ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  )
}
