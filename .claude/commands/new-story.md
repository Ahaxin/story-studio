Create a new Story Studio project for this story: $ARGUMENTS

Steps:
1. If no language specified, ask: Nederlands (nl-NL) or Chinese (zh-CN)?
2. Ask which daughter narrates — daughter1, daughter2, or alternating by scene
3. Use the split-story skill to divide text into scenes (min 5, max 15)
4. Show scene count, any tooLong warnings, and estimated video duration
5. If scene count is out of range, suggest how to fix before proceeding
6. Call `story:create` IPC with { name, language, scenes }
   — this creates `userData/projects/{id}/` with scenes/, avatars/, export/ subdirs
   — and writes project.json using createProject() + createScene() from schema.js
7. Confirm: show project ID, scene count, narrator setup
8. Ask: customize illustration style or use default?
   Default: "watercolor children's book, soft pastel colors, friendly"
9. Ask: set up daughter voice profiles now (Settings page) or generate illustrations first?
