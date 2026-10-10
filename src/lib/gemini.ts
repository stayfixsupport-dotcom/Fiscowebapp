/**
 * ==============================================================================
 * FISCO AI — HIGH-PERFORMANCE GEMINI INTEGRATION WITH MULTI-KEY ROTATION
 * ==============================================================================
 * Supports real-time token streaming, multi-key rotation pool (up to 12 keys),
 * rate-limit auto-failover, and document scanning.
 */

// Gather all configured Gemini API keys from environment
function getGeminiKeyPool(): string[] {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const keys: string[] = [];

  const addIfValid = (val?: string) => {
    if (val && typeof val === "string" && val.trim().length > 10) {
      const trimmed = val.trim();
      if (!keys.includes(trimmed)) keys.push(trimmed);
    }
  };

  addIfValid(env["VITE_GEMINI_API_KEY"]);
  addIfValid(env["GEMINI_API_KEY"]);

  // Multi-key pool: VITE_GEMINI_API_KEY_1 to 12
  for (let i = 1; i <= 12; i++) {
    addIfValid(env[`VITE_GEMINI_API_KEY_${i}`]);
  }

  return keys;
}

let activeKeyIndex = 0;

export function getActiveGeminiKey(): string | null {
  const pool = getGeminiKeyPool();
  if (pool.length === 0) return null;
  return pool[activeKeyIndex % pool.length] ?? null;
}

export function rotateGeminiKey(): string | null {
  const pool = getGeminiKeyPool();
  if (pool.length <= 1) return pool[0] ?? null;
  activeKeyIndex = (activeKeyIndex + 1) % pool.length;
  console.log(`[FISCO AI] Rotated to Gemini API Key #${activeKeyIndex + 1} of ${pool.length}`);
  return pool[activeKeyIndex] ?? null;
}

export const FISCO_AI_SYSTEM_INSTRUCTION = `
You are Fisco AI, a professional tax and accounting assistant inside the Fisco app. You support taxpayers, freelancers, small businesses, and accountants.

Be warm, precise, concise, and practical. Give clear next steps and explain relevant Fisco navigation only when you know the feature exists. Never claim that you changed, sent, filed, or reviewed something unless the app confirms that action.

Tax and accounting guidance:
- Fisco focuses on Poland and the European Union, but never infer a user's tax jurisdiction from their language, location, or account role. Ask which country and tax year apply when that changes the answer.
- Do not invent tax rates, deadlines, legal requirements, citations, or official links. If a detail is uncertain or may have changed, say so and direct the user to the relevant official authority or a qualified local accountant.
- Distinguish general information from individualized tax or legal advice. Recommend local professional advice for consequential decisions.
- Adapt guidance to whether the user is a taxpayer or an accountant when that context is supplied.

Language and format:
- Reply in the language the user used. Support Polish, English, French, and Arabic; preserve Arabic right-to-left text naturally.
- Keep answers easy to scan on mobile. Use short paragraphs, clear lists, and bold labels when useful; avoid unnecessary tables and long disclaimers.
- Never present yourself as a licensed accountant, attorney, or government representative.
`;

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Real-time token streaming chat with Gemini API.
 * Automatically tries multiple models and keys if rate limited.
 */
export async function streamGeminiChat({
  messages,
  onChunk,
  onDone,
  onError,
  role,
  signal,
}: {
  messages: ChatMessage[];
  onChunk: (chunk: string, fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
  role?: "taxpayer" | "accountant";
  signal?: AbortSignal;
}): Promise<void> {
  const keys = getGeminiKeyPool();
  if (keys.length === 0) {
    onError(
      new Error("No Gemini API key found. Please add VITE_GEMINI_API_KEY in your .env file."),
    );
    return;
  }

  // Format message history for Gemini API
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemInstructionPart = {
    parts: [
      {
        text: `${FISCO_AI_SYSTEM_INSTRUCTION}\nCurrent signed-in role: ${role ?? "not specified"}.`,
      },
    ],
  };

  let lastError: Error | null = null;
  const maxKeyAttempts = Math.min(keys.length * 2, 12);

  for (let keyAttempt = 0; keyAttempt < maxKeyAttempts; keyAttempt++) {
    const currentKey = keys[activeKeyIndex % keys.length];

    for (const model of [GEMINI_MODEL]) {
      if (signal?.aborted) return;

      try {
        const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${currentKey}`;

        const res = await fetch(streamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(signal ? { signal } : {}),
          body: JSON.stringify({
            systemInstruction: systemInstructionPart,
            contents,
            generationConfig: {
              temperature: 0.35,
              topP: 0.95,
              maxOutputTokens: 2048,
            },
          }),
        });

        if (res.status === 429 || res.status === 403) {
          // Rate limit or quota error: rotate key and try next key
          rotateGeminiKey();
          lastError = new Error(`Rate limit hit on key #${(activeKeyIndex % keys.length) + 1}`);
          break; // break model loop to try next key
        }

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 404) {
            onError(new Error(`Gemini model ${model} is unavailable for this API key.`));
            return;
          }
          throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 180)}`);
        }

        // Process SSE Stream
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Stream response body is not readable");

        const decoder = new TextDecoder();
        let fullAccumulated = "";
        let buffer = "";

        while (true) {
          if (signal?.aborted) {
            reader.cancel();
            return;
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;

            const jsonStr = trimmed.replace(/^data:\s*/, "");
            if (jsonStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const textChunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textChunk) {
                fullAccumulated += textChunk;
                onChunk(textChunk, fullAccumulated);
              }
            } catch {
              // ignore partial json chunk parse error
            }
          }
        }

        if (fullAccumulated.trim().length > 0) {
          onDone(fullAccumulated);
          return;
        }
      } catch (err) {
        if (signal?.aborted) return;
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[FISCO AI] Model ${model} failed:`, lastError.message);
      }
    }
  }

  onError(
    lastError ||
      new Error("Unable to reach Gemini API. Please check your network connection and API key."),
  );
}

export async function streamServerChat({
  messages,
  onChunk,
  onDone,
  onError,
  role,
  signal,
}: {
  messages: ChatMessage[];
  onChunk: (chunk: string, fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
  role?: "taxpayer" | "accountant";
  signal?: AbortSignal;
}): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sign in to use Fisco AI.");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        context: { role },
        messages: messages.map((message, index) => ({
          id: `chat-${index}`,
          role: message.role === "assistant" ? "assistant" : "user",
          parts: [{ type: "text", text: message.content }],
        })),
      }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(result?.error || `Fisco AI returned HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Fisco AI returned an unreadable stream.");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    const consume = (frame: string) => {
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: unknown;
            errorText?: string;
          };
          if (event.type === "error")
            throw new Error(event.errorText || "Fisco AI could not respond.");
          if (event.type === "text-delta" && typeof event.delta === "string") {
            fullText += event.delta;
            onChunk(event.delta, fullText);
          }
        } catch (error) {
          if (error instanceof Error && error.message !== "Unexpected end of JSON input")
            throw error;
        }
      }
    };

    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      frames.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!fullText.trim()) throw new Error("Fisco AI returned an empty response.");
    onDone(fullText);
  } catch (error) {
    if (!signal?.aborted) onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Scan & Extract Invoice/Receipt fields using Gemini Vision/Document OCR.
 */
export async function scanDocumentWithGemini(
  base64OrText: string,
  filename?: string,
  mimeType: string = "image/jpeg",
) {
  const keys = getGeminiKeyPool();
  if (keys.length === 0) return null;

  const currentKey = keys[activeKeyIndex % keys.length];
  const cleanBase64 = base64OrText.replace(/^data:.*?;base64,/, "");

  const prompt = `
You are a precision fiscal OCR extraction engine.
Analyze this invoice / receipt / fiscal document carefully. Extract values strictly in valid JSON format:
{
  "merchant": "Name of issuer/merchant/firm",
  "amount": 0.00,
  "currency": "EUR" or "DZD" or "USD" or "PLN",
  "date": "Document date e.g. 26 Mar 2026",
  "category": one of "Invoice", "Receipt", "Payroll", "Tax form", "Contract", "Utilities", "Transport", "Supplies", "Services", or "Other",
  "taxId": "VAT number or Tax ID if found, or null",
  "invoiceNumber": "Invoice reference number or null",
  "vat": 0.00 or null,
  "lineItems": [{"label": "description", "amount": 0.00}],
  "summary": "One sentence summary of the transaction"
}
Return only raw JSON.
`;

  for (const model of [GEMINI_MODEL]) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: mimeType || "image/jpeg",
                    data: cleanBase64,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (res.status === 429) {
        rotateGeminiKey();
        continue;
      }

      if (!res.ok) continue;

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(rawText);
    } catch (err) {
      console.warn("Scan doc error with model " + model, err);
    }
  }

  return null;
}
