"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LiveWaveform } from "@/components/ui/live-waveform";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ui/conversation";
import { Message, MessageContent } from "@/components/ui/message";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Phone,
  PhoneOff,
  ChevronDown,
  Settings,
  X,
} from "lucide-react";
import { useTTS, type TTSVoice } from "@/hooks/use-tts";

type Status =
  | "idle"
  | "loading"
  | "ready"
  | "listening"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";
type LLMMode = "external-api";

// Model configuration for external API
const DEFAULT_MODEL = "MiniMax-M2";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string | null;
}

export default function VoiceChat() {
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Click 'Initialize' to load models",
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [llmMode] = useState<LLMMode>("external-api");
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState({
    webgpu: "checking...",
    sttBackend: "unknown",
    llmMode: "external-api",
    vadLoaded: false,
    sttLoaded: false,
    ttsLoaded: false,
    llmLoaded: false,
  });

  const workerRef = useRef<Worker | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isCallActiveRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const isProcessingRef = useRef(false); // Lock to prevent parallel LLM/TTS calls
  const abortControllerRef = useRef<AbortController | null>(null); // For cancelling LLM requests
  const pendingUserInputRef = useRef<string | null>(null); // Queue user input during processing
  const currentResponseRef = useRef<string>(""); // Current streaming response

  // WebGPU TTS
  const tts = useTTS({
    onStatusChange: (ttsStatus) => {
      if (ttsStatus === "speaking") {
        setStatus("speaking");
        setStatusMessage("Speaking...");
      }
    },
    onError: (error) => {
      console.error("TTS error:", error);
      setStatusMessage(`TTS error: ${error.message}`);
    },
  });

  // Keep refs in sync for use in callbacks
  useEffect(() => {
    isCallActiveRef.current = isCallActive;
  }, [isCallActive]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Initialize STT worker
  const initWorker = useCallback(() => {
    if (workerRef.current) return;

    const worker = new Worker("/stt-worker-esm.js", { type: "module" });

    worker.onmessage = async (event) => {
      const { type, status: msgStatus, message, text, isFinal } = event.data;

      switch (type) {
        case "status":
          if (msgStatus === "ready") {
            setDebugInfo((prev) => ({
              ...prev,
              vadLoaded: true,
              sttLoaded: true,
            }));

            // STT ready, now load TTS
            setStatusMessage("Loading TTS model...");
            await tts.loadModels();
            setDebugInfo((prev) => ({ ...prev, ttsLoaded: true }));

            // External API - no LLM to load
            setDebugInfo((prev) => ({ ...prev, llmLoaded: true }));

            setStatus("ready");
            setStatusMessage("Ready! Click 'Start Call' to begin.");
            console.log("[Voice] Ready - STT, TTS loaded");
          } else if (msgStatus === "loading") {
            setStatus("loading");
            setStatusMessage(message);
          } else if (msgStatus === "listening") {
            if (isCallActiveRef.current) {
              setStatus("listening");
              setStatusMessage("Listening...");
            }
          } else if (msgStatus === "recording") {
            setStatus("recording");
            setStatusMessage("Recording...");
          } else if (msgStatus === "transcribing") {
            setStatus("transcribing");
            setStatusMessage("Transcribing...");
          }
          break;

        case "transcript":
          if (isFinal && text && text.trim()) {
            console.log("[STT]", text);

            // If we're currently processing, interrupt and queue the new input
            if (isProcessingRef.current) {
              console.debug("[Voice] Interrupting - new user input");
              // Cancel ongoing LLM request
              abortControllerRef.current?.abort();
              // Stop TTS playback
              tts.stop();
              // Queue this input
              pendingUserInputRef.current = text.trim();
              return;
            }

            const userMessage: ChatMessage = {
              role: "user",
              content: text.trim(),
            };
            setMessages((prev) => [...prev, userMessage]);
            handleLLMResponse([...messagesRef.current, userMessage]);
          }
          break;

        case "error":
          setStatus("error");
          setStatusMessage(`Error: ${message}`);
          break;
      }
    };

    worker.onerror = (error) => {
      console.error("Worker error:", error);
      setStatus("error");
      setStatusMessage(`Worker error: ${error.message}`);
    };

    workerRef.current = worker;
  }, [tts]);

  // Load models
  const loadModels = useCallback(async () => {
    initWorker();
    setStatus("loading");
    setStatusMessage("Loading STT models...");
    workerRef.current?.postMessage({ type: "init" });
  }, [initWorker]);

  // Extract thinking content and clean response for MiniMax model
  const processResponse = (rawResponse: string) => {
    const startMarker = "<think>";
    const endMarker = "</think>";

    const startIndex = rawResponse.indexOf(startMarker);
    const endIndex = rawResponse.indexOf(endMarker);

    let thinking = null;
    let cleanResponse = rawResponse;

    if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
      // Extract thinking content
      thinking = rawResponse
        .substring(startIndex + startMarker.length, endIndex)
        .trim();

      // Build clean response by removing the entire thinking section
      const beforeThinking = rawResponse.substring(0, startIndex);
      const afterThinking = rawResponse.substring(endIndex + endMarker.length);
      cleanResponse = (beforeThinking + afterThinking).trim();
    }

    return { thinking, cleanResponse };
  };

  // Handle external LLM response with streaming support
  const handleLLMResponse = async (conversationHistory: ChatMessage[]) => {
    // Prevent parallel LLM/TTS calls
    if (isProcessingRef.current) {
      console.debug("[Voice] Ignoring request - already processing");
      return;
    }
    isProcessingRef.current = true;
    pendingUserInputRef.current = null;
    currentResponseRef.current = "";

    // Create abort controller for API requests
    abortControllerRef.current = new AbortController();

    setStatus("thinking");
    setStatusMessage("Thinking...");

    try {
      // Prepare messages for API
      const apiMessages = conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      console.debug("[Voice] Using external API, history:", apiMessages.length);

      // Add empty assistant message to conversation for streaming updates
      const assistantMessage: ChatMessage = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMessage]);

      // Call external API with streaming
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: apiMessages,
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith("data: ")) {
            const data = trimmedLine.slice(6);
            if (data === "[DONE]") {
              break;
            }

            try {
              const parsed = JSON.parse(data);

              // Extract content from OpenAI streaming format: choices[0].delta.content
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                currentResponseRef.current += content;
                console.log("[Streaming] Chunk:", content);

                // Update the latest assistant message with streaming content
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage && lastMessage.role === "assistant") {
                    lastMessage.content = currentResponseRef.current;
                  }
                  return newMessages;
                });
              }
            } catch (e) {
              console.debug(
                "[Voice] Failed to parse streaming data:",
                e.message,
              );
            }
          }
        }
      }

      // Process final response to extract thinking content
      const rawResponse = currentResponseRef.current;
      const { thinking, cleanResponse } = processResponse(rawResponse);

      // Update message with thinking content if present
      if (thinking) {
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.role === "assistant") {
            lastMessage.thinking = thinking;
          }
          return newMessages;
        });
      }

      // Start TTS with the clean response (without thinking)
      if (cleanResponse.trim()) {
        console.log("[LLM] Clean:", cleanResponse);
        if (thinking) {
          console.log("[LLM] Thinking:", thinking);
        }

        // Speak the response (can be interrupted)
        setStatus("speaking");
        setStatusMessage("Speaking...");
        await tts.speak(cleanResponse);

        if (isCallActiveRef.current) {
          setStatus("listening");
          setStatusMessage("Listening...");
        }
      }
    } catch (error) {
      // Check if this was an intentional abort (user interrupted)
      if (error instanceof Error && error.name === "AbortError") {
        console.debug("[Voice] Request aborted by user interruption");
      } else {
        console.error("LLM error:", error);
        setStatusMessage(`LLM error: ${error}`);
      }
      if (isCallActiveRef.current) {
        setStatus("listening");
        setStatusMessage("Listening...");
      }
    } finally {
      isProcessingRef.current = false;
      abortControllerRef.current = null;
      currentResponseRef.current = "";

      // Process any pending user input that came in during processing
      if (pendingUserInputRef.current) {
        const pendingText = pendingUserInputRef.current;
        pendingUserInputRef.current = null;
        console.debug("[Voice] Processing pending input:", pendingText);
        const userMessage: ChatMessage = { role: "user", content: pendingText };
        setMessages((prev) => [...prev, userMessage]);
        // Use setTimeout to avoid call stack issues
        setTimeout(() => {
          handleLLMResponse([...messagesRef.current, userMessage]);
        }, 0);
      }
    }
  };

  // Start microphone and VAD
  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/vad-processor.js");

      const workletNode = new AudioWorkletNode(audioContext, "vad-processor");
      workletNodeRef.current = workletNode;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(workletNode);

      workletNode.port.onmessage = (event) => {
        const { buffer } = event.data;
        workerRef.current?.postMessage({ type: "audio", buffer });
      };

      setStatus("listening");
      setStatusMessage("Listening...");
    } catch (error) {
      console.error("Microphone error:", error);
      setStatus("error");
      setStatusMessage(`Microphone error: ${error}`);
    }
  };

  // Stop microphone
  const stopListening = () => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    workerRef.current?.postMessage({ type: "stop" });
  };

  // Toggle mic mute
  const toggleMicMute = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = isMicMuted;
        setIsMicMuted(!isMicMuted);
      }
    }
  };

  // Start call
  const startCall = async () => {
    setIsCallActive(true);
    setMessages([]);
    await startListening();
  };

  // End call
  const endCall = () => {
    // Abort any pending LLM request
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isProcessingRef.current = false;

    setIsCallActive(false);
    stopListening();
    tts.stop();
    setStatus("ready");
    setStatusMessage("Ready! Click mic to start a new call.");
  };

  // Check WebGPU support and auto-initialize on mount
  useEffect(() => {
    // Only check for audio features, not WebGPU for LLM
    const checkWebGPU = async () => {
      if (typeof navigator !== "undefined" && "gpu" in navigator) {
        try {
          const adapter = await (
            navigator as unknown as {
              gpu: { requestAdapter(): Promise<unknown> };
            }
          ).gpu.requestAdapter();
          setDebugInfo((prev) => ({
            ...prev,
            webgpu: adapter ? "available" : "no adapter",
          }));
        } catch {
          setDebugInfo((prev) => ({ ...prev, webgpu: "error" }));
        }
      } else {
        setDebugInfo((prev) => ({ ...prev, webgpu: "not supported" }));
      }
    };
    checkWebGPU();

    console.debug("[Voice] Auto-initializing...");
    loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      workerRef.current?.terminate();
    };
  }, []);

  // Waveform states
  const waveformActive = status === "listening" || status === "recording";
  const waveformProcessing =
    status === "speaking" || status === "thinking" || status === "transcribing";

  const voices: { id: TTSVoice; name: string; desc: string }[] = [
    { id: "F1", name: "Female 1", desc: "Calm, steady" },
    { id: "F2", name: "Female 2", desc: "Bright, cheerful" },
    { id: "F3", name: "Female 3", desc: "Professional" },
    { id: "F4", name: "Female 4", desc: "Confident" },
    { id: "F5", name: "Female 5", desc: "Gentle" },
    { id: "M1", name: "Male 1", desc: "Lively, upbeat" },
    { id: "M2", name: "Male 2", desc: "Deep, calm" },
    { id: "M3", name: "Male 3", desc: "Authoritative" },
    { id: "M4", name: "Male 4", desc: "Soft, friendly" },
    { id: "M5", name: "Male 5", desc: "Warm" },
  ];

  return (
    <div className="h-screen bg-zinc-950 flex flex-col">
      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <Conversation className="max-w-2xl mx-auto">
          <ConversationContent>
            {messages.length === 0 ? (
              <div className="text-center py-20">
                <h1 className="text-2xl font-semibold text-white mb-2">
                  AI Voice Chat
                </h1>
                <p className="text-zinc-400 text-sm mb-4">
                  External API — powered by MiniMax-M2
                </p>
                <p className="text-zinc-500">
                  {status === "idle"
                    ? "Click Initialize to load the voice models"
                    : status === "loading"
                      ? statusMessage
                      : isCallActive
                        ? "Start speaking..."
                        : "Click the phone to start a call"}
                </p>
                {status === "loading" &&
                  tts.loadProgress > 0 &&
                  tts.loadProgress < 100 && (
                    <div className="mt-4 w-64 mx-auto space-y-2">
                      <div>
                        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${tts.loadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-zinc-600 mt-1">
                          TTS: {Math.round(tts.loadProgress)}%
                        </p>
                      </div>
                    </div>
                  )}
              </div>
            ) : (
              messages.map((msg, i) => (
                <Message
                  key={i}
                  from={msg.role === "user" ? "user" : "assistant"}
                >
                  <MessageContent variant="contained">
                    {/* Show thinking content in expandable section */}
                    {msg.thinking && (
                      <details className="mb-2 group">
                        <summary className="text-xs text-zinc-500 hover:text-zinc-400 cursor-pointer list-none">
                          <span className="inline-flex items-center gap-1">
                            🤔 Thinking process
                            <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
                          </span>
                        </summary>
                        <div className="mt-2 p-2 bg-zinc-800/50 rounded text-xs text-zinc-400 font-mono">
                          {msg.thinking}
                        </div>
                      </details>
                    )}
                    {/* Show the actual response */}
                    {msg.content}
                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Bottom controls */}
      <div className="border-t border-zinc-800 bg-zinc-900">
        <div className="max-w-2xl mx-auto px-4 py-3">
          {/* Debug panel toggle */}
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => setShowDebugPanel(!showDebugPanel)}
              className="text-xs text-zinc-500 hover:text-zinc-400"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          {/* Debug panel */}
          {showDebugPanel && (
            <div className="fixed top-4 right-4 bg-zinc-900 border border-zinc-700 rounded-lg p-4 text-xs font-mono z-50 min-w-[200px]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-zinc-400 font-semibold">Debug Info</span>
                <button
                  onClick={() => setShowDebugPanel(false)}
                  className="text-zinc-500 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1 text-zinc-300">
                <div>
                  WebGPU:{" "}
                  <span
                    className={
                      debugInfo.webgpu === "available"
                        ? "text-green-400"
                        : "text-yellow-400"
                    }
                  >
                    {debugInfo.webgpu}
                  </span>
                </div>
                <div>
                  LLM Mode: <span className="text-blue-400">External API</span>
                </div>
                <hr className="border-zinc-700 my-2" />
                <div>
                  VAD:{" "}
                  {debugInfo.vadLoaded ? (
                    <span className="text-green-400">✓</span>
                  ) : (
                    <span className="text-zinc-500">○</span>
                  )}
                </div>
                <div>
                  STT:{" "}
                  {debugInfo.sttLoaded ? (
                    <span className="text-green-400">✓</span>
                  ) : (
                    <span className="text-zinc-500">○</span>
                  )}
                </div>
                <div>
                  TTS:{" "}
                  {debugInfo.ttsLoaded ? (
                    <span className="text-green-400">✓</span>
                  ) : (
                    <span className="text-zinc-500">○</span>
                  )}
                </div>
                <div>
                  API: <span className="text-green-400">✓</span>
                </div>
                <hr className="border-zinc-700 my-2" />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowDebugPanel(false);
                      endCall();
                      setTimeout(() => {
                        setMessages([]);
                        loadModels();
                      }, 100);
                    }}
                    className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Text input / Status area */}
          {isCallActive ? (
            <div className="text-zinc-500 text-sm mb-3 px-2">
              {status === "listening"
                ? "Listening..."
                : status === "recording"
                  ? "Recording..."
                  : status === "thinking"
                    ? "Thinking..."
                    : status === "speaking"
                      ? "Speaking..."
                      : "..."}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!textInput.trim() || status !== "ready") return;
                const userMessage: ChatMessage = {
                  role: "user",
                  content: textInput.trim(),
                };
                setMessages((prev) => [...prev, userMessage]);
                handleLLMResponse([...messagesRef.current, userMessage]);
                setTextInput("");
              }}
              className="mb-3"
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={
                  status === "idle"
                    ? "Initialize to start..."
                    : status === "loading"
                      ? statusMessage
                      : "How can I help?"
                }
                disabled={status !== "ready"}
                className="w-full bg-transparent text-zinc-200 text-sm px-2 py-1 outline-none placeholder:text-zinc-500 disabled:text-zinc-500"
              />
            </form>
          )}

          {/* Controls row */}
          <div className="flex items-center gap-2">
            {/* Waveform - takes remaining space */}
            <div className="flex-1 mx-2">
              <LiveWaveform
                analyser={null}
                smoothingTimeConstant={0.8}
                height={32}
                mode="static"
                className={
                  waveformActive
                    ? "text-green-400"
                    : waveformProcessing
                      ? "text-blue-400"
                      : "text-zinc-600"
                }
              />
            </div>

            {/* Controls - fixed width on right */}
            <div className="flex items-center gap-2">
              {/* Mic toggle (during calls only) */}
              {isCallActive && status === "listening" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleMicMute}
                  className={`h-10 w-10 rounded-full ${
                    isMicMuted
                      ? "text-red-400 hover:text-red-300"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                  }`}
                  title={isMicMuted ? "Unmute mic" : "Mute mic"}
                >
                  {isMicMuted ? (
                    <MicOff className="h-5 w-5" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </Button>
              )}

              {/* Speaker toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => tts.setMuted(!tts.muted)}
                className={`h-10 w-10 rounded-full ${
                  tts.muted
                    ? "text-red-400 hover:text-red-300"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                }`}
                title={tts.muted ? "Unmute speaker" : "Mute speaker"}
              >
                {tts.muted ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </Button>

              {/* Voice selector */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowVoiceMenu(!showVoiceMenu)}
                  className="h-10 w-10 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                  title="Voice selection"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>

                {showVoiceMenu && (
                  <>
                    {/* Click outside to close */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowVoiceMenu(false)}
                    />
                    <div className="absolute bottom-full mb-2 right-0 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[140px] z-20">
                      {voices.map((voice) => (
                        <button
                          key={voice.id}
                          onClick={() => {
                            tts.setVoice(voice.id);
                            setShowVoiceMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-zinc-700 ${
                            tts.voice === voice.id
                              ? "bg-zinc-700 text-white"
                              : "text-zinc-300"
                          }`}
                        >
                          <div className="font-medium">{voice.name}</div>
                          <div className="text-xs text-zinc-500">
                            {voice.desc}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Call toggle - colored (green start / red end) - far right */}
              {status !== "loading" && status !== "idle" && (
                <Button
                  onClick={isCallActive ? endCall : startCall}
                  variant="ghost"
                  size="sm"
                  className={`h-10 w-10 rounded-full ${
                    isCallActive
                      ? "text-red-400 hover:text-red-300 hover:bg-red-900/20"
                      : "text-green-400 hover:text-green-300 hover:bg-green-900/20"
                  }`}
                  title={isCallActive ? "End call" : "Start call"}
                >
                  {isCallActive ? (
                    <PhoneOff className="h-5 w-5" />
                  ) : (
                    <Phone className="h-5 w-5" />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
