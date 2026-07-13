const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const ORIGINAL_ENV = { ...process.env };
const ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_REGION",
  "AWS_S3_BUCKET",
  "AWS_S3_BUCKET_NAME",
  "AWS_S3_ENDPOINT",
  "AWS_S3_FORCE_PATH_STYLE",
  "AWS_S3_PREFIX",
  "AWS_S3_PUBLIC_BASE_URL",
  "AWS_S3_SIGNED_URL_EXPIRES_IN_SECONDS",
  "AWS_SECRET_ACCESS_KEY",
];

const resetEnv = () => {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
};

const loadMediaStorage = (overrides = {}) => {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });

  Object.assign(process.env, overrides);

  delete require.cache[require.resolve("../src/config/env")];
  delete require.cache[require.resolve("../src/utils/media-storage")];

  return require("../src/utils/media-storage");
};

afterEach(() => {
  resetEnv();
});

const baseS3Env = {
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
  AWS_REGION: "eu-north-1",
  AWS_S3_BUCKET: "yardhero-test-bucket",
  AWS_S3_ENDPOINT: "https://s3.eu-north-1.amazonaws.com",
  AWS_S3_PREFIX: "proof-media",
  AWS_S3_SIGNED_URL_EXPIRES_IN_SECONDS: "60",
};

test("extracts legacy global S3 URLs and signs them through the configured regional endpoint", async () => {
  const mediaStorage = loadMediaStorage({
    ...baseS3Env,
  });

  const legacyUrl =
    "https://yardhero-test-bucket.s3.amazonaws.com/proof-media/verification-photos/photo.jpg";

  assert.equal(
    mediaStorage.extractS3KeyFromUrl(legacyUrl),
    "proof-media/verification-photos/photo.jpg"
  );

  const signedUrl = await mediaStorage.normalizeMediaUrl(legacyUrl);
  const parsedUrl = new URL(signedUrl);

  assert.equal(parsedUrl.host, "yardhero-test-bucket.s3.eu-north-1.amazonaws.com");
  assert.equal(parsedUrl.pathname, "/proof-media/verification-photos/photo.jpg");
  assert.equal(parsedUrl.searchParams.get("X-Amz-Expires"), "60");
});

test("builds path-style media URLs when path-style S3 is configured", () => {
  const mediaStorage = loadMediaStorage({
    ...baseS3Env,
    AWS_S3_FORCE_PATH_STYLE: "true",
  });

  assert.equal(
    mediaStorage.buildS3ObjectUrl("proof-media/verification-videos/video.mp4"),
    "https://s3.eu-north-1.amazonaws.com/yardhero-test-bucket/proof-media/verification-videos/video.mp4"
  );
  assert.equal(
    mediaStorage.extractS3KeyFromUrl(
      "https://s3.eu-north-1.amazonaws.com/yardhero-test-bucket/proof-media/verification-videos/video.mp4"
    ),
    "proof-media/verification-videos/video.mp4"
  );
});

test("signs path-style S3 URLs when path-style S3 is configured", async () => {
  const mediaStorage = loadMediaStorage({
    ...baseS3Env,
    AWS_S3_FORCE_PATH_STYLE: "true",
  });

  const signedUrl = await mediaStorage.normalizeMediaUrl(
    "proof-media/verification-videos/video with spaces.mp4"
  );
  const parsedUrl = new URL(signedUrl);

  assert.equal(parsedUrl.host, "s3.eu-north-1.amazonaws.com");
  assert.equal(
    parsedUrl.pathname,
    "/yardhero-test-bucket/proof-media/verification-videos/video%20with%20spaces.mp4"
  );
  assert.equal(parsedUrl.searchParams.get("X-Amz-Expires"), "60");
});

test("leaves local uploads, data URLs, and arbitrary external URLs unchanged", async () => {
  const mediaStorage = loadMediaStorage({
    ...baseS3Env,
  });

  assert.equal(await mediaStorage.normalizeMediaUrl("/uploads/proof/photo.jpg"), "/uploads/proof/photo.jpg");
  assert.equal(await mediaStorage.normalizeMediaUrl("data:image/png;base64,abc"), "data:image/png;base64,abc");
  assert.equal(
    await mediaStorage.normalizeMediaUrl("https://example.com/proof-media/verification-photos/photo.jpg"),
    "https://example.com/proof-media/verification-photos/photo.jpg"
  );
});

test("extracts configured raw object keys without double encoding special characters", async () => {
  const mediaStorage = loadMediaStorage({
    ...baseS3Env,
  });

  const rawKey = "proof-media/verification-photos/booking 1/photo #1.png";

  assert.equal(mediaStorage.extractS3KeyFromUrl(rawKey), rawKey);

  const signedUrl = await mediaStorage.normalizeMediaUrl(rawKey);
  const parsedUrl = new URL(signedUrl);

  assert.equal(parsedUrl.pathname, "/proof-media/verification-photos/booking%201/photo%20%231.png");
});
