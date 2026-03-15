// schema.js — Project and scene data factories
// All project.json structures are created through these functions.
// Never construct raw objects elsewhere — always use these factories.

const { v4: uuidv4 } = require('uuid')

/**
 * Create a new project object.
 * @param {string} name — display name of the story
 * @param {'nl-NL'|'zh-CN'} language
 * @returns {object} full project structure ready to write to project.json
 */
function createProject(name, language = 'nl-NL') {
  if (!['nl-NL', 'zh-CN'].includes(language)) {
    throw new Error(`Unsupported language: ${language}. Use 'nl-NL' or 'zh-CN'.`)
  }

  return {
    id: uuidv4(),
    name: String(name).trim(),
    language,
    createdAt: new Date().toISOString(),
    style: {
      illustrationStyle: "watercolor children's book, soft pastel colors, friendly",
      daughter1: {
        name: '',
        voiceEngine: 'piper',
        voiceId: '',
        avatarMode: 'none',       // 'none' | 'fixed' | 'generated'
        avatarPath: '',
        characterPrompt: '',
      },
      daughter2: {
        name: '',
        voiceEngine: 'google',
        voiceId: '',
        avatarMode: 'none',
        avatarPath: '',
        characterPrompt: '',
      },
      activeNarrator: 'daughter1',
    },
    scenes: [],
    export: {
      resolution: '1920x1080',
      fps: 30,
      outputPath: '',
    },
  }
}

/**
 * Create a new scene object.
 * @param {number} index — 0-based position in scenes array
 * @param {string} text — paragraph text for this scene
 * @param {string} narrator — 'daughter1' | 'daughter2'
 * @param {string} transition — animation type
 * @returns {object} scene structure
 */
function createScene(index, text, narrator = 'daughter1', transition = 'page-curl') {
  const validTransitions = ['page-curl', 'slide', 'fade', 'zoom']
  if (!validTransitions.includes(transition)) {
    throw new Error(`Invalid transition: ${transition}. Use one of: ${validTransitions.join(', ')}`)
  }

  const words = text.trim().split(/\s+/).filter(Boolean)

  return {
    id: uuidv4(),
    index,
    text: text.trim(),
    wordCount: words.length,
    illustrationPath: '',
    illustrationPrompt: '',
    narrationPath: '',
    recordingPath: '',           // user-recorded audio (preferred over narrationPath for export)
    narrator,                    // 'daughter1' | 'daughter2'
    transition,                  // 'page-curl' | 'slide' | 'fade' | 'zoom'
    duration: null,              // set after narration generated (audio length + 0.5s)
    status: 'pending',           // 'pending' | 'illustration-done' | 'narration-done' | 'ready'
  }
}

module.exports = { createProject, createScene }
