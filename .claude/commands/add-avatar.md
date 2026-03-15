Configure avatar for daughter in project: $ARGUMENTS
(Format: /add-avatar daughter1 OR /add-avatar daughter2)

Steps:
1. Ask: Fixed PNG upload OR AI-generated character?

If Fixed PNG:
- Trigger `avatar:upload` IPC → opens file dialog → copies to `projects/{id}/avatars/{daughter}.ext`
- Updates project.json: avatarMode: "fixed", avatarPath: "{path}"
- Show thumbnail confirmation

If AI Generated:
- Ask for physical description: hair color, hair style, eye color,
  skin tone, typical clothing style, age appearance
- Build locked character prompt:
  "A young girl with [hair description], [eyes], [skin tone], wearing [clothing],
   drawn in children's book watercolor style, consistent character design,
   friendly and expressive face"
- Save to project.json: avatarMode: "generated", characterPrompt: "{prompt}"
- This prompt is prepended to every scene illustration prompt for this narrator
  (see generate-scene skill → buildScenePrompt() in nanoBanana.js)
- Optionally: generate a test scene with just the character to preview the result

Note: Avatar settings are per-project (in project.json style.daughter1/2),
while voice settings are global (in electron-store daughters.daughter1/2).
