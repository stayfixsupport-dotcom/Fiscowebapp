const FOLDER_NAME = "FISCO_Vault_Documents";
const MESSAGE_FOLDER_NAME = "FISCO_Message_Attachments";
const DELETE_SECRET_PROPERTY = "DRIVE_DELETE_SECRET";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No request body provided");
    }

    const request = JSON.parse(e.postData.contents);
    if (request.action === "delete") {
      return deleteDriveFile(request);
    }

    const rawBase64 = request.base64Data || request.fileData;
    if (typeof rawBase64 !== "string" || !rawBase64) {
      throw new Error("No file data provided");
    }

    const fileName = String(request.fileName || ("document_" + Date.now() + ".pdf"))
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 180);
    const mimeType = String(request.mimeType || getMimeType(fileName));
    const cleanBase64 = rawBase64.replace(/^data:[^,]*;base64,/i, "").replace(/\s/g, "");
    const bytes = Utilities.base64Decode(cleanBase64);
    if (!bytes.length) throw new Error("The uploaded file is empty");

    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const requestedFolder = String(request.folderName || FOLDER_NAME);
    const folderName = requestedFolder === MESSAGE_FOLDER_NAME ? MESSAGE_FOLDER_NAME : FOLDER_NAME;
    const folder = getOrCreateFolder(folderName);
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      file.setTrashed(true);
      throw new Error(
        "Drive created the file but link sharing is blocked. Allow Anyone with the link in Google Drive sharing settings. " +
          (sharingError && sharingError.message ? sharingError.message : String(sharingError))
      );
    }

    const fileId = file.getId();
    const downloadUrl =
      "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId);

    return responseJSON({
      success: true,
      fileId: fileId,
      fileName: fileName,
      folderName: folderName,
      driveViewUrl: file.getUrl(),
      previewUrl: "https://drive.google.com/file/d/" + fileId + "/preview",
      thumbnailUrl: "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w1200",
      downloadUrl: downloadUrl,
      embedUrl:
        "https://docs.google.com/gview?embedded=true&url=" + encodeURIComponent(downloadUrl),
      size: file.getSize(),
      created: file.getDateCreated().toISOString()
    });
  } catch (error) {
    return responseJSON({
      success: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

function deleteDriveFile(request) {
  const expected = PropertiesService.getScriptProperties().getProperty(DELETE_SECRET_PROPERTY);
  const supplied = String(request.deleteToken || "");
  if (!expected || supplied !== expected) {
    return responseJSON({ success: false, error: "Unauthorized delete request" });
  }

  const fileId = String(request.fileId || "").trim();
  if (!fileId) {
    return responseJSON({ success: false, error: "No Drive file ID provided" });
  }

  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    return responseJSON({ success: true, fileId: fileId, trashed: true });
  } catch (error) {
    return responseJSON({
      success: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

function doGet() {
  return responseJSON({
    status: "active",
    message: "FISCO Google Drive uploader is online",
    folderName: FOLDER_NAME
  });
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function getMimeType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify({ scriptVersion: "2.0.0", ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}