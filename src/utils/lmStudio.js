// lmStudio.js — LM Studio (local OpenAI-compatible LLM) API client.
// LM Studio runs at http://127.0.0.1:1234 and speaks the OpenAI API format.

const axios = require('axios')

const LM_STUDIO_BASE = 'http://127.0.0.1:1234'
const LANGUAGE_NAMES = { 'nl-NL': 'Dutch', 'zh-CN': 'Chinese (Simplified)' }

/**
 * Check whether LM Studio is running and a model is loaded.
 * Never throws — returns { online: false } on any error.
 * @returns {{ online: boolean, modelId: string|null }}
 */
async function checkLmStudioStatus() {
  try {
    const res = await axios.get(`${LM_STUDIO_BASE}/v1/models`, { timeout: 5000 })
    const models = res.data?.data || []
    return {
      online: true,
      modelId: models.length > 0 ? models[0].id : null,
    }
  } catch {
    return { online: false, modelId: null }
  }
}

/**
 * Generate a children's story split into scenes, each with an illustration prompt.
 * Returns only story-body scenes (no cover) — the cover is created from the title by the caller.
 *
 * @param {{ idea: string, language: string, sceneCount?: number }} opts
 * @returns {{ scenes: Array<{ text: string, illustrationPrompt: string }>, warned: boolean }}
 */
async function generateStory({ idea, language, sceneCount = 8 }) {
  const langName = LANGUAGE_NAMES[language] || 'Dutch'

  const systemPrompt =
    `You are a children's book author. Write a children's story in ${langName} ` +
    `based on the following idea. The story must have exactly ${sceneCount} scenes (paragraphs). ` +
    `Each paragraph should be 20-40 words, warm, and safe for children aged 4-10.\n\n` +
    `Return ONLY valid JSON with no other text, in this exact shape:\n` +
    `{\n  "scenes": [\n    { "text": "...", "illustrationPrompt": "..." },\n    ...\n  ]\n}\n\n` +
    `For each scene, "illustrationPrompt" should be a vivid, specific description ` +
    `suitable for a watercolor children's book illustration — describe the setting, ` +
    `characters, mood, and action in 1-2 sentences.`

  let raw
  try {
    const res = await axios.post(
      `${LM_STUDIO_BASE}/v1/chat/completions`,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: idea },
        ],
        temperature: 0.8,
        max_tokens: 4096,
      },
      { timeout: 60000 }
    )
    raw = res.data?.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error('LM Studio took too long to respond.')
    }
    throw new Error('LM Studio is not running. Start it and load a model first.')
  }

  // Strip markdown code fences if model wrapped the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const err = new Error('Model returned invalid response. Try again.')
    err.rawResponse = raw
    throw err
  }

  if (!Array.isArray(parsed?.scenes)) {
    const err = new Error('Model returned invalid response. Try again.')
    err.rawResponse = raw
    throw err
  }

  const MIN = 5, MAX = 15
  const returned = parsed.scenes.length
  const warned = Math.abs(returned - sceneCount) > 2

  // Clamp to valid range
  const scenes = parsed.scenes
    .slice(0, MAX)
    .filter(s => s && typeof s.text === 'string' && s.text.trim())

  if (scenes.length < MIN) {
    const err = new Error(`Model returned only ${returned} scenes (minimum is ${MIN}). Try again.`)
    err.rawResponse = raw
    throw err
  }

  return { scenes, warned }
}

/**
 * Generate a single illustration prompt for a scene.
 * @param {{ sceneText: string, language: string, storyTitle: string, illustrationStyle: string }} opts
 * @returns {string} illustration prompt
 */
async function generateIllustrationPrompt({ sceneText, language, storyTitle, illustrationStyle }) {
  const langName = LANGUAGE_NAMES[language] || 'Dutch'

  const systemPrompt =
    `You are an art director for a children's picture book titled "${storyTitle}". ` +
    `The illustration style is: ${illustrationStyle}. ` +
    `Given the following story scene text (written in ${langName}), write a single illustration prompt ` +
    `for a watercolor children's book illustration in that style. Describe the setting, ` +
    `characters, mood, lighting, and action in 1-2 sentences. Be specific and vivid. ` +
    `Safe for children aged 4-10. No scary elements.\n\n` +
    `Return only the illustration prompt, no other text.`

  let raw
  try {
    const res = await axios.post(
      `${LM_STUDIO_BASE}/v1/chat/completions`,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Scene text: "${sceneText}"` },
        ],
        temperature: 0.7,
        max_tokens: 512,
      },
      { timeout: 30000 }
    )
    raw = res.data?.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error('LM Studio took too long to respond.')
    }
    throw new Error('LM Studio is not running. Start it and load a model first.')
  }

  const prompt = raw.trim()
  if (!prompt) throw new Error('Model returned an empty prompt. Try again.')
  return prompt
}

module.exports = { checkLmStudioStatus, generateStory, generateIllustrationPrompt }
