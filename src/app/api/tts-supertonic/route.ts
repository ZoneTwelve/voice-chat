import { NextRequest } from "next/server"

const SUPERTONIC_URL = process.env.SUPERTONIC_URL || "http://localhost:8000"

export async function POST(request: NextRequest) {
  const { text, voice = "F1" } = await request.json()

  if (!text) {
    return new Response(JSON.stringify({ error: "Text is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const startTime = Date.now()
  console.log(`[Supertonic] Starting: "${text.substring(0, 50)}..."`)

  // Call our Supertonic backend
  const response = await fetch(`${SUPERTONIC_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text,
      voice_id: voice,
    }),
  })

  if (!response.ok) {
    console.error(`[Supertonic] Error: ${response.status}`)
    return new Response(JSON.stringify({ error: "TTS failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const synthTime = response.headers.get("X-Synthesis-Time")
  const audioDuration = response.headers.get("X-Audio-Duration")
  console.log(`[Supertonic] Response in ${Date.now() - startTime}ms (synth: ${synthTime}s, audio: ${audioDuration}s)`)

  // Stream through raw PCM audio
  return new Response(response.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Sample-Rate": "44100",
      "X-Synthesis-Time": synthTime || "",
      "X-Audio-Duration": audioDuration || "",
    },
  })
}
