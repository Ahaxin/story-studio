---
name: assemble-video
description: Assemble Story Studio scene assets into a final MP4 video using FFmpeg. Auto-invoke when the user wants to export, assemble, or render the video. Trigger on "export", "assemble", "render video", "make the video", "export MP4".
---

## What this skill does
Runs the FFmpeg filter_complex pipeline to combine scene illustrations + narration audio
into a single 1920×1080 H.264 MP4 with transitions and subtitle overlays.

## Implementation location
`src/utils/ffmpeg.js` → `assembleVideo(project, scenes, outputPath, onProgress)`

## Pre-flight check (always run first)
For each scene verify:
- `scene.illustrationPath` exists on disk
- `scene.narrationPath` exists on disk
- If missing: throw with a clear list of which scenes have missing assets

## Scene duration calculation
Run `ffprobe` on each narration MP3 to get exact duration.
`scene.duration = audioDuration + 0.5s` (padding between scenes).

## FFmpeg filter_complex structure
1. **Inputs**: one `-loop 1 -t {duration} -i illustration.png` per scene, then one `-i narration.mp3` per scene
2. **Per-scene video**: `scale=1920x1080`, `fps=30`, `drawtext` subtitle at bottom
3. **Transitions between scenes** (xfade):
   - `page-curl` → `diagtl` (no native page-curl in FFmpeg)
   - `slide` → `slideright`
   - `fade` → `fade`
   - `zoom` → `smoothup`
   - Transition duration: 0.5s; offset = cumulative scene time - 0.5s
4. **Audio**: concat all narration streams
5. **Output**: `-c:v libx264 -preset medium -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p -movflags +faststart`

## Progress reporting
Parse FFmpeg stderr for `time=HH:MM:SS` pattern.
Call `onProgress(percent)` where percent = currentSecs / totalDuration * 100.
Main process forwards to renderer via `webContents.send('video:progress', { percent })`.

## Subtitle font
Primary: `C:\Windows\Fonts\arialroundedmtbold.ttf`
Fallback: `C:\Windows\Fonts\arial.ttf`
Style: 42pt, white text, black border (borderw=3), centered bottom (y=h-th-60).

## Output
`projects/{id}/export/story_final.mp4`
Also saved to `project.export.outputPath` in project.json.
