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
    `Write a ${langName} children's story (ages 4-10) with exactly ${sceneCount} scenes. ` +
    `Each scene: 20-40 words, warm tone. ` +
    `Each illustrationPrompt: vivid watercolor description, 1-2 sentences. ` +
    `Reply with ONLY valid JSON, no explanation: {"scenes":[{"text":"...","illustrationPrompt":"..."}]}`

  let raw
  try {
    const res = await axios.post(
      `${LM_STUDIO_BASE}/v1/chat/completions`,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${idea} /no_think` },
        ],
        temperature: 0.8,
        max_tokens: 4096,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'story',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                scenes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      illustrationPrompt: { type: 'string' },
                    },
                    required: ['text', 'illustrationPrompt'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['scenes'],
              additionalProperties: false,
            },
          },
        },
      },
      { timeout: 300000 }
    )
    const choice = res.data?.choices?.[0]
    raw = choice?.message?.content || ''
    if (choice?.finish_reason === 'length') {
      console.warn('[lmStudio] finish_reason=length — model hit context window before writing JSON')
      throw new Error(
        'Model ran out of context before writing the story. In LM Studio, increase the model\'s context length to 16384 or more, or use a non-thinking model variant.'
      )
    }
  } catch (err) {
    if (err.message?.includes('context length') || err.message?.includes('context window')) throw err
    console.error('[lmStudio] generateStory error — code:', err.code, '| message:', err.message)
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error('LM Studio took too long to respond.')
    }
    throw new Error(`LM Studio error: ${err.message}`)
  }

  console.log('[lmStudio] raw response length:', raw.length, '| first 200 chars:', raw.slice(0, 200))
  console.log('[lmStudio] last 500 chars:', raw.slice(-500))

  // Extract JSON — try direct parse first (structured output returns raw JSON),
  // then fall back to heuristics for fences / reasoning prefixes.
  let jsonText = raw.trim()

  // 1. Try extracting a ```json ... ``` block
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim()
  }

  // 2. Find the first { ... last } block — handles reasoning text before/after JSON
  if (!fenceMatch) {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) {
      jsonText = raw.slice(start, end + 1)
    }
  }

  if (!jsonText) {
    const err = new Error('Model returned invalid response. Try again.')
    err.rawResponse = raw
    throw err
  }

  // Repair common local-model JSON issues before parsing
  const repaired = jsonText
    .replace(/,\s*([}\]])/g, '$1')   // trailing commas before } or ]
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // stray control chars

  let parsed
  try {
    parsed = JSON.parse(repaired)
  } catch (parseErr) {
    console.error('[lmStudio] JSON.parse failed:', parseErr.message, '| jsonText start:', jsonText?.slice(0, 200))
    const err = new Error('Model returned invalid JSON. Try again.')
    err.rawResponse = raw
    throw err
  }

  if (!Array.isArray(parsed?.scenes)) {
    console.error('[lmStudio] parsed.scenes is not an array:', typeof parsed?.scenes, '| keys:', Object.keys(parsed || {}))
    const err = new Error('Model response missing "scenes" array. Try again.')
    err.rawResponse = raw
    throw err
  }

  const MIN = 5, MAX = 15

  // Clamp to valid range
  const scenes = parsed.scenes
    .slice(0, MAX)
    .filter(s => s && typeof s.text === 'string' && s.text.trim())
    .map(s => ({
      text: s.text.trim(),
      illustrationPrompt: typeof s.illustrationPrompt === 'string' ? s.illustrationPrompt.trim() : '',
    }))

  const warned = Math.abs(scenes.length - sceneCount) > 2

  if (scenes.length < MIN) {
    const err = new Error(`Model returned only ${scenes.length} scenes (minimum is ${MIN}). Try again.`)
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
