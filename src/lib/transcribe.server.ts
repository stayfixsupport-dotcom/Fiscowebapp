const MODEL = "gemini-2.5-flash";
const MAX_BYTES = 12 * 1024 * 1024;
const TRANSCRIPTION_PROMPT =
  "Transcribe the audio verbatim. Automatically identify whether the speaker is speaking Arabic, English, or French. Preserve the spoken language and script, including Arabic script. Do not translate, summarize, explain, or add labels. Return only the words spoken. If there is no intelligible speech, return an empty response.";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
};

function getGeminiKeys(): string[] {
  const viteEnv =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const keys = new Set<string>();
  const add = (value: string | undefined) => {
    const key = value?.trim();
    if (key) keys.add(key);
  };

  add(process.env["GEMINI_API_KEY"] ?? viteEnv["GEMINI_API_KEY"]);
  add(process.env["VITE_GEMINI_API_KEY"] ?? viteEnv["VITE_GEMINI_API_KEY"]);
  for (let index = 1; index <= 12; index++) {
    add(process.env[`GEMINI_API_KEY_${index}`] ?? viteEnv[`GEMINI_API_KEY_${index}`]);
    add(process.env[`VITE_GEMINI_API_KEY_${index}`] ?? viteEnv[`VITE_GEMINI_API_KEY_${index}`]);
  }
  return [...keys];
}

async function transcribeWithGemini(file: File, signal: AbortSignal): Promise<string | null> {
  const audio = Buffer.from(await file.arrayBuffer()).toString("base64");
  for (const key of getGeminiKeys()) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: TRANSCRIPTION_PROMPT },
                { inlineData: { mimeType: file.type, data: audio } },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
      },
    );
    if (!response.ok) continue;
    const result = (await response.json()) as GeminiResponse;
    return (result.candidates?.[0]?.content?.parts ?? [])
      .flatMap((part) => (typeof part.text === "string" ? [part.text] : []))
      .join(" ")
      .trim();
  }
  return null;
}

async function transcribeWithGateway(file: File, signal: AbortSignal): Promise<string | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;

  const upstream = new FormData();
  upstream.append("model", "google/gemini-3.5-transcribe");
  upstream.append("file", file, file.name || "recording.wav");
  upstream.append("response_format", "json");
  const response = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upstream,
    signal,
  });
  if (!response.ok) return null;
  const result = (await response.json()) as { text?: unknown };
  return typeof result.text === "string" ? result.text.trim() : "";
}

export async function handleTranscribe(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024)
    return Response.json({ error: "Recording too long" }, { status: 413 });

  const form = await request.formData();
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > MAX_BYTES ||
    !file.type.startsWith("audio/")
  ) {
    return Response.json({ error: "Invalid recording" }, { status: 400 });
  }

  const geminiKeys = getGeminiKeys();
  const gatewayKey = process.env["LOVABLE_API_KEY"];
  if (geminiKeys.length === 0 && !gatewayKey) {
    return Response.json({ error: "Voice is not configured" }, { status: 500 });
  }

  try {
    const text =
      (geminiKeys.length > 0 ? await transcribeWithGemini(file, request.signal) : null) ??
      (gatewayKey ? await transcribeWithGateway(file, request.signal) : null);
    if (text === null) {
      return Response.json({ error: "Couldn't understand that recording." }, { status: 502 });
    }
    return text
      ? Response.json({ text })
      : Response.json({ error: "I couldn't hear anything — try again." }, { status: 422 });
  } catch (error) {
    console.error(
      "[fisco/transcribe] Transcription request failed.",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json({ error: "Couldn't understand that recording." }, { status: 502 });
  }
}
