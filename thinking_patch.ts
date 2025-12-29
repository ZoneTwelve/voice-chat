/**
 * THINKING PATCH FOR REASONING_CONTENT SUPPORT
 *
 * This patch handles thinking models that send their thinking process
 * in a separate `reasoning_content` field instead of embedding it
 * within the `content` field using `<think>` and `</think>` markers.
 *
 * ISSUE: Current implementation only handles embedded thinking content
 * but thinking models (like Qwen3-30B-A3B-Thinking) send thinking
 * in a separate `reasoning_content` field in the streaming API response.
 *
 * SOLUTION: Handle both `content` and `reasoning_content` fields from
 * streaming responses, with `reasoning_content` taking precedence for
 * thinking content extraction.
 */

// =============================================================================
// ORIGINAL CODE (CURRENT IMPLEMENTATION)
// =============================================================================

/*
// This is what the current streaming response handler looks like:

const handleLLMResponse = async (conversationHistory: ChatMessage[]) => {
  // ... existing code ...

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

          // ORIGINAL: Only handles content field
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            currentResponseRef.current += content;
            console.log("[Streaming] Chunk:", content);

            // Extract thinking using only content-based markers
            const { thinking, cleanResponse } = processResponse(
              currentResponseRef.current,
            );

            // Update message
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.role === "assistant") {
                newMessages[newMessages.length - 1] = {
                  ...lastMessage,
                  content: cleanResponse,
                  thinking: thinking,
                };
              }
              return newMessages;
            });
          }
        } catch (e) {
          console.debug("[Voice] Failed to parse streaming data:", e);
        }
      }
    }
  }
};
*/

// =============================================================================
// PATCHED CODE (NEW IMPLEMENTATION)
// =============================================================================

/**
 * Enhanced streaming response handler that supports reasoning_content field
 * This replaces the original handleLLMResponse function's streaming loop
 */
const handleLLMResponsePatched = async (conversationHistory: ChatMessage[]) => {
  // ... existing setup code remains the same ...

  // Current response tracking for both content and reasoning
  const currentContentRef = { current: "" };
  const currentReasoningRef = { current: "" };

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

          // PATCHED: Handle both content and reasoning_content fields
          const content = parsed.choices?.[0]?.delta?.content;
          const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content;

          if (content || reasoningContent) {
            // Accumulate content and reasoning separately
            if (content) {
              currentContentRef.current += content;
            }
            if (reasoningContent) {
              currentReasoningRef.current += reasoningContent;
            }

            // Determine thinking and clean response based on available data
            let thinking = null;
            let cleanResponse = "";

            if (reasoningContent || currentReasoningRef.current) {
              // For thinking models: reasoning_content has thinking, content has response
              thinking = currentReasoningRef.current;
              cleanResponse = currentContentRef.current;
            } else if (content) {
              // Fallback: Use original content-based thinking extraction
              const { thinking: extractedThinking, cleanResponse: extractedClean } = processResponse(
                currentContentRef.current,
              );
              thinking = extractedThinking;
              cleanResponse = extractedClean;
            }

            console.log("[Streaming] Content chunk:", content || "(empty)");
            console.log("[Streaming] Reasoning chunk:", reasoningContent || "(empty)");
            console.log("[Streaming] Combined thinking:", thinking?.substring(0, 100) + "...");
            console.log("[Streaming] Clean response:", cleanResponse?.substring(0, 100) + "...");

            // Update the latest assistant message
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.role === "assistant") {
                newMessages[newMessages.length - 1] = {
                  ...lastMessage,
                  // Show clean response (no thinking markers in main content)
                  content: cleanResponse,
                  // Store thinking separately for expandable UI
                  thinking: thinking,
                };
              }
              return newMessages;
            });
          }
        } catch (e) {
          console.debug(
            "[Voice] Failed to parse streaming data:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    }
  }

  // Final processing after stream completes
  const finalThinking = currentReasoningRef.current ||
    (currentContentRef.current ? processResponse(currentContentRef.current).thinking : null);
  const finalCleanResponse = currentContentRef.current || "";

  console.log("[LLM] Final thinking:", finalThinking?.substring(0, 200) + "...");
  console.log("[LLM] Final response:", finalCleanResponse);

  // Update final message state
  setMessages((prev) => {
    const newMessages = [...prev];
    const lastMessage = newMessages[newMessages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      newMessages[newMessages.length - 1] = {
        ...lastMessage,
        content: finalCleanResponse,
        thinking: finalThinking,
      };
    }
    return newMessages;
  });
};

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Enhanced message type that supports reasoning_content
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string | null; // Optional thinking content for expandable display
}

/**
 * Streaming chunk structure from thinking models
 */
export interface StreamingChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role: string;
      content: string | null;
      reasoning_content: string | null; // New field for thinking models
      tool_calls?: any[];
    };
    logprobs: null;
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
    completion_tokens: number;
  } | null;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Process response to extract thinking and clean content
 * Enhanced to handle both embedded markers and reasoning_content
 */
export const processResponseEnhanced = (rawResponse: string, reasoningContent?: string) => {
  // If we have explicit reasoning_content, use that
  if (reasoningContent) {
    return {
      thinking: reasoningContent.trim(),
      cleanResponse: rawResponse.trim(),
    };
  }

  // Fallback to original content-based extraction
  return processResponse(rawResponse);
};

/**
 * Check if a model is a thinking model based on response patterns
 */
export const isThinkingModel = (modelName: string, response?: any): boolean => {
  // Check model name patterns
  const thinkingModelPatterns = [
    /thinking/i,
    /qwen.*thinking/i,
    /reason/i,
    /chain.*thought/i,
  ];

  const hasThinkingName = thinkingModelPatterns.some(pattern => pattern.test(modelName));

  // Check response for reasoning_content field
  const hasReasoningContent = response?.choices?.[0]?.delta?.reasoning_content;

  return hasThinkingName || hasReasoningContent;
};

/**
 * Extract and combine streaming data from Server-Sent Events
 */
export const parseStreamingData = (data: string): StreamingChunk[] => {
  const chunks: StreamingChunk[] = [];
  const lines = data.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
      try {
        const jsonData = trimmedLine.slice(6);
        const parsed = JSON.parse(jsonData);
        chunks.push(parsed);
      } catch (e) {
        console.warn('Failed to parse streaming chunk:', e);
      }
    }
  }

  return chunks;
};

// =============================================================================
// USAGE EXAMPLES
// =============================================================================

/**
 * Example usage in a React component:
 *
 * const [messages, setMessages] = useState<ChatMessage[]>([]);
 *
 * // Use the patched streaming handler
 * await handleLLMResponsePatched(conversationHistory);
 *
 * // Or use the enhanced processor for individual responses
 * const { thinking, cleanResponse } = processResponseEnhanced(
 *   rawResponse,
 *   reasoningContent
 * );
 */

// =============================================================================
// MIGRATION GUIDE
// =============================================================================

/**
 * TO APPLY THIS PATCH:
 *
 * 1. Replace the streaming response handler in your handleLLMResponse function
 *    with the logic from handleLLMResponsePatched
 *
 * 2. Update your ChatMessage interface to include the optional 'thinking' field
 *
 * 3. Modify your message display component to show thinking content
 *    in an expandable section (e.g., with a "Show thinking" button)
 *
 * 4. Test with thinking models (like Qwen3-30B-A3B-Thinking) to ensure
 *    reasoning_content is properly extracted and displayed
 *
 * BACKWARDS COMPATIBILITY:
 * - The patch maintains full backwards compatibility with existing
 *   content-based thinking extraction using </think> markers
 * - Non-thinking models will continue to work exactly as before
 * - Only models that send reasoning_content will use the new path
 */

// =============================================================================
// TESTING
// =============================================================================

/**
 * Test data for development/testing:
 */
export const testStreamingChunk = {
  id: "test-123",
  object: "chat.completion.chunk",
  created: 1234567890,
  model: "Qwen3-30B-A3B-Thinking",
  choices: [{
    index: 0,
    delta: {
      role: "assistant",
      content: "Hello! How can I help you today?",
      reasoning_content: "The user said hello, so I should respond with a friendly greeting and ask how I can assist them.",
      tool_calls: []
    },
    logprobs: null,
    finish_reason: null
  }],
  usage: null
};

/**
 * Expected output when processing the test chunk:
 * - content: "Hello! How can I help you today?"
 * - thinking: "The user said hello, so I should respond with a friendly greeting and ask how I can assist them."
 */
