const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const SERVICE_MODULES = [
  "../src/modules/bookings/booking.service",
  "../src/modules/bookings/booking.repository",
  "../src/modules/jobs/job.repository",
  "../src/modules/payments/payment.repository",
  "../src/modules/notifications/notification.service",
  "../src/services/email.service",
  "../src/utils/media-storage",
];

const clearModules = () => {
  SERVICE_MODULES.forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });
};

const stubModule = (modulePath, exports) => {
  const filename = require.resolve(modulePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const buildBooking = (overrides = {}) => ({
  _id: "booking-1",
  status: "in_progress",
  customer: { _id: "customer-1" },
  worker: { _id: "worker-1", name: "Hero" },
  job: { _id: "job-1", title: "Lawn Mowing" },
  verificationPhotoUrls: [],
  verificationVideoUrl: "",
  ...overrides,
});

const loadBookingService = ({ uploadImpl } = {}) => {
  clearModules();

  const updates = [];
  const jobUpdates = [];
  const uploads = [];
  const deletes = [];
  let currentBooking = buildBooking();

  stubModule("../src/modules/bookings/booking.repository", {
    findBookingWithRelations: async () => currentBooking,
    updateById: async (bookingId, update) => {
      updates.push({ bookingId, update });
      currentBooking = buildBooking({
        ...currentBooking,
        ...update,
      });
      return currentBooking;
    },
  });
  stubModule("../src/modules/jobs/job.repository", {
    updateById: async (jobId, update) => {
      jobUpdates.push({ jobId, update });
      return { _id: jobId, ...update };
    },
  });
  stubModule("../src/modules/payments/payment.repository", {});
  stubModule("../src/modules/notifications/notification.service", {
    createForUser: async () => null,
    notifyAdmins: async () => null,
  });
  stubModule("../src/services/email.service", {
    sendCustomerHeroAssignedEmail: async () => null,
    sendCustomerJobCompletedPendingApprovalEmail: async () => null,
  });
  stubModule("../src/utils/media-storage", {
    deleteMediaObjectByUrl: async (value) => {
      deletes.push(value);
    },
    isManagedMediaUrl: (value = "") =>
      String(value).startsWith("proof-media/") || String(value).startsWith("https://media.example/"),
    normalizeMediaUrl: async (value = "") =>
      String(value).startsWith("proof-media/")
        ? `https://signed.example/${encodeURIComponent(value)}`
        : value,
    normalizeMediaUrls: async (values = []) =>
      Promise.all(
        values.map((value) =>
          String(value).startsWith("proof-media/")
            ? `https://signed.example/${encodeURIComponent(value)}`
            : value
        )
      ),
    persistDataUrlToMediaStorage: async (dataUrl, options) => {
      uploads.push({ dataUrl, options });
      if (uploadImpl) {
        return uploadImpl(dataUrl, options);
      }

      return `proof-media/${options.directoryName}/${options.filePrefix}`;
    },
  });

  return {
    bookingService: require("../src/modules/bookings/booking.service"),
    updates,
    jobUpdates,
    uploads,
    deletes,
  };
};

afterEach(() => {
  clearModules();
});

test("completeBooking uploads proof media before saving proof metadata", async () => {
  const { bookingService, updates, jobUpdates, uploads } = loadBookingService();
  const photoDataUrl = `data:image/png;base64,${Buffer.from("photo").toString("base64")}`;
  const videoDataUrl = `data:video/mp4;base64,${Buffer.from("video").toString("base64")}`;

  const result = await bookingService.completeBooking(
    { _id: "worker-1", role: "worker", name: "Hero" },
    "booking-1",
    {
      verificationPhotoUrls: [photoDataUrl],
      verificationVideoUrl: videoDataUrl,
      workerCompletionNotes: "Done",
    }
  );

  assert.equal(uploads.length, 2);
  assert.deepEqual(
    uploads.map((upload) => upload.options.directoryName),
    ["verification-photos", "verification-videos"]
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update.status, "pending_verification");
  assert.deepEqual(updates[0].update.verificationPhotoUrls, [
    "proof-media/verification-photos/booking-booking-1-photo-1",
  ]);
  assert.equal(
    updates[0].update.verificationVideoUrl,
    "proof-media/verification-videos/booking-booking-1"
  );
  assert.equal(jobUpdates[0].update.status, "pending_verification");
  assert.equal(result.status, "pending_verification");
  assert.deepEqual(result.verificationPhotoUrls, [
    "https://signed.example/proof-media%2Fverification-photos%2Fbooking-booking-1-photo-1",
  ]);
  assert.equal(
    result.verificationVideoUrl,
    "https://signed.example/proof-media%2Fverification-videos%2Fbooking-booking-1"
  );
});

test("completeBooking does not save proof metadata when storage upload fails", async () => {
  const { bookingService, updates, jobUpdates } = loadBookingService({
    uploadImpl: async () => {
      throw new Error("storage failed");
    },
  });
  const photoDataUrl = `data:image/png;base64,${Buffer.from("photo").toString("base64")}`;
  const videoDataUrl = `data:video/mp4;base64,${Buffer.from("video").toString("base64")}`;

  await assert.rejects(
    () =>
      bookingService.completeBooking(
        { _id: "worker-1", role: "worker", name: "Hero" },
        "booking-1",
        {
          verificationPhotoUrls: [photoDataUrl],
          verificationVideoUrl: videoDataUrl,
        }
      ),
    /storage failed/
  );

  assert.equal(updates.length, 0);
  assert.equal(jobUpdates.length, 0);
});
