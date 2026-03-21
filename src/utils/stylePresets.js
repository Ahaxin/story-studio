// stylePresets.js — Illustration style presets for Story Studio.
// Each preset bundles a prompt fragment injected into scene illustration prompts,
// plus UI metadata (label, emoji, gradient) for the StylePicker component.

const STYLE_PRESETS = [
  {
    id: 'sweet',
    label: 'Sweet & Lovely',
    description: 'Soft pastels, warm & cozy',
    emoji: '🌸',
    prompt: "watercolor children's book, soft pastel colors, friendly, warm and cozy",
    gradient: 'from-pink-200 via-purple-100 to-rose-100',
  },
  {
    id: 'suske',
    label: 'Suske & Wiske',
    description: 'Classic Belgian comic, ligne claire',
    emoji: '📕',
    prompt: 'Belgian classic comic book style, ligne claire, bold black outlines, flat bright colors, vintage European children\'s comics',
    gradient: 'from-yellow-200 via-orange-100 to-amber-100',
  },
  {
    id: 'plopsa',
    label: 'Plopsa Style',
    description: 'Bold outlines, Studio 100 style',
    emoji: '🎪',
    prompt: 'colorful European children\'s animated comic style, bold outlines, vibrant saturated colors, friendly rounded cartoon characters, playful Studio 100 style',
    gradient: 'from-blue-200 via-green-100 to-cyan-100',
  },
  {
    id: 'watercolor',
    label: 'Watercolor Art',
    description: 'Expressive painterly brushstrokes',
    emoji: '🎨',
    prompt: 'loose expressive watercolor painting, visible wet brushstrokes, soft color bleeds, artistic painterly style',
    gradient: 'from-sky-200 via-teal-100 to-blue-100',
  },
  {
    id: 'printmaking',
    label: 'Printmaking',
    description: 'Linocut woodcut, bold graphic',
    emoji: '🖨️',
    prompt: 'linocut printmaking style, bold graphic black outlines, limited 3-color palette, woodcut illustration, strong contrast, artisanal print',
    gradient: 'from-amber-200 via-red-100 to-orange-100',
  },
  {
    id: 'collage',
    label: 'Collage Art',
    description: 'Torn paper, mixed media layers',
    emoji: '✂️',
    prompt: 'mixed media collage illustration, layered torn paper textures, cut-out shapes, artistic assemblage, colorful children\'s book collage',
    gradient: 'from-lime-200 via-teal-100 to-green-100',
  },
  {
    id: 'manga',
    label: 'Japanese Manga',
    description: 'Clean outlines, expressive shojo',
    emoji: '⛩️',
    prompt: 'manga comic style, clean bold outlines, screentone shading, expressive large eyes, dynamic composition, Japanese comics aesthetic, cute shojo manga children\'s style',
    gradient: 'from-gray-200 via-slate-100 to-zinc-100',
  },
  {
    id: 'manhua',
    label: 'Chinese Manhua',
    description: 'Vibrant, East Asian aesthetic',
    emoji: '🏮',
    prompt: 'Chinese manhua comic style, colorful vibrant illustration, decorative detailed backgrounds, East Asian artistic influences, beautiful character design, modern Chinese children\'s illustration',
    gradient: 'from-red-200 via-yellow-100 to-rose-100',
  },
]

module.exports = { STYLE_PRESETS }
