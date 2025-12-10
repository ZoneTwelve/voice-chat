"""
iRelate Voice Chat Backend
- STT: Local Whisper (free)
- LLM: Configurable (Claude, local, etc.)
- TTS: Supertonic (local, lightning fast)
"""

import os
import io
import sys
import base64
import tempfile
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv
import numpy as np

load_dotenv()

# Add Supertonic to path
SUPERTONIC_PATH = os.path.expanduser("~/Projects/supertonic/py")
sys.path.insert(0, SUPERTONIC_PATH)

# Supertonic config
SUPERTONIC_ONNX_DIR = os.path.expanduser("~/Projects/supertonic/assets/onnx")
SUPERTONIC_VOICES = {
    "F1": os.path.expanduser("~/Projects/supertonic/assets/voice_styles/F1.json"),
    "F2": os.path.expanduser("~/Projects/supertonic/assets/voice_styles/F2.json"),
    "M1": os.path.expanduser("~/Projects/supertonic/assets/voice_styles/M1.json"),
    "M2": os.path.expanduser("~/Projects/supertonic/assets/voice_styles/M2.json"),
}
SUPERTONIC_STEPS = 20
SUPERTONIC_SPEED = 1.15  # Slightly faster speech

# Lazy load Supertonic
_supertonic_tts = None
_supertonic_styles = {}

app = FastAPI(title="iRelate Voice Chat")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy load Whisper model
_whisper_model = None


def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        import whisper

        print("Loading Whisper model...")
        _whisper_model = whisper.load_model("base")  # or "small", "medium", "large"
        print("Whisper model loaded!")
    return _whisper_model


def get_supertonic():
    """Lazy load Supertonic TTS engine."""
    global _supertonic_tts, _supertonic_styles
    if _supertonic_tts is None:
        from helper import load_text_to_speech, load_voice_style

        print("Loading Supertonic TTS...")
        _supertonic_tts = load_text_to_speech(SUPERTONIC_ONNX_DIR, use_gpu=False)
        # Pre-load all voices
        for name, path in SUPERTONIC_VOICES.items():
            _supertonic_styles[name] = load_voice_style([path])
        print(f"Supertonic loaded! Voices: {list(_supertonic_styles.keys())}")
    return _supertonic_tts, _supertonic_styles


class ChatRequest(BaseModel):
    text: str
    conversation_history: Optional[list] = None


class TTSRequest(BaseModel):
    text: str
    voice_id: str = "F1"  # F1, F2, M1, M2


@app.get("/health")
async def health():
    return {"status": "ok", "service": "irelate-voice-chat"}


@app.post("/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    """
    Transcribe audio using local Whisper.
    Accepts audio file, returns transcription.
    """
    try:
        # Save uploaded audio to temp file
        audio_bytes = await audio.read()

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            model = get_whisper_model()
            result = model.transcribe(tmp_path)
            return {
                "text": result["text"].strip(),
                "language": result.get("language", "en"),
            }
        finally:
            os.unlink(tmp_path)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Send text to LLM and get response.
    Currently a placeholder - wire up to Claude/local LLM.
    """
    # TODO: Wire up to actual LLM
    # For now, echo back to test the pipeline
    return {"response": f"You said: {request.text}", "model": "echo-test"}


@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to speech using Supertonic (local, lightning fast).
    Returns proper WAV audio for browser playback.
    """
    import time
    import wave

    try:
        start = time.time()
        tts, styles = get_supertonic()

        # Map voice_id to Supertonic voice, default to F1
        voice_key = request.voice_id if request.voice_id in styles else "F1"
        style = styles[voice_key]

        # Generate audio
        wav, duration = tts(
            request.text, style, total_step=SUPERTONIC_STEPS, speed=SUPERTONIC_SPEED
        )

        # Get actual audio samples (wav is shape [1, samples])
        audio_duration = float(duration[0])
        sample_rate = tts.sample_rate  # 44100
        wav_samples = wav[0, : int(sample_rate * audio_duration)]

        # Convert to 16-bit PCM
        wav_int16 = (wav_samples * 32767).astype(np.int16)

        # Create proper WAV file
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(wav_int16.tobytes())

        wav_bytes = wav_buffer.getvalue()

        synth_time = time.time() - start
        print(
            f"Supertonic: {synth_time:.2f}s for {audio_duration:.1f}s audio (RTF: {synth_time / audio_duration:.3f})"
        )

        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "X-Synthesis-Time": str(synth_time),
                "X-Audio-Duration": str(audio_duration),
                "X-Sample-Rate": str(sample_rate),
            },
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tts/voices")
async def list_voices():
    """List available Supertonic voices."""
    return {"voices": list(SUPERTONIC_VOICES.keys()), "default": "F1"}


def chunk_text(text: str, min_chars: int = 100, max_chars: int = 300) -> list[str]:
    """
    Split text into chunks by sentences, respecting min/max character limits.
    Similar to the HuggingFace demo approach.
    """
    import re

    if not text or not text.strip():
        return []

    # Split by sentence-ending punctuation
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())

    chunks = []
    current_chunk = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        # If adding this sentence would exceed max, start new chunk
        if current_chunk and len(current_chunk) + len(sentence) + 1 > max_chars:
            if current_chunk:
                chunks.append(current_chunk)
            current_chunk = sentence
        else:
            current_chunk = (
                (current_chunk + " " + sentence).strip() if current_chunk else sentence
            )

        # If current chunk meets minimum and ends with punctuation, commit it
        if len(current_chunk) >= min_chars and current_chunk[-1] in ".!?":
            chunks.append(current_chunk)
            current_chunk = ""

    # Don't forget the last chunk
    if current_chunk:
        chunks.append(current_chunk)

    return chunks if chunks else [text]


class TTSStreamRequest(BaseModel):
    text: str
    voice_id: str = "F1"
    quality: int = 20  # denoising steps
    speed: float = 1.05


@app.post("/tts/stream")
async def text_to_speech_stream(request: TTSStreamRequest):
    """
    Stream TTS audio chunks for low-latency playback.
    Yields WAV chunks as they're generated - playback can start immediately!
    """
    import time
    import wave
    import struct

    tts, styles = get_supertonic()
    voice_key = request.voice_id if request.voice_id in styles else "F1"
    style = styles[voice_key]
    sample_rate = tts.sample_rate  # 44100

    # Split text into chunks
    chunks = chunk_text(request.text)
    print(f"Streaming TTS: {len(chunks)} chunks from {len(request.text)} chars")

    async def generate_audio_chunks():
        """Generator that yields audio chunks as they're synthesized."""

        for i, text_chunk in enumerate(chunks):
            start = time.time()

            # Synthesize this chunk
            wav, duration = tts(
                text_chunk, style, total_step=request.quality, speed=request.speed
            )

            # Extract audio samples
            audio_duration = float(duration[0])
            wav_samples = wav[0, : int(sample_rate * audio_duration)]

            # Convert to 16-bit PCM
            wav_int16 = (wav_samples * 32767).astype(np.int16)

            synth_time = time.time() - start
            print(
                f"  Chunk {i + 1}/{len(chunks)}: {synth_time:.2f}s for {audio_duration:.1f}s audio"
            )

            # Create a mini WAV file for this chunk
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                wf.writeframes(wav_int16.tobytes())

            # Yield chunk info as JSON + binary audio
            chunk_data = wav_buffer.getvalue()

            # Format: JSON metadata line + newline + binary audio + newline
            metadata = {
                "chunk": i + 1,
                "total": len(chunks),
                "text": text_chunk[:50] + "..." if len(text_chunk) > 50 else text_chunk,
                "duration": audio_duration,
                "synth_time": synth_time,
                "size": len(chunk_data),
            }

            # Yield as multipart-style chunks
            import json

            yield f"--chunk\r\n".encode()
            yield f"Content-Type: application/json\r\n\r\n".encode()
            yield (json.dumps(metadata) + "\r\n").encode()
            yield f"--chunk\r\n".encode()
            yield f"Content-Type: audio/wav\r\n".encode()
            yield f"Content-Length: {len(chunk_data)}\r\n\r\n".encode()
            yield chunk_data
            yield b"\r\n"

            # Add small silence between chunks (0.3s)
            if i < len(chunks) - 1:
                silence_samples = int(sample_rate * 0.3)
                silence = np.zeros(silence_samples, dtype=np.int16)
                silence_buffer = io.BytesIO()
                with wave.open(silence_buffer, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sample_rate)
                    wf.writeframes(silence.tobytes())
                yield silence_buffer.getvalue()

        yield b"--chunk--\r\n"  # End marker

    return StreamingResponse(
        generate_audio_chunks(),
        media_type="multipart/x-mixed-replace; boundary=chunk",
        headers={
            "X-Chunks": str(len(chunks)),
            "X-Sample-Rate": str(sample_rate),
        },
    )


@app.post("/tts/stream-simple")
async def text_to_speech_stream_simple(request: TTSStreamRequest):
    """
    Simpler streaming - just raw PCM chunks, easier to consume.
    First 4 bytes of each chunk = length, then audio data.
    """
    import time
    import struct

    tts, styles = get_supertonic()
    voice_key = request.voice_id if request.voice_id in styles else "F1"
    style = styles[voice_key]
    sample_rate = tts.sample_rate

    chunks = chunk_text(request.text)
    print(f"Streaming TTS (simple): {len(chunks)} chunks")

    async def generate():
        # First, send header with sample rate and chunk count
        header = struct.pack("<II", sample_rate, len(chunks))
        yield header

        for i, text_chunk in enumerate(chunks):
            start = time.time()

            wav, duration = tts(
                text_chunk, style, total_step=request.quality, speed=request.speed
            )
            audio_duration = float(duration[0])
            wav_samples = wav[0, : int(sample_rate * audio_duration)]
            wav_int16 = (wav_samples * 32767).astype(np.int16)
            pcm_bytes = wav_int16.tobytes()

            synth_time = time.time() - start
            print(
                f"  Chunk {i + 1}/{len(chunks)}: {synth_time:.2f}s for {audio_duration:.1f}s"
            )

            # Send chunk: 4-byte length + PCM data
            yield struct.pack("<I", len(pcm_bytes))
            yield pcm_bytes

            # Add silence between chunks
            if i < len(chunks) - 1:
                silence = np.zeros(int(sample_rate * 0.3), dtype=np.int16).tobytes()
                yield struct.pack("<I", len(silence))
                yield silence

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={
            "X-Sample-Rate": str(sample_rate),
            "X-Chunks": str(len(chunks)),
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
