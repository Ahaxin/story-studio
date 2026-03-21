// nanoBanana.js — Nano Banana (Gemini image generation) API client.
// Nano Banana uses the Google AI Studio / Gemini API under the hood.
// Endpoint: https://generativelanguage.googleapis.com/v1beta/
// Model:    gemini-3.1-flash-image-preview

const axios = require('axios')
const fs = require('fs')
const path = require('path')

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const NANO_BANANA_MODEL = 'gemini-3.1-flash-image-preview'

/**
 * Build a safe, kid-friendly illustration prompt for a scene.
 * Scene 0 gets a book cover with the story title.
 * All other scenes share a consistent inner-page frame style.
 *
 * @param {string} sceneText
 * @param {object} style — project.style
 * @param {string} avatarCharacterPrompt — narrator's physical description (always passed, not gated on avatarMode)
 * @param {number} sceneIndex — 0-based; 0 = cover page
 * @param {string} storyTitle — used on the cover
 * @param {Array<{name: string, description: string}>} characters — additional named characters with locked appearances
 */
function buildScenePrompt(sceneText, style, avatarCharacterPrompt = '', sceneIndex = 0, storyTitle = '', characters = []) {
  const artStyle = style?.illustrationStyle ||
    "watercolor children's book, soft pastel colors, friendly"

  const baseStyle = `children's book watercolor illustration, ${artStyle}, warm lighting, friendly and safe for kids aged 4-10`

  if (sceneIndex === 0) {
    // ── Cover page: decorated book cover with prominent title ──────────────────
    const titleText = storyTitle ? `titled "${storyTitle}"` : ''
    const parts = [
      baseStyle,
      `book cover design ${titleText}`,
      'large decorative title text prominently displayed at the top',
      'ornate illustrated border frame around the edges',
      'central scene illustration depicting:',
    ]

    if (avatarCharacterPrompt && avatarCharacterPrompt.trim()) {
      parts.push(avatarCharacterPrompt.trim())
    }

    const sceneSummary = sceneText.length > 150
      ? sceneText.substring(0, 150).trim() + '...'
      : sceneText.trim()
    parts.push(sceneSummary)

    parts.push(
      "children's book cover, bright and inviting, no scary elements, joyful and magical"
    )

    return parts.join(', ')

  } else {
    // ── Inner pages: consistent illustrated frame style ────────────────────────
    const parts = [
      baseStyle,
      'inner page of a children\'s book, consistent illustrated border frame, same art style as cover',
      'wide landscape scene, characters and setting clearly visible',
    ]

    // Character consistency block — every named character gets a locked appearance description.
    // Gemini must keep face, hair, and skin tone identical across all scenes;
    // only pose, expression, and clothing adapt to the scene action.
    const charBlocks = []
    if (avatarCharacterPrompt && avatarCharacterPrompt.trim()) {
      charBlocks.push(avatarCharacterPrompt.trim())
    }
    for (const char of characters) {
      if (char.description && char.description.trim()) {
        charBlocks.push(`${char.name}: ${char.description.trim()}`)
      }
    }
    if (charBlocks.length > 0) {
      parts.push(
        'IMPORTANT — character appearance must stay IDENTICAL across every scene ' +
        '(same face shape, eye color, hair color and style, skin tone, body proportions). ' +
        'Only the pose, expression, and clothing change to match the scene action. ' +
        'Characters: ' + charBlocks.join(' | ')
      )
    }

    const sceneSummary = sceneText.length > 200
      ? sceneText.substring(0, 200).trim() + '...'
      : sceneText.trim()
    parts.push(sceneSummary)

    // Embed the narration text in the illustration so it appears as story text on the page
    parts.push(
      `at the bottom of the page display the following story text in a clear readable children's book font: "${sceneText.trim()}"`
    )

    parts.push(
      "children's book illustration, safe for kids aged 4-10, bright and cheerful, " +
      "no scary elements, no dark themes, bright and joyful"
    )

    return parts.join(', ')
  }
}

/**
 * Generate an illustration via Nano Banana (Gemini image generation API).
 * Returns the local file path of the saved PNG.
 *
 * @param {string[]} referenceImagePaths — array of paths to character reference images (PNG/JPG/WebP).
 *   Each image is sent as an inline part before the text prompt so Gemini can match character looks.
 *   Pass an empty array when no reference images are needed.
 */
async function generateIllustration(prompt, projectId, sceneId, sceneDir, apiKey, referenceImagePaths = []) {
  if (!apiKey) apiKey = process.env.NANO_BANANA_API_KEY
  if (!apiKey) {
    throw new Error('Nano Banana API key is not set. Go to Settings → API Keys to add it.')
  }

  console.log(`[nanoBanana] Generating illustration for scene ${sceneId}`)
  console.log(`[nanoBanana] Prompt: ${prompt.substring(0, 100)}...`)

  // Build parts array — reference images first (if any), then the text prompt
  const parts = []

  let hasRefImages = false
  for (const refPath of referenceImagePaths) {
    if (refPath && fs.existsSync(refPath)) {
      const ext = path.extname(refPath).toLowerCase().replace('.', '')
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png'
      const imageData = fs.readFileSync(refPath).toString('base64')
      parts.push({ inlineData: { mimeType, data: imageData } })
      console.log(`[nanoBanana] Including reference image: ${path.basename(refPath)}`)
      hasRefImages = true
    } else if (refPath) {
      console.warn(`[nanoBanana] Reference image not found, skipping: ${refPath}`)
    }
  }

  if (hasRefImages) {
    parts.push({
      text:
        'The image(s) above are character reference(s). ' +
        'Use them ONLY to match the character\'s face, hair, and skin tone. ' +
        'Do NOT copy the pose, expression, or clothing from the reference. ' +
        'Instead, choose clothing that fits the scene\'s environment and activity. ' +
        'Show a natural posture and gesture that matches what the character is doing in the scene.',
    })
  }

  parts.push({ text: prompt })

  const url = `${GEMINI_BASE_URL}/models/${NANO_BANANA_MODEL}:generateContent?key=${apiKey}`

  let response
  try {
    response = await axios.post(
      url,
      {
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '16:9',
          },
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      }
    )
  } catch (err) {
    // Extract the actual API error message from the response body
    const apiError = err.response?.data?.error?.message || err.response?.data
    if (apiError) {
      throw new Error(`Nano Banana API error: ${typeof apiError === 'string' ? apiError : JSON.stringify(apiError)}`)
    }
    throw err
  }

  // Extract inline base64 image from response
  const responseParts = response.data?.candidates?.[0]?.content?.parts
  const imagePart = responseParts?.find(p => p.inlineData)
  if (!imagePart?.inlineData?.data) {
    throw new Error(
      `Nano Banana returned no image. Response: ${JSON.stringify(response.data).substring(0, 300)}`
    )
  }

  const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
  const outputPath = path.join(sceneDir, 'illustration.png')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, imageBuffer)

  console.log(`[nanoBanana] Illustration saved to ${outputPath}`)
  return outputPath
}

module.exports = { generateIllustration, buildScenePrompt }
