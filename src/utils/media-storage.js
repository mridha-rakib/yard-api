const crypto = require("crypto");
const { DeleteObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const env = require("../config/env");
const logger = require("../config/logger");
const AppError = require("../errors/AppError");
const { parseDataUrl } = require("./data-url");
const {
  deleteLocalUploadByUrl,
  isLocalUploadPath,
  persistDataUrlToLocalUpload,
} = require("./local-media");

const MIME_EXTENSION_MAP = {
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/ogg": ".ogv",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

const normalizePathSegment = (value = "", fallback = "upload") =>
  String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;

const normalizeS3Prefix = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");

const getFileExtension = (mimeType = "", fallback = ".bin") =>
  MIME_EXTENSION_MAP[String(mimeType || "").toLowerCase()] || fallback;

const getS3PublicBaseUrl = () => {
  if (env.awsS3PublicBaseUrl) {
    return String(env.awsS3PublicBaseUrl).trim().replace(/\/+$/g, "");
  }

  if (!env.awsS3Bucket || !env.awsRegion) {
    return "";
  }

  return `https://${env.awsS3Bucket}.s3.${env.awsRegion}.amazonaws.com`;
};

const isS3Configured = () =>
  Boolean(
    env.awsRegion &&
      env.awsAccessKeyId &&
      env.awsSecretAccessKey &&
      env.awsS3Bucket
  );

let s3Client;

const getS3Client = () => {
  if (!isS3Configured()) {
    return null;
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: env.awsRegion,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });
  }

  return s3Client;
};

const buildS3ObjectKey = ({ directoryName = "general", filePrefix = "upload", mimeType = "" } = {}) => {
  const prefix = normalizeS3Prefix(env.awsS3Prefix);
  const segments = [
    prefix,
    normalizePathSegment(directoryName, "general"),
    `${normalizePathSegment(filePrefix, "upload")}-${Date.now()}-${crypto.randomUUID()}${getFileExtension(
      mimeType
    )}`,
  ].filter(Boolean);

  return segments.join("/");
};

const buildS3ObjectUrl = (key = "") => {
  const baseUrl = getS3PublicBaseUrl();
  const normalizedKey = String(key || "").replace(/^\/+/, "");

  return baseUrl ? `${baseUrl}/${normalizedKey}` : normalizedKey;
};

const extractS3KeyFromUrl = (value = "") => {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue || normalizedValue.startsWith("data:")) {
    return "";
  }

  const configuredBaseUrl = getS3PublicBaseUrl();
  if (configuredBaseUrl && normalizedValue.startsWith(`${configuredBaseUrl}/`)) {
    return decodeURIComponent(normalizedValue.slice(configuredBaseUrl.length + 1));
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    const normalizedPathname = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));

    if (!normalizedPathname) {
      return "";
    }

    if (
      env.awsS3Bucket &&
      (parsedUrl.hostname === `${env.awsS3Bucket}.s3.amazonaws.com` ||
        parsedUrl.hostname === `${env.awsS3Bucket}.s3.${env.awsRegion}.amazonaws.com`)
    ) {
      return normalizedPathname;
    }
  } catch (error) {
    return "";
  }

  return "";
};

const isS3ObjectUrl = (value = "", directoryName = "") => {
  const objectKey = extractS3KeyFromUrl(value);
  if (!objectKey) {
    return false;
  }

  if (!directoryName) {
    return true;
  }

  const normalizedDirectoryName = normalizePathSegment(directoryName, "");
  const keySegments = objectKey.split("/");

  return keySegments.includes(normalizedDirectoryName);
};

const isManagedMediaUrl = (value = "", directoryName = "") =>
  isLocalUploadPath(value, directoryName) || isS3ObjectUrl(value, directoryName);

const persistDataUrlToMediaStorage = async (
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

  if (!isS3Configured()) {
    return persistDataUrlToLocalUpload(dataUrl, {
      directoryName,
      filePrefix,
      requiredMimePrefix,
    });
  }

  const objectKey = buildS3ObjectKey({
    directoryName,
    filePrefix,
    mimeType: parsed.mimeType,
  });
  const objectBody = parsed.isBase64
    ? Buffer.from(parsed.data, "base64")
    : Buffer.from(parsed.data, "utf8");

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.awsS3Bucket,
      Key: objectKey,
      Body: objectBody,
      CacheControl: "public, max-age=31536000, immutable",
      ContentType: parsed.mimeType,
    })
  );

  return buildS3ObjectUrl(objectKey);
};

const deleteMediaObjectByUrl = async (value = "") => {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return;
  }

  if (isLocalUploadPath(normalizedValue)) {
    await deleteLocalUploadByUrl(normalizedValue);
    return;
  }

  const objectKey = extractS3KeyFromUrl(normalizedValue);

  if (!objectKey || !isS3Configured()) {
    return;
  }

  try {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: env.awsS3Bucket,
        Key: objectKey,
      })
    );
  } catch (error) {
    logger.warn(
      {
        err: error,
        bucket: env.awsS3Bucket,
        key: objectKey,
      },
      "Failed to delete stored media object"
    );
    throw error;
  }
};

module.exports = {
  deleteMediaObjectByUrl,
  isManagedMediaUrl,
  isS3Configured,
  persistDataUrlToMediaStorage,
};
