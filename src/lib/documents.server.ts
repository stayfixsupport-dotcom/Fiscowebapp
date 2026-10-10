import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AuthenticatedRequest = {
  client: SupabaseClient<Database>;
  userId: string;
};

type DocumentRecord = {
  owner_id: string;
  drive_file_id: string | null;
  mime_type: string | null;
  name: string | null;
};

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function driveScriptUrl() {
  return (
    process.env["DRIVE_SCRIPT_URL"] ||
    process.env["VITE_DRIVE_UPLOAD_URL"] ||
    env["VITE_DRIVE_UPLOAD_URL"] ||
    null
  );
}

async function authenticate(request: Request): Promise<AuthenticatedRequest | Response> {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return Response.json({ error: "Sign in to access this document." }, { status: 401 });

  const url = process.env["SUPABASE_URL"] || env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    return Response.json({ error: "Document access is not configured." }, { status: 503 });
  }

  const client = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") {
    return Response.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  }

  return { client, userId };
}

async function findDocument(client: SupabaseClient<Database>, id: string) {
  const { data, error } = await client
    .from("documents" as never)
    .select("owner_id,drive_file_id,mime_type,name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as DocumentRecord;
}

export async function serveDocumentFile(request: Request, documentId: string) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const record = await findDocument(auth.client, documentId);
  if (!record) return Response.json({ error: "Document not found." }, { status: 404 });
  if (!record.drive_file_id) {
    return Response.json({ error: "This document has no stored Drive file." }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(record.drive_file_id)}`,
      { signal: request.signal, redirect: "follow" },
    );
  } catch {
    return Response.json({ error: "Fisco could not reach the stored document." }, { status: 502 });
  }

  if (!upstream.ok) {
    return Response.json(
      { error: "Google Drive could not return this document." },
      { status: 502 },
    );
  }

  const contentType =
    record.mime_type || upstream.headers.get("content-type") || "application/octet-stream";
  if (contentType.toLowerCase().includes("text/html")) {
    return Response.json(
      { error: "Google Drive returned a viewer page instead of the file." },
      { status: 502 },
    );
  }

  const name = (record.name || "document").replace(/[\r\n"\\]/g, "_");
  const disposition = new URL(request.url).searchParams.has("download") ? "attachment" : "inline";
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function deleteDocument(request: Request, documentId: string) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const record = await findDocument(auth.client, documentId);
  if (!record) return Response.json({ error: "Document not found." }, { status: 404 });
  if (record.owner_id !== auth.userId) {
    return Response.json(
      { error: "Only the document owner can delete this file." },
      { status: 403 },
    );
  }

  if (record.drive_file_id) {
    const scriptUrl = driveScriptUrl();
    const deleteSecret = process.env["DRIVE_DELETE_SECRET"];
    if (!scriptUrl) {
      return Response.json(
        { error: "Drive deletion is not configured. Set the server-side Drive script URL." },
        { status: 503 },
      );
    }
    if (!deleteSecret) {
      return Response.json(
        {
          error:
            "Drive deletion secret is missing. Set DRIVE_DELETE_SECRET in the server environment and Apps Script Script Properties.",
        },
        { status: 503 },
      );
    }

    let driveResult: { success?: boolean; error?: string } | null = null;
    try {
      const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "delete",
          fileId: record.drive_file_id,
          deleteToken: deleteSecret,
        }),
        signal: request.signal,
      });
      driveResult = (await response.json()) as { success?: boolean; error?: string };
    } catch {
      return Response.json(
        { error: "Fisco could not contact the Drive deletion script." },
        { status: 502 },
      );
    }

    if (!driveResult?.success) {
      return Response.json(
        { error: driveResult?.error || "Google Drive could not trash this file." },
        { status: 502 },
      );
    }
  }

  const { data, error } = await auth.client
    .from("documents" as never)
    .delete()
    .eq("id", documentId)
    .eq("owner_id", auth.userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return Response.json(
      {
        error:
          "The Drive file was trashed, but its Fisco record could not be removed. Retry deletion.",
      },
      { status: 500 },
    );
  }

  return Response.json({ success: true });
}
