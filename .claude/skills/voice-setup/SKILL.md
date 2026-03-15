---
name: voice-setup
description: Configure TTS voice profiles for Story Studio daughters. Auto-invoke when working on voice settings, adding daughter profiles, testing narration, or switching between Piper, Google TTS, and XTTS voice cloning. Trigger on "voice", "narration", "daughter", "Piper", "Google TTS", "voice clone", "XTTS".
---

## Three available voice engines

### 1. Piper (local, offline)
- Set `voiceEngine: 'piper'`, `voiceId: 'nl_NL-mls-medium.onnx'`
- Binary: `resources/piper.exe` (download from github.com/rhasspy/piper/releases)
- Models: `resources/piper/models/*.onnx` + `*.onnx.json` (both files required)
- nl-NL model: `nl_NL-mls-medium.onnx` (huggingface.co/rhasspy/piper-voices)
- zh-CN model: `zh_CN-huayan-medium.onnx`
- Flow: spawn piper.exe → outputs WAV → FFmpeg converts to MP3

### 2. Google Cloud TTS (cloud)
- Set `voiceEngine: 'google'`, `voiceId: 'nl-NL-Wavenet-D'`
- Needs `GOOGLE_TTS_API_KEY` in `.env`
- nl-NL recommended: `nl-NL-Wavenet-D` or `nl-NL-Neural2-C`
- zh-CN recommended: `cmn-CN-Wavenet-A` or `cmn-CN-Neural2-C`
- Flow: REST POST → base64 MP3 in response → write to file

### 3. XTTS v2 (local voice cloning) ← NEW
- Set `voiceEngine: 'xtts'`, `voiceSamplePath` set automatically after recording
- Requires: Python venv at `resources/xtts_venv/` with TTS + flask + torch installed
- Server: `resources/xtts_server.py` on port 5002 — auto-started by Electron
- Language codes: nl-NL → `'nl'`, zh-CN → `'zh-cn'` (XTTS-specific, not BCP-47)
- Voice sample: WAV at `userData/voices/{daughter}_reference.wav` (22050Hz mono)
- Flow: VoiceRecorder → MediaRecorder webm → IPC → FFmpeg → WAV → stored
- Synthesis: POST /synthesize { text, reference_audio_path, language } → WAV → MP3

## Settings UI
Settings page → Daughter section → Voice Engine: Piper / Google / Clone (XTTS)
When Clone is selected: VoiceRecorder component appears for recording a sample.
XTTS server status shown in banner at top of Settings page.

## Stored in electron-store
```js
daughters.daughter1: {
  name, voiceEngine, voiceId, voiceSamplePath,
  avatarMode, avatarPath, characterPrompt
}
```
