"""
xtts_server.py — Local XTTS v2 voice cloning server for Story Studio.

Usage:
    python xtts_server.py

Endpoints:
    GET  /health       — returns {"status": "loading"|"ready"|"error"}
    POST /synthesize   — { text, reference_audio_path, language } → WAV file

Setup (one-time):
    pip install TTS torch torchaudio flask

First run downloads the XTTS v2 model (~1.9 GB) automatically.
Subsequent runs load from cache in ~10-20 seconds.
"""

import sys
import os
import subprocess
import threading
import tempfile
from pathlib import Path

# Resolve FFmpeg path (bundled alongside this script in resources/)
_FFMPEG = str(Path(__file__).parent / "ffmpeg.exe")
if not Path(_FFMPEG).exists():
    _FFMPEG = "ffmpeg"

def preprocess_reference_audio(src_path):
    """
    Denoise + normalize the reference WAV before voice cloning.
    Returns path to a cleaned temp WAV (caller must delete it).
    Filters applied:
      - highpass f=80   : remove low-freq rumble / mic handling noise
      - afftdn nf=-20   : FFT spectral noise reduction (-20 dB noise floor)
      - loudnorm         : normalize loudness to -23 LUFS for consistent levels
    """
    tmp = tempfile.NamedTemporaryFile(suffix="_clean.wav", delete=False)
    tmp.close()
    cmd = [
        _FFMPEG, "-y", "-i", src_path,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",  # normalise only — heavy denoising done at record time
        "-ar", "22050", "-ac", "1",
        tmp.name,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        # If preprocessing fails, fall back to original
        Path(tmp.name).unlink(missing_ok=True)
        return src_path, False
    return tmp.name, True

# PyTorch 2.6+ changed torch.load default to weights_only=True, which breaks
# Coqui TTS model loading. We trust our own model files, so patch it back.
import torch
import torchaudio
import soundfile as sf
import numpy as np

# torchaudio 2.9+ requires TorchCodec for both load and save, ignoring the
# `backend` parameter. Replace both with soundfile implementations so XTTS
# works without torchcodec installed.

def _soundfile_load(uri, frame_offset=0, num_frames=-1, normalize=True,
                    channels_first=True, format=None, buffer_size=4096, backend=None):
    start = frame_offset if frame_offset > 0 else 0
    stop = None if num_frames == -1 else start + num_frames
    data, sr = sf.read(str(uri), start=start, stop=stop, dtype='float32', always_2d=True)
    # soundfile returns (frames, channels); torchaudio default is (channels, frames)
    tensor = torch.from_numpy(data.T.copy() if channels_first else data.copy())
    return tensor, sr

def _soundfile_save(uri, src, sample_rate, channels_first=True,
                    format=None, encoding=None, bits_per_sample=None,
                    buffer_size=4096, backend=None, compression=None):
    # src is a Tensor: (channels, frames) if channels_first else (frames, channels)
    arr = src.numpy()
    if channels_first:
        arr = arr.T  # → (frames, channels)
    sf.write(str(uri), arr, sample_rate, subtype='PCM_16')

torchaudio.load = _soundfile_load
torchaudio.save = _soundfile_save
print("[xtts] torchaudio.load/save patched to use soundfile (torchcodec bypass)", flush=True)

_orig_torch_load = torch.load
def _patched_torch_load(f, *args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _orig_torch_load(f, *args, **kwargs)
torch.load = _patched_torch_load

from flask import Flask, request, send_file, jsonify

app = Flask(__name__)

# ── Model state ───────────────────────────────────────────────────────────────

tts_model = None
model_status = "loading"  # "loading" | "ready" | "error"
model_error = ""

# Map Story Studio language codes → XTTS v2 language codes
LANG_MAP = {
    "nl-NL": "nl",
    "zh-CN": "zh-cn",
    "nl":    "nl",
    "zh-cn": "zh-cn",
}

# ── Model loader (runs in background thread) ──────────────────────────────────

def load_model():
    global tts_model, model_status, model_error

    try:
        print("XTTS_STATUS:loading", flush=True)

        from TTS.api import TTS

        # Check for pre-bundled model in resources/xtts_model/ (production path).
        # If not present, TTS will auto-download to ~/.local/share/tts/ (~1.9 GB).
        local_model_dir = Path(__file__).parent / "xtts_model"
        if (local_model_dir / "model.pth").exists():
            print("[xtts] Loading bundled model from resources/xtts_model/", flush=True)
            tts_model = TTS(
                model_path=str(local_model_dir),
                config_path=str(local_model_dir / "config.json"),
            )
        else:
            print("[xtts] Downloading/loading XTTS v2 model (first run: ~1.9 GB)...", flush=True)
            tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")

        model_status = "ready"
        print("XTTS_STATUS:ready", flush=True)

    except Exception as e:
        model_status = "error"
        model_error = str(e)
        print(f"XTTS_STATUS:error:{e}", flush=True, file=sys.stderr)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "status": model_status,
        "error": model_error if model_status == "error" else None,
    })


@app.route("/synthesize", methods=["POST"])
def synthesize():
    if model_status != "ready":
        return jsonify({
            "error": f"Model not ready (status: {model_status}). Please wait."
        }), 503

    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    reference_audio_path = data.get("reference_audio_path", "").strip()
    raw_language = data.get("language", "nl-NL")
    language = LANG_MAP.get(raw_language, "nl")

    # Validate inputs
    if not text:
        return jsonify({"error": "text is required"}), 400
    if not reference_audio_path:
        return jsonify({"error": "reference_audio_path is required"}), 400
    if not Path(reference_audio_path).exists():
        return jsonify({"error": f"Reference audio not found: {reference_audio_path}"}), 400

    # Preprocess reference audio: denoise + normalize for better voice cloning
    cleaned_ref, was_cleaned = preprocess_reference_audio(reference_audio_path)

    # Synthesize to a temp WAV file, then stream it back
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()

    try:
        tts_model.tts_to_file(
            text=text,
            speaker_wav=cleaned_ref,
            language=language,
            file_path=tmp.name,
        )
        return send_file(
            tmp.name,
            mimetype="audio/wav",
            as_attachment=True,
            download_name="synthesis.wav",
        )
    except Exception as e:
        Path(tmp.name).unlink(missing_ok=True)
        return jsonify({"error": str(e)}), 500
    finally:
        if was_cleaned:
            Path(cleaned_ref).unlink(missing_ok=True)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Load model in a background thread so Flask is immediately available
    # (returns status "loading" from /health until model is ready)
    threading.Thread(target=load_model, daemon=True).start()

    # Bind to localhost only — never expose to the network
    app.run(host="127.0.0.1", port=5002, debug=False)
