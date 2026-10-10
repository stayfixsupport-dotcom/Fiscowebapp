/**
 * Google Drive Document Uploader & Preview Bridge for FISCO
 * Integrates with the Google Apps Script Web App provided by the user.
 */

const DRIVE_UPLOAD_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_DRIVE_UPLOAD_URL ||
  "https://script.google.com/macros/s/AKfycbwEVxRI5FiTnpU4PswDY493cOwAS4897aRm2JWvj7hhyNfZZXBvRcfl8tmCPWkVuxUK/exec";

export type DriveUploadResult = {
  success: boolean;
  fileId?: string;
  fileName?: string;
  driveViewUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  downloadUrl?: string;
  embedUrl?: string;
  size?: number;
  created?: string;
  error?: string;
};

/**
 * Upload a document to Google Drive via the user's Google Apps Script web app
 */
export async function uploadToGoogleDrive(
  fileName: string,
  base64Data: string,
  mimeType?: string,
  folderName?: string,
): Promise<DriveUploadResult> {
  try {
    const cleanBase64 = base64Data.replace(/^data:.*?;base64,/, "");
    const payload = {
      fileName,
      base64Data: cleanBase64,
      mimeType: mimeType || getMimeType(fileName),
      ...(folderName ? { folderName } : {}),
    };

    const res = await fetch(DRIVE_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Google Drive script returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        "Google Drive returned a non-JSON response. Check that the Apps Script deployment is accessible to anyone.",
      );
    }

    const data = (await res.json()) as DriveUploadResult;
    if (!data.success) {
      throw new Error(data.error || "Google Drive rejected the upload.");
    }
    if (!data.fileId) {
      throw new Error("Google Drive reported success without returning a file ID.");
    }
    return data;
  } catch (err) {
    console.error("Google Drive upload error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Helper to determine MIME type from filename
 */
function getMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
