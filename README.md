# AI Voice Chat - 100% In-Browser

A hands-free AI voice assistant that runs entirely in your browser or connects to external APIs. Features speech recognition, LLM integration, and text-to-speech with full streaming support.

## Live Demo

Try it now: [HuggingFace Space](https://huggingface.co/spaces/RickRossTN/ai-voice-chat)

## What Makes This Different

**Dual Operation Modes:**
- **Local Mode**: Everything runs in your browser using WebGPU/WASM
  - **Speech-to-Text**: Whisper model via WebGPU/WASM
  - **Voice Activity Detection**: Silero VAD detects when you're speaking
  - **LLM**: Qwen 1.5B via WebLLM
  - **Text-to-Speech**: Supertonic TTS with 10 natural voices

- **External API Mode**: Connect to any OpenAI-compatible API
  - **Streaming Support**: Real-time responses with thinking content
  - **Model Flexibility**: Use MiniMax, Claude, GPT-4, Gemini, or any compatible endpoint
  - **Thinking Models**: Support for reasoning content from advanced models

## Quick Start

### Local Mode (Default)
```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev
```

### External API Mode
```bash
# 1. Copy environment template
cp .env.example .env

# 2. Edit .env with your API credentials
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.minimax.chat  # or your preferred API
OPENAI_MODEL=MiniMax-M2

# 3. Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in Chrome or Edge.

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL | `https://api.minimax.chat` |
| `OPENAI_API_KEY` | Your API authentication key | `sk-...` |
| `OPENAI_MODEL` | Default model to use | `MiniMax-M2` |
| `NEXT_PUBLIC_OPENAI_MODEL` | Model name for client display | `MiniMax-M2` |
| `SYSTEM_PROMPT` | Custom system prompt (optional) | `You are a helpful assistant...` |
| `MAX_HISTORY` | Max conversation turns (optional) | `10` |

### Supported APIs

- **MiniMax**: Uses `https://api.minimax.chat` (default)
- **OpenAI**: `https://api.openai.com`
- **Anthropic**: Via OpenAI-compatible proxies
- **Ollama**: `http://localhost:11434`
- **LM Studio**: `http://localhost:1234`
- **Any OpenAI-compatible endpoint**

## What Downloads When (Local Mode)

| Asset | Size | When | Cached |
|-------|------|------|--------|
| Voice embeddings | ~500KB | Included in repo | ✓ Already local |
| Whisper STT model | ~150MB | First use | ✓ IndexedDB |
| Silero VAD model | ~2MB | First use | ✓ IndexedDB |
| Qwen 1.5B LLM | ~900MB | First use | ✓ IndexedDB |
| Supertonic TTS | ~50MB | First use | ✓ IndexedDB |

First load downloads ~1GB of models from HuggingFace CDN. After that, everything runs offline.

## Requirements

- **Browser**: Chrome 113+ or Edge 113+ (WebGPU required for local mode)
- **RAM**: ~4GB available for local models
- **Microphone**: Required for voice input
- **API Key**: Required for external API mode

Falls back to WASM if WebGPU unavailable (slower but works everywhere).

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                             │
│                                                             │
│  Microphone                                                 │
│       |                                                     │
│       v                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ Silero   │ > │ Whisper  │ > │ WebLLM   │ > │Supertonic│ │
│  │ VAD      │   │ STT      │   │(or API)  │   │ TTS      │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│       |              |              |              |        │
│  Detects        Transcribes    Generates       Speaks      │
│  speech         to text        response        response    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## New Features

### 🎯 Thinking Content Support
Advanced models like MiniMax provide reasoning content that shows the AI's thinking process. This is:
- Automatically extracted and displayed separately
- Expandable in the conversation interface
- Not included in the final spoken response

### 🌊 Real-Time Streaming
- **Instant responses**: See the AI thinking and generating in real-time
- **Streaming TTS**: Audio starts playing while the response is still generating
- **Interruption handling**: Start speaking to interrupt and queue new inputs

### 🎨 Enhanced UI
- **Modern color scheme**: Updated visual design
- **Better scrolling**: Smooth conversation flow with scroll controls
- **Voice selection**: 10 different TTS voices (5 female, 5 male)

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts         # External API proxy with streaming
│   │   └── models/route.ts       # Model listing endpoint
│   ├── page.tsx                  # Main voice chat UI
│   ├── layout.tsx                # App layout
│   └── globals.css               # Styles
├── components/ui/                # UI components
├── hooks/
│   ├── use-webllm.ts            # WebLLM integration
│   └── use-tts.ts               # TTS integration
└── lib/
    ├── tts.ts                    # TTS pipeline
    └── splitter.ts               # Text chunking

public/
├── stt-worker-esm.js             # Whisper + VAD worker
├── vad-processor.js              # Audio worklet
└── voices/                       # TTS voice embeddings (bundled)
```

## Voice Options

10 voices bundled (5 female, 5 male):
- F1: Calm, steady
- F2: Bright, cheerful
- F3: Professional
- F4: Confident
- F5: Gentle
- M1: Lively, upbeat
- M2: Deep, calm
- M3: Authoritative
- M4: Soft, friendly
- M5: Warm

## API Integration

The external API mode provides several advantages:

1. **No model downloads**: Skip the ~1GB download
2. **Better performance**: Server-side inference
3. **Advanced models**: Access to GPT-4, Claude, or specialized models
4. **Thinking content**: See the AI's reasoning process
5. **Streaming**: Real-time response generation

## Development

### Running in Development
```bash
# Local mode (WebLLM)
pnpm dev

# External API mode
# Set OPENAI_API_KEY in .env first
pnpm dev
```

### Building for Production
```bash
pnpm build
pnpm start
```

## Tech Stack

- **Framework**: Next.js 16, React 19
- **STT**: Whisper via @huggingface/transformers
- **VAD**: Silero VAD via ONNX Runtime
- **LLM**: Qwen 1.5B via @mlc-ai/web-llm (local) or OpenAI-compatible APIs
- **TTS**: Supertonic via @huggingface/transformers
- **Styling**: Tailwind CSS v4
- **Streaming**: Server-sent events for real-time updates

## License

MIT License - see [LICENSE](LICENSE)

## Credits

- [Whisper](https://github.com/openai/whisper) - OpenAI
- [Silero VAD](https://github.com/snakers4/silero-vad) - Silero Team
- [WebLLM](https://github.com/mlc-ai/web-llm) - MLC AI
- [Transformers.js](https://github.com/huggingface/transformers.js) - Hugging Face
- [Supertonic TTS](https://huggingface.co/onnx-community/Supertonic-TTS-ONNX) - Supertone