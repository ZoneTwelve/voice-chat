import { NextRequest, NextResponse } from "next/server"

export type LLMProvider = "claude" | "openai" | "groq" | "ollama" | "lmstudio"

interface ChatRequest {
  messages: { role: "user" | "assistant" | "system"; content: string }[]
  provider?: LLMProvider
  model?: string
  systemPrompt?: string
  stream?: boolean
}

// LLM Harness - route to different providers

async function callClaude(messages: ChatRequest["messages"], model: string = "claude-sonnet-4-20250514") {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured")

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: messages.filter(m => m.role !== "system"),
      system: messages.find(m => m.role === "system")?.content,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

async function callOpenAI(messages: ChatRequest["messages"], model: string = "gpt-4o") {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured")

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

async function callGroq(messages: ChatRequest["messages"], model: string = "llama-3.3-70b-versatile") {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY not configured")

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Groq API error: ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

async function callOllama(messages: ChatRequest["messages"], model: string = "llama3.2") {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434"

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Ollama API error: ${error}`)
  }

  const data = await response.json()
  return data.message.content
}

async function callLMStudio(messages: ChatRequest["messages"], model: string = "default") {
  const baseUrl = process.env.LMSTUDIO_URL || "http://ricks-mbp.local:1234"

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`LM Studio API error: ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

async function callLMStudioStreaming(messages: ChatRequest["messages"], model: string = "default"): Promise<ReadableStream> {
  const baseUrl = process.env.LMSTUDIO_URL || "http://ricks-mbp.local:1234"

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
      stream: true,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`LM Studio API error: ${error}`)
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader()
      if (!reader) {
        controller.close()
        return
      }

      let buffer = ""
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
              continue
            }
            
            try {
              const event = JSON.parse(data)
              const content = event.choices?.[0]?.delta?.content
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`))
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }
      
      controller.close()
    }
  })
}

export async function POST(request: NextRequest) {
  try {
    const { messages, provider = "claude", model, systemPrompt, stream = false }: ChatRequest = await request.json()

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages are required" },
        { status: 400 }
      )
    }

    // Prepend system prompt if provided
    const allMessages = systemPrompt 
      ? [{ role: "system" as const, content: systemPrompt }, ...messages]
      : messages

    // Streaming mode
    if (stream && provider === "lmstudio") {
      const streamResponse = await callLMStudioStreaming(allMessages, model)
      return new Response(streamResponse, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      })
    }

    // Non-streaming mode
    let response: string
    let modelUsed: string = model || "unknown"
    let usage: { input_tokens: number; output_tokens: number } | undefined

    switch (provider) {
      case "claude":
        response = await callClaude(allMessages, model)
        break
      case "openai":
        response = await callOpenAI(allMessages, model)
        break
      case "groq":
        response = await callGroq(allMessages, model)
        break
      case "ollama":
        response = await callOllama(allMessages, model)
        break
      case "lmstudio":
        response = await callLMStudio(allMessages, model)
        break
      default:
        return NextResponse.json(
          { error: `Unknown provider: ${provider}` },
          { status: 400 }
        )
    }

    return NextResponse.json({ response, provider, model: modelUsed, usage })
  } catch (error) {
    console.error("Chat API error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get response" },
      { status: 500 }
    )
  }
}
