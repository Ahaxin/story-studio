---
name: split-story
description: Split a pasted story text into scenes for Story Studio. Auto-invoke whenever the user pastes story text, mentions splitting a story, or says "new story". Trigger on phrases like "here is my story", "split this", "new story about".
---

## What this skill does
Splits raw story text into scene objects following Story Studio's schema.

## Implementation location
`src/utils/storySplitter.js` → `splitByParagraph(rawText, narrator)`

## Split logic
1. Split on `\n\n+` (double newline = paragraph boundary)
2. Collapse single newlines within each paragraph to a space
3. Strip empty paragraphs
4. Enforce: min 5 scenes, max 15 — throw descriptive error if outside range
5. Flag scenes with `wordCount > 50` as `tooLong: true` with a warning message
6. Call `createScene(index, text, narrator, transition)` from `schema.js` for each

## Transition suggestions (applied automatically)
- Index 0 (opening) → `'zoom'`
- Last index (closing) → `'fade'`
- Contains exclamation marks ≥2 or action words → `'slide'`
- All others → `'page-curl'` (default)

## Return value
```js
{ scenes, warnings, total, estimatedSeconds, estimatedDuration }
// estimatedSeconds = total * 8 (avg 8s per scene)
// estimatedDuration = "m:ss" string
```

## UI integration
`NewStoryModal.jsx` calls `splitPreview()` (inline version) for the preview step.
Actual scene objects with UUIDs are created server-side via `story:create` IPC.
