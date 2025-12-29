import { NextRequest, NextResponse } from "next/server";

// Environment variables with fallback defaults
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.minimax.chat";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "MiniMax-M2";

export async function POST(request: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      console.error("[API] Missing OPENAI_API_KEY environment variable");
      return NextResponse.json(
        {
          error:
            "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.",
        },
        { status: 500 },
      );
    }

    const body = await request.json();
    const { messages, stream = true, model } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 },
      );
    }

    if (messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array cannot be empty" },
        { status: 400 },
      );
    }

    // Use provided model or default
    const modelToUse = model || DEFAULT_MODEL;
    console.log(
      `[API] Request - Model: ${modelToUse}, Streaming: ${stream}, Messages: ${messages.length}`,
    );

    // Prepare the request to OpenAI-compatible API
    const apiRequestBody = {
      model: modelToUse,
      stream,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful voice assistant. Keep responses concise and conversational - typically 1-3 sentences. Be warm and friendly. Use plain ASCII characters only - no emojis, no smart quotes, no fancy punctuation.",
        },
        ...messages,
      ],
    };

    console.log(
      "[API] Sending request to:",
      `${OPENAI_BASE_URL}/v1/chat/completions`,
    );

    // Make the request to the external API
    const response = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(apiRequestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[API] External API error:", response.status, errorText);
      return NextResponse.json(
        {
          error: `External API error: ${response.status} ${response.statusText}`,
          details: errorText,
        },
        { status: response.status },
      );
    }

    // Handle streaming response
    if (stream) {
      console.log("[API] Streaming response enabled");

      const encoder = new TextEncoder();
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            const reader = response.body?.getReader();
            if (!reader) {
              throw new Error("No response body reader available");
            }

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              // Check if controller is still open before enqueueing
              try {
                controller.enqueue(value);
              } catch (err) {
                console.warn("[API] Controller closed, stopping stream");
                break;
              }
            }

            // Only close if controller is still open
            try {
              controller.close();
            } catch (err) {
              console.warn("[API] Controller already closed");
            }
          } catch (error) {
            console.error("[API] Streaming error:", error);
            // Only error if controller is still open
            try {
              controller.error(error);
            } catch (err) {
              console.warn(
                "[API] Controller already closed, cannot send error",
              );
            }
          }
        },
      });

      return new Response(responseStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    } else {
      // Non-streaming response
      console.log("[API] Non-streaming response");

      const data = await response.json();

      return NextResponse.json(data, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }
  } catch (error) {
    console.error("[API] Chat route error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        type: "server_error",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    if (!OPENAI_API_KEY) {
      console.error("[API] Missing OPENAI_API_KEY environment variable");
      return NextResponse.json(
        {
          error:
            "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.",
        },
        { status: 500 },
      );
    }

    console.log("[API] Fetching models from:", `${OPENAI_BASE_URL}/v1/models`);

    const response = await fetch(`${OPENAI_BASE_URL}/v1/models`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[API] Models API error:", response.status, errorText);
      return NextResponse.json(
        {
          error: `Failed to fetch models: ${response.status} ${response.statusText}`,
          details: errorText,
        },
        { status: response.status },
      );
    }

    const data = await response.json();
    console.log(
      "[API] Models fetched successfully:",
      data.data?.length || 0,
      "models",
    );

    return NextResponse.json(data, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  } catch (error) {
    console.error("[API] Models route error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        type: "server_error",
      },
      { status: 500 },
    );
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    },
  });
}
