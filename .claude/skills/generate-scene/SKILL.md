---
name: generate-scene
description: Build an optimized Nano Banana illustration prompt for a story scene in Story Studio. Auto-invoke when working on scene illustration generation, prompt crafting, or Nano Banana API calls. Use this skill any time the words "illustration", "scene prompt", "Nano Banana", or "generate image" appear in the context.
---

## What this skill does
Constructs a safe, kid-friendly illustration prompt for `nanoBanana.generateIllustration()`.

## Implementation location
`src/utils/nanoBanana.js` → `buildScenePrompt(sceneText, style, avatarCharacterPrompt)`

## Prompt structure (in order)
1. **Art style prefix** — always first:
   `"children's book watercolor illustration, {style.illustrationStyle}, warm lighting, friendly and safe for kids aged 4-10"`

2. **Character description** — if `avatarCharacterPrompt` is set (daughter avatarMode === 'generated'):
   Prepend the locked `characterPrompt` string verbatim

3. **Scene content** — summarize what is happening (max 200 chars of scene text)

4. **Safety suffix** — always last:
   `"children's book illustration, safe for kids aged 4-10, bright and cheerful, no scary elements, no dark themes, bright and joyful"`

## Rules
- Keep total prompt under ~1200 characters (~300 tokens)
- Never omit the safety suffix
- Check `scene.narrator` → look up `project.style[narrator]` for avatar data
- Log final prompt to `scene.illustrationPrompt` in project.json

## IPC flow
`scene:generate-illustration` → `nanoBanana.generateIllustration(prompt, projectId, sceneId, sceneDir)`
→ downloads PNG to `projects/{id}/scenes/scene_{sceneId}/illustration.png`
→ updates `scene.illustrationPath` and `scene.status`
