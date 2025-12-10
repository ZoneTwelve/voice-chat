# iRelate Voice Chat

A fully browser-based voice assistant. Speech recognition, LLM, and conversation all run locally in your browser - no API keys required for the core experience.

## What Makes This Different

**Everything runs in your browser:**
- **Speech-to-Text**: Whisper model running via WebGPU/WASM
- **Voice Activity Detection**: Silero VAD detects when you're speaking
- **LLM**: WebLLM loads Qwen/Llama directly into the browser
- **TTS**: Supertonic for natural speech output

No audio leaves your device. No API keys needed. Just open and talk.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

First load downloads ~1GB of models (cached for future visits).

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│                                                              │
│  🎤 Microphone                                               │
│       ↓                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐  │
│  │ Silero   │ → │ Whisper  │ → │ WebLLM   │ → │Supertonic│  │
│  │ VAD      │   │ STT      │   │ (Qwen)   │   │ TTS      │  │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘  │
│       ↓              ↓              ↓              ↓        │
│  Detects      Transcribes     Generates       Speaks        │
│  speech       to text         response        response      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## LLM Options

### Browser (Default)
WebLLM loads the model directly into your browser:
- Qwen 1.5B (default) - Good balance of quality and speed
- Qwen 0.5B - Faster, lighter
- Llama 1B/3B - Alternative models
- Gemma 2B, SmolLM - More options

### API Mode
For better responses, switch to API mode and use:
- OpenAI (GPT-4)
- Anthropic (Claude)
- Groq (fast inference)
- Ollama (local server)
- LM Studio (local server)

## Requirements

- Modern browser with WebGPU (Chrome 113+, Edge 113+)
- ~2GB RAM for models
- Microphone access

Falls back to WASM if WebGPU unavailable (slower but works).

## Environment Variables

Copy `.env.example` to `.env` and configure as needed:

```bash
# TTS server (required)
SUPERTONIC_URL=http://localhost:8000

# Optional: API keys for cloud LLMs
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
```

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main voice chat UI
│   │   └── api/              # API routes for LLM/TTS
│   ├── components/           # UI components
│   ├── hooks/
│   │   ├── use-webllm.ts     # WebLLM integration
│   │   └── use-tts.ts        # TTS integration
│   └── lib/                  # Utilities
├── public/
│   ├── stt-worker-esm.js     # Whisper + VAD worker
│   └── vad-processor.js      # Audio processor
└── backend/                  # Optional Python backend
```

## Tech Stack

- **Framework**: Next.js 16, React 19
- **STT**: @huggingface/transformers (Whisper)
- **VAD**: Silero VAD via ONNX Runtime
- **LLM**: @mlc-ai/web-llm
- **TTS**: Supertonic
- **Styling**: Tailwind CSS

## Development

```bash
# Run with network access (test on other devices)
pnpm dev --hostname 0.0.0.0

# Production build
pnpm build
pnpm start
```

## License

MIT License - see [LICENSE](LICENSE)

## Credits

Built by [iRelate](https://irelate.ai)

- [Whisper](https://github.com/openai/whisper) - OpenAI
- [Silero VAD](https://github.com/snakers4/silero-vad) - snakers4
- [WebLLM](https://github.com/mlc-ai/web-llm) - MLC AI
- [Transformers.js](https://github.com/xenova/transformers.js) - Hugging Face
- Supertonic TTS
