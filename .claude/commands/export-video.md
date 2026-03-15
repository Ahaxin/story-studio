Assemble and export the final video for project: $ARGUMENTS

Steps:
1. Load project.json via `story:load` IPC
2. Use assemble-video skill to run pre-flight check:
   - Every scene must have illustration.png and narration.mp3 on disk
   - Every scene.status must be 'ready'
3. If any scenes are not ready: list them and ask how to proceed
   (skip them, generate missing assets first, or export partial)
4. Run ffprobe on each narration.mp3 to get exact durations
   scene.duration = audioDuration + 0.5s padding
5. Build FFmpeg filter_complex:
   - scale + drawtext (subtitle) per scene
   - xfade transitions between scenes (per scene.transition setting)
   - concat audio
6. Encode: libx264 medium/crf23, aac 192k, 1920x1080 @ 30fps
   Output: `projects/{id}/export/story_final.mp4`
7. Stream progress via `video:progress` events → ExportPage progress bar
8. On completion: report file path, file size, total duration
9. Ask if user wants to open the output folder
