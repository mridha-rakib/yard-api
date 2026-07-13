const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const ORIGINAL_ENV = { ...process.env };
const ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_REGION",
  "AWS_S3_BUCKET",
  "AWS_S3_ENDPOINT",
  "AWS_S3_PREFIX",
  "AWS_S3_SIGNED_URL_EXPIRES_IN_SECONDS",
  "AWS_SECRET_ACCESS_KEY",
];

const clearModules = () => {
  [
    "../src/config/env",
    "../src/utils/media-storage",
    "../src/modules/bookings/booking.service",
    "../src/modules/jobs/job.service",
  ].forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });
};

const configureS3Env = () => {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });

  Object.assign(process.env, {
    AWS_ACCESS_KEY_ID: "test-access-key",
    AWS_SECRET_ACCESS_KEY: "test-secret-key",
    AWS_REGION: "eu-north-1",
    AWS_S3_BUCKET: "yardhero-test-bucket",
    AWS_S3_ENDPOINT: "https://s3.eu-north-1.amazonaws.com",
    AWS_S3_PREFIX: "proof-media",
    AWS_S3_SIGNED_URL_EXPIRES_IN_SECONDS: "120",
  });
};

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
  clearModules();
});

test("booking proof response normalization returns signed strings, not promises", async () => {
  configureS3Env();
  clearModules();
  const bookingService = require("../src/modules/bookings/booking.service");

  const normalized = await bookingService.normalizeProofMedia({
    _id: "booking-1",
    verificationPhotoUrls: [
      "proof-media/verification-photos/proof one.png",
      "/uploads/verification-photos/local.jpg",
    ],
    verificationVideoUrl: "proof-media/verification-videos/proof video.mp4",
  });

  assert.equal(normalized.verificationPhotoUrls.length, 2);
  assert.equal(typeof normalized.verificationPhotoUrls[0], "string");
  assert.equal(typeof normalized.verificationVideoUrl, "string");
  assert.equal(normalized.verificationPhotoUrls[1], "/uploads/verification-photos/local.jpg");
  assert.match(normalized.verificationPhotoUrls[0], /^https:\/\/yardhero-test-bucket\.s3\.eu-north-1\.amazonaws\.com\//);
  assert.match(normalized.verificationVideoUrl, /X-Amz-Expires=120/);
  assert.equal(typeof normalized.verificationPhotoUrls[0]?.then, "undefined");
});

test("job response normalization signs S3 media and preserves unrelated URLs", async () => {
  configureS3Env();
  clearModules();
  const jobService = require("../src/modules/jobs/job.service");

  const normalized = await jobService.normalizeJobMedia({
    _id: "job-1",
    photos: [
      "proof-media/job-photos/front yard.png",
      "https://example.com/not-our-bucket.jpg",
    ],
    booking: {
      verificationPhotoUrls: ["proof-media/verification-photos/proof.jpg"],
      verificationVideoUrl: "/uploads/verification-videos/local.mp4",
    },
  });

  assert.match(normalized.photos[0], /^https:\/\/yardhero-test-bucket\.s3\.eu-north-1\.amazonaws\.com\//);
  assert.equal(normalized.photos[1], "https://example.com/not-our-bucket.jpg");
  assert.match(normalized.booking.verificationPhotoUrls[0], /X-Amz-Signature=/);
  assert.equal(normalized.booking.verificationVideoUrl, "/uploads/verification-videos/local.mp4");
  assert.equal(typeof normalized.photos[0]?.then, "undefined");
});
