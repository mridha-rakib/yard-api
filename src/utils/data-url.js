const AppError = require("../errors/AppError");

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i;

const parseDataUrl = (value = "") => {
  const match = String(value || "").trim().match(DATA_URL_PATTERN);

  if (!match) {
    return null;
  }

  return {
    mimeType: String(match[1] || "").toLowerCase(),
    isBase64: Boolean(match[2]),
    data: match[3] || "",
  };
};

const estimateDecodedBytes = (value = "") => {
  const parsed = parseDataUrl(value);

  if (!parsed) {
    return 0;
  }

  if (!parsed.isBase64) {
    return Buffer.byteLength(parsed.data, "utf8");
  }

  const normalizedData = parsed.data.replace(/\s/g, "");
  const padding = normalizedData.endsWith("==") ? 2 : normalizedData.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((normalizedData.length * 3) / 4) - padding);
};

const assertDataUrlMimeType = (value, prefix, errorMessage) => {
  const parsed = parseDataUrl(value);

  if (!parsed || !parsed.mimeType || !parsed.mimeType.startsWith(prefix)) {
    throw new AppError(errorMessage, 400);
  }
};

const assertDataUrlMaxBytes = (value, maxBytes, errorMessage) => {
  const sizeInBytes = estimateDecodedBytes(value);

  if (!sizeInBytes || sizeInBytes > maxBytes) {
    throw new AppError(errorMessage, 400);
  }
};

module.exports = {
  assertDataUrlMaxBytes,
  assertDataUrlMimeType,
  estimateDecodedBytes,
  parseDataUrl,
};
