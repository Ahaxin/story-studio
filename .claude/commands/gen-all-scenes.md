Generate illustrations and narration for all pending scenes in project: $ARGUMENTS

Steps:
1. Load project.json via `story:load` IPC (or use current project if none given)
2. Filter scenes where `status === 'pending'`
3. Check voice engine for active narrator:
   - If `voiceEngine === 'xtts'`: verify XTTS server is ready (GET /health on port 5002)
     and that `voiceSamplePath` exists — warn and skip narration if not
   - If `voiceEngine === 'piper'`: verify piper.exe and model file exist in resources/
   - If `voiceEngine === 'google'`: verify GOOGLE_TTS_API_KEY is set in .env
4. For each pending scene (in order):
   a. Use generate-scene skill → build illustration prompt
   b. Call `scene:generate-illustration` IPC → saves illustration.png
   c. Call `scene:generate-narration` IPC → saves narration.mp3
   d. Update scene.status and scene.duration in project.json
   e. Report: "Scene {n}/{total} complete ✓"
5. After all scenes: report ready count vs failed count
6. If all scenes ready: offer to run /export-video
