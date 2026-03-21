// storySplitter.js — Split raw story text into scene objects.
// One paragraph (double newline) = one scene.

const { createScene } = require('./schema')

const MIN_SCENES = 5
const MAX_SCENES = 25
const LONG_SCENE_WORD_THRESHOLD = 50
const AVG_SECONDS_PER_SCENE = 8  // used for estimated video length

/**
 * Suggest a transition type based on scene position and text content.
 * @param {number} index — 0-based scene index
 * @param {number} total — total scene count
 * @param {string} text
 * @returns {string} transition type
 */
function suggestTransition(index, total, text) {
  if (index === 0) return 'zoom'              // dramatic opening
  if (index === total - 1) return 'fade'      // gentle ending
  // Simple heuristic: exclamation marks / action words → slide
  const actionWords = /uitroep|spring|ren|vlieg|snel|plotseling|opeens|jump|run|fly|fast|suddenly|rush|snelle/i
  if (actionWords.test(text) || (text.match(/!/g) || []).length >= 2) return 'slide'
  return 'page-curl'                          // default
}

/**
 * Split raw story text into scenes.
 * @param {string} rawText — full story pasted by user
 * @param {string} narrator — default narrator for all scenes
 * @returns {{ scenes: object[], warnings: string[], estimatedSeconds: number }}
 */
function splitByParagraph(rawText, narrator = 'daughter1') {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Story text must be a non-empty string.')
  }

  // Split on double newline, clean up each paragraph
  const paragraphs = rawText
    .split(/\n\n+/)
    .map(p => p.replace(/\n/g, ' ').trim())  // collapse single newlines within paragraph
    .filter(p => p.length > 0)

  const total = paragraphs.length

  if (total < MIN_SCENES) {
    throw new Error(
      `Story has only ${total} paragraph${total === 1 ? '' : 's'} but needs at least ${MIN_SCENES}. ` +
      `Add more paragraphs separated by blank lines, or split existing paragraphs.`
    )
  }

  if (total > MAX_SCENES) {
    throw new Error(
      `Story has ${total} paragraphs but the maximum is ${MAX_SCENES}. ` +
      `Merge some paragraphs or split the story into two separate projects.`
    )
  }

  const warnings = []
  const scenes = paragraphs.map((text, i) => {
    const transition = suggestTransition(i, total, text)
    const scene = createScene(i, text, narrator, transition)

    if (scene.wordCount > LONG_SCENE_WORD_THRESHOLD) {
      scene.tooLong = true
      warnings.push(
        `Scene ${i + 1} has ${scene.wordCount} words (over ${LONG_SCENE_WORD_THRESHOLD}). ` +
        `Consider splitting it for better pacing.`
      )
    }

    return scene
  })

  const estimatedSeconds = total * AVG_SECONDS_PER_SCENE

  return {
    scenes,
    warnings,
    total,
    estimatedSeconds,
    estimatedDuration: formatDuration(estimatedSeconds),
  }
}

/** Format seconds into m:ss string */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

module.exports = { splitByParagraph }
