const crypto = require("crypto");
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
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

const MANAGED_S3_DIRECTORIES = new Set([
  "job-photos",
  "storage-smoke-tests",
  "verification-photos",
  "verification-videos",
]);

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

const trimTrailingSlash = (value = "") => String(value || "").trim().replace(/\/+$/g, "");

const safeDecodeURIComponent = (value = "") => {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};

const getS3EndpointBaseUrl = () => trimTrailingSlash(env.awsS3Endpoint);

const getS3EndpointUrl = () => {
  const endpointBaseUrl = getS3EndpointBaseUrl();

  if (!endpointBaseUrl) {
    return null;
  }

  try {
    return new URL(endpointBaseUrl);
  } catch (error) {
    logger.warn({ endpoint: endpointBaseUrl }, "Ignoring invalid S3 endpoint URL");
    return null;
  }
};

const buildVirtualHostedBaseUrl = (baseUrl, bucketName) => {
  if (!baseUrl || !bucketName) {
    return "";
  }

  const parsedEndpoint = getS3EndpointUrl();

  if (!parsedEndpoint) {
    return "";
  }

  if (parsedEndpoint.hostname.startsWith(`${bucketName}.`)) {
    return trimTrailingSlash(baseUrl);
  }

  return `${parsedEndpoint.protocol}//${bucketName}.${parsedEndpoint.host}${parsedEndpoint.pathname.replace(/\/+$/g, "")}`;
};

const getS3PublicBaseUrl = () => {
  if (env.awsS3PublicBaseUrl) {
    return trimTrailingSlash(env.awsS3PublicBaseUrl);
  }

  const endpointBaseUrl = getS3EndpointBaseUrl();
  if (endpointBaseUrl && env.awsS3Bucket) {
    if (env.awsS3ForcePathStyle) {
      return `${endpointBaseUrl}/${env.awsS3Bucket}`;
    }

    const virtualHostedBaseUrl = buildVirtualHostedBaseUrl(endpointBaseUrl, env.awsS3Bucket);
    if (virtualHostedBaseUrl) {
      return virtualHostedBaseUrl;
    }
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
    const clientConfig = {
      region: env.awsRegion,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    };

    if (env.awsS3Endpoint) {
      clientConfig.endpoint = env.awsS3Endpoint;
    }

    if (env.awsS3ForcePathStyle) {
      clientConfig.forcePathStyle = true;
    }

    s3Client = new S3Client(clientConfig);
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

const extractKeyFromPathStylePath = (pathname = "", bucketName = "") => {
  const normalizedPathname = safeDecodeURIComponent(String(pathname || "").replace(/^\/+/, ""));
  const [firstSegment, ...remainingSegments] = normalizedPathname.split("/");

  if (bucketName && firstSegment === bucketName && remainingSegments.length) {
    return remainingSegments.join("/");
  }

  return "";
};

const isLikelyRawS3ObjectKey = (value = "", directoryName = "") => {
  const normalizedValue = safeDecodeURIComponent(String(value || "").trim().replace(/^\/+/, ""));

  if (
    !normalizedValue ||
    normalizedValue.startsWith("data:") ||
    normalizedValue.startsWith("blob:") ||
    normalizedValue.startsWith("http://") ||
    normalizedValue.startsWith("https://") ||
    normalizedValue.startsWith("uploads/") ||
    normalizedValue.includes("..") ||
    /[\r\n]/.test(normalizedValue)
  ) {
    return "";
  }

  const prefix = normalizeS3Prefix(env.awsS3Prefix);
  const keySegments = normalizedValue.split("/").filter(Boolean);

  if (prefix && !normalizedValue.startsWith(`${prefix}/`)) {
    return "";
  }

  if (!prefix && !keySegments.some((segment) => MANAGED_S3_DIRECTORIES.has(segment))) {
    return "";
  }

  const normalizedDirectoryName = normalizePathSegment(directoryName, "");
  if (normalizedDirectoryName && !keySegments.includes(normalizedDirectoryName)) {
    return "";
  }

  return normalizedValue;
};

const extractS3KeyFromUrl = (value = "") => {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue || normalizedValue.startsWith("data:")) {
    return "";
  }

  const rawObjectKey = isLikelyRawS3ObjectKey(normalizedValue);
  if (rawObjectKey) {
    return rawObjectKey;
  }

  const configuredBaseUrl = getS3PublicBaseUrl();
  if (configuredBaseUrl && normalizedValue.startsWith(`${configuredBaseUrl}/`)) {
    return safeDecodeURIComponent(normalizedValue.slice(configuredBaseUrl.length + 1));
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    const normalizedPathname = safeDecodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));

    if (!normalizedPathname) {
      return "";
    }

    const endpointUrl = getS3EndpointUrl();

    if (env.awsS3Bucket && endpointUrl) {
      const endpointPathKey = extractKeyFromPathStylePath(parsedUrl.pathname, env.awsS3Bucket);
      if (
        parsedUrl.hostname === endpointUrl.hostname &&
        endpointPathKey
      ) {
        return endpointPathKey;
      }

      if (parsedUrl.hostname === `${env.awsS3Bucket}.${endpointUrl.host}`) {
        return normalizedPathname;
      }
    }

    if (env.awsS3Bucket && parsedUrl.hostname === `${env.awsS3Bucket}.s3.amazonaws.com`) {
      return normalizedPathname;
    }

    if (
      env.awsS3Bucket &&
      parsedUrl.hostname.startsWith(`${env.awsS3Bucket}.s3.`) &&
      parsedUrl.hostname.endsWith(".amazonaws.com")
    ) {
      return normalizedPathname;
    }

    if (
      env.awsS3Bucket &&
      (parsedUrl.hostname === "s3.amazonaws.com" ||
        (parsedUrl.hostname.startsWith("s3.") && parsedUrl.hostname.endsWith(".amazonaws.com")))
    ) {
      return extractKeyFromPathStylePath(parsedUrl.pathname, env.awsS3Bucket);
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

const getSignedMediaUrl = async (objectKey = "") => {
  if (!objectKey || !isS3Configured()) {
    return "";
  }

  try {
    return await getSignedUrl(
      getS3Client(),
      new GetObjectCommand({
        Bucket: env.awsS3Bucket,
        Key: objectKey,
      }),
      {
        expiresIn: env.awsS3SignedUrlExpiresInSeconds,
      }
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        configuredRegion: env.awsRegion,
        bucketRegion:
          error?.$metadata?.httpHeaders?.["x-amz-bucket-region"] ||
          error?.Region ||
          "",
      },
      "Failed to generate signed media URL"
    );
    throw new AppError(
      "Proof media is temporarily unavailable. Please refresh or contact support.",
      502
    );
  }
};

const normalizeMediaUrl = async (value = "") => {
  const normalizedValue = String(value || "").trim();
  const objectKey = extractS3KeyFromUrl(normalizedValue);

  if (objectKey) {
    return getSignedMediaUrl(objectKey);
  }

  return normalizedValue;
};

const normalizeMediaUrls = async (values = []) =>
  Array.isArray(values)
    ? (await Promise.all(values.map(normalizeMediaUrl))).filter(Boolean)
    : [];

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

  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.awsS3Bucket,
        Key: objectKey,
        Body: objectBody,
        CacheControl: "public, max-age=31536000, immutable",
        ContentType: parsed.mimeType,
      })
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        configuredRegion: env.awsRegion,
        bucketRegion:
          error?.$metadata?.httpHeaders?.["x-amz-bucket-region"] ||
          error?.Region ||
          "",
      },
      "Failed to upload media object to S3"
    );
    throw new AppError(
      "Proof upload storage is temporarily unavailable. Please try again or contact support.",
      502
    );
  }

  return objectKey;
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
  extractS3KeyFromUrl,
  buildS3ObjectUrl,
  getSignedMediaUrl,
  isManagedMediaUrl,
  isS3Configured,
  normalizeMediaUrl,
  normalizeMediaUrls,
  persistDataUrlToMediaStorage,
};
