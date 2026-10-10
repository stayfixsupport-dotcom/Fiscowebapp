import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { uploadToGoogleDrive } from "./drive";
import { readDocumentForMobile, type ExtractedDoc } from "./scan.functions";

const Input = z.object({
  dataUrl: z.string().max(11_500_000),
  filename: z.string().trim().min(1).max(180),
  role: z.enum(["taxpayer", "accountant"]),
  locale: z.enum(["en", "fr", "ar"]).optional(),
});

const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const viteEnv =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function documentData(extracted: ExtractedDoc) {
  return {
    merchant: extracted.merchant,
    amount: extracted.amount,
    currency: extracted.currency,
    category: extracted.category,
    date: extracted.date,
    pages: extracted.pages,
    taxId: extracted.taxId,
    vat: extracted.vat,
    invoiceNumber: extracted.invoiceNumber,
    lineItems: extracted.lineItems,
    summary: extracted.summary,
    confidence: extracted.confidence,
    raw: extracted.raw,
  };
}

export async function scanAndSaveMobileDocument(request: Request): Promise<Response> {
  const accessToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!accessToken) return errorResponse("Sign in before scanning a document.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid scan request.", 400);
  }
  const input = Input.safeParse(body);
  if (!input.success) return errorResponse("Choose a valid document image or PDF.", 400);

  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input.data.dataUrl);
  if (!match?.[1] || !match[2] || !mimeTypes.has(match[1])) {
    return errorResponse("Attach a JPEG, PNG, WebP image, or PDF.", 400);
  }
  if (Math.floor((match[2].length * 3) / 4) > 8 * 1024 * 1024) {
    return errorResponse("Documents must be 8 MB or smaller.", 413);
  }

  const url = process.env["SUPABASE_URL"] ?? viteEnv["VITE_SUPABASE_URL"];
  const publishableKey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? viteEnv["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !publishableKey) {
    return errorResponse("Document scanning is not configured on this server.", 503);
  }

  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claimsData, error: claimsError } = await client.auth.getClaims(accessToken);
  const ownerId = claimsData?.claims?.sub;
  if (claimsError || typeof ownerId !== "string") {
    return errorResponse("Your session expired. Sign in again.", 401);
  }

  const { data: role, error: roleError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", ownerId)
    .eq("role", input.data.role)
    .maybeSingle();
  if (roleError || !role) {
    return errorResponse("Select a Fisco account role before scanning.", 403);
  }

  let extracted: ExtractedDoc;
  try {
    extracted = await readDocumentForMobile({
      dataUrl: input.data.dataUrl,
      filename: input.data.filename,
      locale: input.data.locale,
    });
  } catch (error) {
    console.error("[mobile-scan] OCR failed", error);
    return errorResponse(
      error instanceof Error ? error.message : "Fisco could not read this document.",
      502,
    );
  }

  const driveUpload = await uploadToGoogleDrive(input.data.filename, input.data.dataUrl, match[1]);
  if (!driveUpload.success || !driveUpload.fileId) {
    return errorResponse("Google Drive could not store this document. Try again.", 502);
  }

  const previewUrl =
    driveUpload.previewUrl ??
    driveUpload.driveViewUrl ??
    `https://drive.google.com/file/d/${encodeURIComponent(driveUpload.fileId)}/view`;
  const embedUrl =
    driveUpload.embedUrl ??
    `https://drive.google.com/file/d/${encodeURIComponent(driveUpload.fileId)}/preview`;
  const { data: saved, error: saveError } = await client
    .from("documents")
    .insert({
      owner_id: ownerId,
      owner_role: input.data.role,
      name: extracted.merchant,
      mime_type: match[1],
      size_bytes: Math.floor((match[2].length * 3) / 4),
      drive_file_id: driveUpload.fileId,
      preview_url: previewUrl,
      embed_url: embedUrl,
      status: "ready",
      extracted_data: documentData(extracted),
    })
    .select(
      "id, name, mime_type, drive_file_id, preview_url, embed_url, status, extracted_data, created_at",
    )
    .single();
  if (saveError || !saved) {
    console.error("[mobile-scan] document save failed", saveError?.message);
    return errorResponse("The Drive file was stored, but Fisco could not save its record.", 500);
  }

  return Response.json({ document: saved, extracted });
}
