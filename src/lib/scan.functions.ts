import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z
  .object({
    /** data URL: data:<mime>;base64,<...> */
    dataUrl: z.string().min(32).optional(),
    /** plain text extracted client-side (docx, txt) */
    text: z.string().min(1).optional(),
    filename: z.string().optional(),
    locale: z.enum(["en", "fr", "ar"]).optional(),
  })
  .refine((v) => !!v.dataUrl || !!v.text, "Nothing to read");

export type ExtractedDoc = {
  merchant: string;
  amount: number;
  currency: string;
  date: string;
  category: string;
  taxId: string | null;
  vat: number | null;
  invoiceNumber: string | null;
  pages: number;
  lineItems: { label: string; amount: number }[];
  summary: string;
  confidence: number;
  raw: string;
};

const SYSTEM = `You are a precision fiscal OCR engine for an international accounting app (FISCO).
Analyze the attached invoice / receipt / fiscal document and extract ALL visible fields.
The document may be in any language (French, Polish, Arabic, English, German, etc.).
NEVER invent data: if a field is absent, use null or empty array.
Respond with STRICT JSON only — no markdown, no prose — exactly matching this schema:
{
  "merchant": string,
  "amount": number,            // grand total, numeric only
  "currency": string,          // e.g. "PLN", "EUR", "USD", "DZD", "GBP"
  "date": string,              // as printed, e.g. "26 Mar 2026" or "26/03/2026"
  "category": string,          // one of: Invoice, Receipt, Payroll, Tax form, Contract, Utilities, Transport, Supplies, Services, Other
  "taxId": string|null,        // NIF / NIP / VAT / tax number if printed, otherwise null
  "vat": number|null,          // tax amount if printed, otherwise null
  "invoiceNumber": string|null,
  "pages": number,
  "lineItems": [{"label": string, "amount": number}],
  "summary": string,           // one sentence describing what this document is
  "confidence": number,        // 0-1, how confident you are
  "raw": string                // the main readable text, max 900 chars
}`;

function pickKeys(name: "GEMINI" | "GROQ" | "OPENROUTER"): string[] {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const keys: string[] = [];
  const addKey = (v: string | undefined) => {
    if (v && typeof v === "string" && v.trim().length > 10) {
      const trimmed = v.trim();
      if (!keys.includes(trimmed)) keys.push(trimmed);
    }
  };
  addKey(metaEnv[`VITE_${name}_API_KEY`]);
  addKey(metaEnv[`${name}_API_KEY`]);
  addKey(process.env[`VITE_${name}_API_KEY`]);
  addKey(process.env[`${name}_API_KEY`]);
  for (let index = 1; index <= 12; index++) {
    addKey(metaEnv[`VITE_${name}_API_KEY_${index}`]);
    addKey(process.env[`VITE_${name}_API_KEY_${index}`]);
    addKey(process.env[`${name}_API_KEY_${index}`]);
  }
  return keys;
}

function parseExtractedDoc(text: string): ExtractedDoc {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Could not parse AI response as JSON.");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<ExtractedDoc>;
  return {
    merchant: parsed.merchant?.toString().trim() || "Unknown merchant",
    amount: Number(parsed.amount) || 0,
    currency: parsed.currency?.toString() || "EUR",
    date: parsed.date?.toString() || "—",
    category: parsed.category?.toString() || "Other",
    taxId: parsed.taxId ?? null,
    vat: parsed.vat == null ? null : Number(parsed.vat),
    invoiceNumber: parsed.invoiceNumber ?? null,
    pages: Number(parsed.pages) || 1,
    lineItems: Array.isArray(parsed.lineItems)
      ? parsed.lineItems.slice(0, 8).map((line) => ({
          label: String(line?.label ?? ""),
          amount: Number(line?.amount) || 0,
        }))
      : [],
    summary: parsed.summary?.toString() || "",
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
    raw: (parsed.raw?.toString() ?? "").slice(0, 900),
  };
}

type ProviderPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

async function extractWithCompatibleProvider(
  endpoint: string,
  keys: string[],
  models: string[],
  systemPrompt: string,
  filename: string,
  content: string | ProviderPart[],
  provider: "Groq" | "OpenRouter",
): Promise<ExtractedDoc | null> {
  for (const key of keys) {
    for (const model of models) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            ...(provider === "OpenRouter"
              ? {
                  "HTTP-Referer": process.env["APP_URL"] ?? "https://fisco.app",
                  "X-Title": "Fisco",
                }
              : {}),
          },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content },
            ],
            temperature: 0.1,
            max_tokens: 2048,
            ...(provider === "OpenRouter" ? { response_format: { type: "json_object" } } : {}),
          }),
        });
        if (!response.ok) {
          console.warn(`[FISCO Scan] ${provider} ${model} returned HTTP ${response.status}.`);
          continue;
        }
        const result = (await response.json()) as {
          choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
        };
        const responseContent = result.choices?.[0]?.message?.content;
        const text =
          typeof responseContent === "string"
            ? responseContent
            : (responseContent?.map((part) => part.text ?? "").join("\n") ?? "");
        return parseExtractedDoc(text);
      } catch (error) {
        console.warn(
          `[FISCO Scan] ${provider} ${model} failed for ${filename}:`,
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
  }
  return null;
}

async function readDocumentWithProviders(data: z.infer<typeof Input>): Promise<ExtractedDoc> {
  const responseLanguage =
    data.locale === "ar" ? "Arabic" : data.locale === "fr" ? "French" : "English";
  const systemPrompt = `${SYSTEM}\n\nWrite the summary field in ${responseLanguage}. Keep extracted document fields and line-item labels in the document's original language.`;
  const geminiKeys = pickKeys("GEMINI");

  const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
  const documentPrompt = data.text
    ? `Document text:\n---\n${data.text.slice(0, 20000)}\n---\nReturn the JSON now.`
    : "Analyze the attached document and return the JSON now.";

  const parts: object[] = [];
  parts.push({ text: `${systemPrompt}\n\n${documentPrompt}` });

  const mime = data.dataUrl?.slice(5, data.dataUrl.indexOf(";")) ?? "";
  if (data.dataUrl) {
    const base64Data = data.dataUrl.split(",")[1] ?? "";

    if (mime === "application/pdf") {
      // Gemini supports inline PDF via File API workaround — use text fallback if needed
      parts.push({
        inlineData: {
          mimeType: "application/pdf",
          data: base64Data,
        },
      });
    } else {
      parts.push({
        inlineData: {
          mimeType: mime || "image/jpeg",
          data: base64Data,
        },
      });
    }
  }

  let lastError: Error | null = null;
  for (const key of geminiKeys) {
    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.1,
              topP: 0.95,
              maxOutputTokens: 2048,
              responseMimeType: "application/json",
            },
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 300)}`);
        }
        const json = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        return parseExtractedDoc(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[FISCO Scan] Gemini ${model} failed:`, lastError.message);
      }
    }
  }

  const compatibleContent: string | ProviderPart[] = data.dataUrl
    ? [
        { type: "text", text: documentPrompt },
        mime === "application/pdf"
          ? {
              type: "file",
              file: { filename: data.filename || "document.pdf", file_data: data.dataUrl },
            }
          : { type: "image_url", image_url: { url: data.dataUrl } },
      ]
    : documentPrompt;
  const groqModels =
    data.dataUrl && mime !== "application/pdf"
      ? ["meta-llama/llama-4-scout-17b-16e-instruct"]
      : data.dataUrl
        ? []
        : ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];
  const groqResult = await extractWithCompatibleProvider(
    "https://api.groq.com/openai/v1/chat/completions",
    pickKeys("GROQ"),
    groqModels,
    systemPrompt,
    data.filename ?? "document",
    compatibleContent,
    "Groq",
  );
  if (groqResult) return groqResult;

  const openRouterResult = await extractWithCompatibleProvider(
    "https://openrouter.ai/api/v1/chat/completions",
    pickKeys("OPENROUTER"),
    ["google/gemini-2.5-flash", "openai/gpt-4o-mini"],
    systemPrompt,
    data.filename ?? "document",
    compatibleContent,
    "OpenRouter",
  );
  if (openRouterResult) return openRouterResult;
  throw lastError ?? new Error("Gemini, Groq, and OpenRouter could not process this document.");
}

export const readDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(({ data }) => readDocumentWithProviders(data));

export function readDocumentForMobile(input: unknown): Promise<ExtractedDoc> {
  return readDocumentWithProviders(Input.parse(input));
}
