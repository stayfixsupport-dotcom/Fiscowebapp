import { supabase } from "@/integrations/supabase/client";

async function documentRequest(documentId: string, method: "GET" | "DELETE", download = false) {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error("Sign in again to access this document.");

  const query = method === "GET" && download ? "?download=1" : "";
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Fisco could not complete this document request.");
  }

  return response;
}

export async function fetchDocumentBlob(documentId: string, download = false) {
  const response = await documentRequest(documentId, "GET", download);
  return response.blob();
}

export async function deleteDocumentFromDriveAndVault(documentId: string) {
  await documentRequest(documentId, "DELETE");
}
