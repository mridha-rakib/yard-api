const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const AppError = require("../errors/AppError");
const { parseDataUrl } = require("./data-url");

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

const MIME_EXTENSION_MAP = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
};

const getFileExtension = (mimeType = "", fallback = ".bin") =>
  MIME_EXTENSION_MAP[String(mimeType || "").toLowerCase()] || fallback;

const ensureUploadsDirectory = async (directoryName) => {
  const targetDirectory = path.join(UPLOADS_ROOT, directoryName);
  await fs.mkdir(targetDirectory, { recursive: true });
  return targetDirectory;
};

const persistDataUrlToLocalUpload = async (
  dataUrl,
  { directoryName = "general", filePrefix = "upload", requiredMimePrefix = "" } = {}
) => {
  const parsed = parseDataUrl(dataUrl);

  if (!parsed) {
    throw new AppError("The uploaded file format is invalid", 400);
  }

  if (requiredMimePrefix && !parsed.mimeType.startsWith(requiredMimePrefix)) {
    throw new AppError("The uploaded file type is not supported", 400);
  }

  const uploadsDirectory = await ensureUploadsDirectory(directoryName);
  const extension = getFileExtension(parsed.mimeType);
  const fileName = `${filePrefix}-${Date.now()}-${crypto.randomUUID()}${extension}`;
  const absoluteFilePath = path.join(uploadsDirectory, fileName);
  const relativeUrl = `/uploads/${directoryName}/${fileName}`;
  const fileBuffer = parsed.isBase64
    ? Buffer.from(parsed.data, "base64")
    : Buffer.from(parsed.data, "utf8");

  await fs.writeFile(absoluteFilePath, fileBuffer);

  return relativeUrl;
};

const isLocalUploadPath = (value = "", directoryName = "") => {
  const normalizedValue = String(value || "").trim();
  const expectedPrefix = directoryName ? `/uploads/${directoryName}/` : "/uploads/";

  return normalizedValue.startsWith(expectedPrefix);
};

const deleteLocalUploadByUrl = async (value = "") => {
  const normalizedValue = String(value || "").trim();

  if (!isLocalUploadPath(normalizedValue)) {
    return;
  }

  const relativePath = normalizedValue.replace(/^\/uploads\//, "");
  const absolutePath = path.join(UPLOADS_ROOT, relativePath);

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
};

module.exports = {
  UPLOADS_ROOT,
  deleteLocalUploadByUrl,
  isLocalUploadPath,
  persistDataUrlToLocalUpload,
};
