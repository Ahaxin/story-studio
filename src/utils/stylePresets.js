// stylePresets.js — Illustration style presets for Story Studio.
// Each preset bundles a prompt fragment injected into scene illustration prompts,
// plus UI metadata (label, emoji, gradient) for the StylePicker component.
//
// Data lives in stylePresetsData.json so electron/main.js can require() it too.

import STYLE_PRESETS from './stylePresetsData.json'

export { STYLE_PRESETS }
