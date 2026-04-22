const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const bookingRepository = require("./booking.repository");
const jobRepository = require("../jobs/job.repository");
const paymentRepository = require("../payments/payment.repository");
const notificationService = require("../notifications/notification.service");
const { isWorkerPayoutReady } = require("../../utils/worker-payouts");
const { assertDataUrlMaxBytes, assertDataUrlMimeType } = require("../../utils/data-url");
const {
  deleteMediaObjectByUrl,
  isManagedMediaUrl,
  persistDataUrlToMediaStorage,
} = require("../../utils/media-storage");

const getCustomerBookingLink = (jobId) => `/booking-details?jobId=${jobId}`;
const getHeroBookingLink = (jobId) => `/all-jobs/job-details?jobId=${jobId}`;
const MAX_VERIFICATION_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_VERIFICATION_VIDEO_BYTES = 25 * 1024 * 1024;
const formatStatusLabel = (status = "") =>
  String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

class BookingService {
  async clearStoredProofMedia(booking = {}) {
    const proofMediaUrls = [
      ...(Array.isArray(booking?.verificationPhotoUrls) ? booking.verificationPhotoUrls : []),
      booking?.verificationVideoUrl,
    ].filter(Boolean);

    if (!proofMediaUrls.length) {
      return;
    }

    await Promise.allSettled(
      proofMediaUrls.map((mediaUrl) => deleteMediaObjectByUrl(mediaUrl))
    );
  }

  assertWorkerCanReceivePayouts(worker) {
    if (!isWorkerPayoutReady(worker)) {
      throw new AppError(
        "Complete your Stripe payout setup before accepting customer jobs",
        409
      );
    }
  }

  async createBookingFromJob(worker, jobId, payload = {}) {
    if (!hasRole(worker, ROLES.WORKER) && !hasRole(worker, ROLES.ADMIN)) {
      throw new AppError("Only Heroes and admins can create bookings", 403);
    }

    if (hasRole(worker, ROLES.WORKER) && worker.workerStatus !== "approved") {
      throw new AppError("Your Hero account is awaiting approval", 403);
    }

    if (hasRole(worker, ROLES.WORKER)) {
      this.assertWorkerCanReceivePayouts(worker);
    }

    const job = await jobRepository.findById(jobId);

    if (!job) {
      throw new AppError("Job not found", 404);
    }

    if (job.status !== "new" || job.assignedWorker) {
      throw new AppError("This job is no longer available", 400);
    }

    const existingBooking = await bookingRepository.findByJob(jobId);
    if (existingBooking) {
      throw new AppError("A booking already exists for this job", 409);
    }

    const booking = await bookingRepository.create({
      job: job._id,
      customer: job.customer,
      worker: worker._id,
      scheduledDate: payload.scheduledDate || job.preferredDate || null,
      scheduledTime: payload.scheduledTime || job.preferredTime || "",
      notes: payload.notes || "",
      status: "assigned",
    });

    await jobRepository.updateById(job._id, {
      assignedWorker: worker._id,
      status: "assigned",
    });

    const relatedPayment = await paymentRepository.findByJob(job._id);
    if (relatedPayment) {
      await paymentRepository.updateById(relatedPayment._id, {
        booking: booking._id,
        worker: worker._id,
      });
    }

    const hydratedBooking = await bookingRepository.findBookingWithRelations(booking._id);
    await Promise.allSettled([
      notificationService.createForUser(job.customer, {
        type: "booking_accepted",
        recipientRole: ROLES.CUSTOMER,
        category: "booking",
        title: "Hero accepted your job",
        message: `${worker.name || "A Hero"} accepted "${job.title}".`,
        link: getCustomerBookingLink(job._id),
        entityType: "booking",
        entityId: String(booking._id),
        actorUserId: worker._id || null,
      }),
    ]);

    return hydratedBooking;
  }

  async acceptAvailableJob(worker, jobId) {
    if (!hasRole(worker, ROLES.WORKER)) {
      throw new AppError("Only Heroes can accept jobs", 403);
    }

    if (worker.workerStatus !== "approved") {
      throw new AppError("Your Hero account is awaiting approval", 403);
    }

    this.assertWorkerCanReceivePayouts(worker);

    const claimedJob = await jobRepository.claimAvailableJob(jobId, worker._id);

    if (!claimedJob) {
      const existingJob = await jobRepository.findById(jobId);

      if (!existingJob) {
        throw new AppError("Job not found", 404);
      }

      throw new AppError("This job has already been accepted by another Hero", 409);
    }

    try {
      const booking = await bookingRepository.create({
        job: claimedJob._id,
        customer: claimedJob.customer,
        worker: worker._id,
        scheduledDate: claimedJob.preferredDate || null,
        scheduledTime: claimedJob.preferredTime || "",
        notes: "Created when the Hero accepted the job",
        status: "assigned",
      });

      const relatedPayment = await paymentRepository.findByJob(claimedJob._id);
      if (relatedPayment) {
        await paymentRepository.updateById(relatedPayment._id, {
          booking: booking._id,
          worker: worker._id,
        });
      }

      const hydratedBooking = await bookingRepository.findBookingWithRelations(booking._id);
      await Promise.allSettled([
        notificationService.createForUser(claimedJob.customer, {
          type: "booking_accepted",
          recipientRole: ROLES.CUSTOMER,
          category: "booking",
          title: "Hero accepted your job",
          message: `${worker.name} accepted "${claimedJob.title}".`,
          link: getCustomerBookingLink(claimedJob._id),
          entityType: "booking",
          entityId: String(booking._id),
          actorUserId: worker._id,
        }),
      ]);

      return hydratedBooking;
    } catch (error) {
      await jobRepository.releaseClaimedJob(claimedJob._id, worker._id);

      if (error?.code === 11000) {
        throw new AppError("This job has already been accepted by another Hero", 409);
      }

      throw error;
    }
  }

  async getBookingById(user, bookingId) {
    const booking = await bookingRepository.findBookingWithRelations(bookingId);

    if (!booking) {
      throw new AppError("Booking not found", 404);
    }

    const isAllowed =
      hasRole(user, ROLES.ADMIN) ||
      String(booking.customer?._id || booking.customer) === String(user._id) ||
      String(booking.worker?._id || booking.worker) === String(user._id);

    if (!isAllowed) {
      throw new AppError("You do not have access to this booking", 403);
    }

    return booking;
  }

  async listBookings(user, query = {}) {
    const pagination = buildPagination(query);
    const filter = {};

    if (user.role === ROLES.CUSTOMER) {
      filter.customer = user._id;
    } else if (user.role === ROLES.WORKER) {
      filter.worker = user._id;
    }

    if (query.status) {
      filter.status = query.status;
    }

    return bookingRepository.paginateWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });
  }

  async startBooking(user, bookingId) {
    const booking = await this.getBookingById(user, bookingId);

    if (!hasRole(user, ROLES.ADMIN) && String(booking.worker?._id || booking.worker) !== String(user._id)) {
      throw new AppError("Only the Hero on this booking can start this service", 403);
    }

    await this.clearStoredProofMedia(booking);

    const updatedBooking = await bookingRepository.updateById(bookingId, {
      status: "in_progress",
      startedAt: new Date(),
      workerCompletionNotes: "",
      verificationPhotoUrls: [],
      verificationVideoUrl: "",
      verificationSubmittedAt: null,
      verificationReviewedAt: null,
      verificationApprovedAt: null,
      verificationApprovedBy: null,
      verificationNotes: "",
    });

    await jobRepository.updateById(booking.job?._id || booking.job, {
      status: "in_progress",
    });

    const refreshedBooking = await bookingRepository.findBookingWithRelations(updatedBooking._id);
    await Promise.allSettled([
      notificationService.createForUser(refreshedBooking.customer, {
        type: "booking_started",
        recipientRole: ROLES.CUSTOMER,
        category: "booking",
        title: "Work is now in progress",
        message: `${user.name || "Your Hero"} started work on "${refreshedBooking.job?.title || "your job"}".`,
        link: getCustomerBookingLink(refreshedBooking.job?._id || refreshedBooking.job),
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: user._id,
      }),
    ]);

    return refreshedBooking;
  }

  async completeBooking(user, bookingId, payload = {}) {
    const booking = await this.getBookingById(user, bookingId);

    if (!hasRole(user, ROLES.ADMIN) && String(booking.worker?._id || booking.worker) !== String(user._id)) {
      throw new AppError("Only the Hero on this booking can complete this service", 403);
    }

    const verificationPhotoUrls = Array.isArray(payload.verificationPhotoUrls)
      ? payload.verificationPhotoUrls.filter(Boolean)
      : [];
    const verificationVideoUrl = String(payload.verificationVideoUrl || "").trim();

    if (!verificationPhotoUrls.length) {
      throw new AppError("A verification photo is required before completion review", 400);
    }

    if (!verificationVideoUrl) {
      throw new AppError("A verification video is required before completion review", 400);
    }

    verificationPhotoUrls.forEach((photoUrl, index) => {
      if (isManagedMediaUrl(photoUrl, "verification-photos")) {
        return;
      }

      assertDataUrlMimeType(
        photoUrl,
        "image/",
        `Verification photo ${index + 1} must be an image upload`
      );
      assertDataUrlMaxBytes(
        photoUrl,
        MAX_VERIFICATION_PHOTO_BYTES,
        "Verification photo is too large. Please upload an image under 5MB."
      );
    });

    if (!isManagedMediaUrl(verificationVideoUrl, "verification-videos")) {
      assertDataUrlMimeType(
        verificationVideoUrl,
        "video/",
        "Verification proof must include a valid video file."
      );
      assertDataUrlMaxBytes(
        verificationVideoUrl,
        MAX_VERIFICATION_VIDEO_BYTES,
        "Verification video is too large. Please upload a video under 25MB."
      );
    }

    const uploadedProofMediaUrls = [];

    try {
      await this.clearStoredProofMedia(booking);

      const storedVerificationPhotoUrls = await Promise.all(
        verificationPhotoUrls.map(async (photoUrl, index) => {
          if (isManagedMediaUrl(photoUrl, "verification-photos")) {
            return photoUrl;
          }

          const storedPhotoUrl = await persistDataUrlToMediaStorage(photoUrl, {
            directoryName: "verification-photos",
            filePrefix: `booking-${bookingId}-photo-${index + 1}`,
            requiredMimePrefix: "image/",
          });

          uploadedProofMediaUrls.push(storedPhotoUrl);
          return storedPhotoUrl;
        })
      );

      const storedVerificationVideoUrl = isManagedMediaUrl(
        verificationVideoUrl,
        "verification-videos"
      )
        ? verificationVideoUrl
        : await persistDataUrlToMediaStorage(verificationVideoUrl, {
            directoryName: "verification-videos",
            filePrefix: `booking-${bookingId}`,
            requiredMimePrefix: "video/",
          });

      if (!isManagedMediaUrl(verificationVideoUrl, "verification-videos")) {
        uploadedProofMediaUrls.push(storedVerificationVideoUrl);
      }

      const updatedBooking = await bookingRepository.updateById(bookingId, {
        status: "pending_verification",
        completedAt: new Date(),
        workerCompletionNotes: String(payload.workerCompletionNotes || "").trim(),
        verificationPhotoUrls: storedVerificationPhotoUrls,
        verificationVideoUrl: storedVerificationVideoUrl,
        verificationSubmittedAt: new Date(),
        verificationReviewedAt: null,
        verificationApprovedAt: null,
        verificationApprovedBy: null,
        verificationNotes: String(payload.verificationNotes || "").trim(),
      });

      await jobRepository.updateById(booking.job?._id || booking.job, {
        status: "pending_verification",
      });

      const refreshedBooking = await bookingRepository.findBookingWithRelations(updatedBooking._id);
      const jobId = refreshedBooking.job?._id || refreshedBooking.job;
      const jobTitle = refreshedBooking.job?.title || "your job";

      await Promise.allSettled([
        notificationService.createForUser(refreshedBooking.customer, {
          type: "booking_pending_verification",
          recipientRole: ROLES.CUSTOMER,
          category: "booking",
          title: "Job proof submitted for review",
          message: `"${jobTitle}" was marked complete and is now waiting for YardHero verification.`,
          link: getCustomerBookingLink(jobId),
          entityType: "booking",
          entityId: String(refreshedBooking._id),
          actorUserId: user._id,
        }),
        notificationService.createForUser(refreshedBooking.worker, {
          type: "booking_pending_verification",
          recipientRole: ROLES.WORKER,
          category: "booking",
          title: "Completion proof submitted",
          message: `You submitted photo and video proof for "${jobTitle}". Payment will be released after admin approval.`,
          link: getHeroBookingLink(jobId),
          entityType: "booking",
          entityId: String(refreshedBooking._id),
          actorUserId: user._id,
        }),
        notificationService.notifyAdmins(
          {
            type: "booking_pending_verification",
            category: "booking",
            title: "Job awaiting verification",
            message: `${refreshedBooking.worker?.name || "A Hero"} submitted proof for "${jobTitle}".`,
            link: `/booking/${jobId}`,
            entityType: "booking",
            entityId: String(refreshedBooking._id),
            actorUserId: user._id,
          },
          {
            preferenceKey: "serviceCompletions",
          }
        ),
      ]);

      return refreshedBooking;
    } catch (error) {
      await Promise.allSettled(
        uploadedProofMediaUrls.map((mediaUrl) => deleteMediaObjectByUrl(mediaUrl))
      );
      throw error;
    }
  }

  async approveCompletionByAdmin(adminUser, bookingId, payload = {}) {
    if (!hasRole(adminUser, ROLES.ADMIN)) {
      throw new AppError("Only admins can approve booking completion", 403);
    }

    const booking = await bookingRepository.findBookingWithRelations(bookingId);

    if (!booking) {
      throw new AppError("Booking not found", 404);
    }

    if (booking.status !== "pending_verification") {
      throw new AppError("This booking is not waiting for verification approval", 400);
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, {
      status: "approved",
      verificationReviewedAt: new Date(),
      verificationApprovedAt: new Date(),
      verificationApprovedBy: adminUser._id,
      verificationNotes: String(payload.reviewNotes || booking.verificationNotes || "").trim(),
    });

    await jobRepository.updateById(booking.job?._id || booking.job, {
      status: "completed",
    });

    const refreshedBooking = await bookingRepository.findBookingWithRelations(updatedBooking._id);
    const paymentService = require("../payments/payment.service");
    const paymentCapture = await paymentService.captureAuthorizedPaymentForBooking(
      refreshedBooking,
      {
        approvedByUserId: String(adminUser._id),
      }
    );
    const jobId = refreshedBooking.job?._id || refreshedBooking.job;
    const jobTitle = refreshedBooking.job?.title || "your job";
    const paymentStatus = String(paymentCapture?.status || "").trim().toLowerCase();
    const workerTransferStatus = String(paymentCapture?.workerTransferStatus || "")
      .trim()
      .toLowerCase();
    const payoutNeedsAttention =
      paymentStatus === "failed" ||
      ["failed", "worker_not_ready", "charge_not_ready"].includes(workerTransferStatus);

    await Promise.allSettled([
      notificationService.createForUser(refreshedBooking.customer, {
        type: "booking_approved",
        recipientRole: ROLES.CUSTOMER,
        category: "booking",
        title: "Job approved by YardHero",
        message:
          payoutNeedsAttention
            ? `"${jobTitle}" was approved, but payment needs manual attention.`
            : `"${jobTitle}" passed verification and has been closed successfully.`,
        link: getCustomerBookingLink(jobId),
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: adminUser._id,
      }),
      notificationService.createForUser(refreshedBooking.worker, {
        type: "booking_approved",
        recipientRole: ROLES.WORKER,
        category: "booking",
        title:
          payoutNeedsAttention
            ? "Job approved, payout needs attention"
            : "Job approved and payout released",
        message:
          payoutNeedsAttention
            ? `Your work on "${jobTitle}" was approved, but the payout needs manual review.`
            : `Your work on "${jobTitle}" was approved and the payout was released.`,
        link: "/payment",
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: adminUser._id,
      }),
      ...(payoutNeedsAttention
        ? [
            notificationService.notifyAdmins(
              {
                type: "payment_issue",
                category: "payment",
                title: "Approved job needs payment review",
                message: `Payout release needs review after approval for "${jobTitle}".`,
                link: "/payments",
                entityType: "booking",
                entityId: String(refreshedBooking._id),
                actorUserId: adminUser._id,
              },
              {
                preferenceKey: "paymentIssues",
              }
            ),
          ]
        : []),
    ]);

    return {
      booking: refreshedBooking,
      paymentCapture,
    };
  }

  async cancelBooking(user, bookingId, reason = "") {
    const booking = await this.getBookingById(user, bookingId);

    const isAllowed =
      hasRole(user, ROLES.ADMIN) ||
      String(booking.customer?._id || booking.customer) === String(user._id) ||
      String(booking.worker?._id || booking.worker) === String(user._id);

    if (!isAllowed) {
      throw new AppError("You do not have permission to cancel this booking", 403);
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, {
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: new Date(),
    });

    await jobRepository.updateById(booking.job?._id || booking.job, {
      status: "cancelled",
      assignedWorker: null,
    });

    const refreshedBooking = await bookingRepository.findBookingWithRelations(updatedBooking._id);
    const actorIsAdmin = hasRole(user, ROLES.ADMIN);
    const actorLabel = actorIsAdmin ? "Admin" : user.name || "A user";
    const jobId = refreshedBooking.job?._id || refreshedBooking.job;
    const jobTitle = refreshedBooking.job?.title || "the booking";

    await Promise.allSettled([
      String(refreshedBooking.customer?._id || refreshedBooking.customer) !== String(user._id)
        ? notificationService.createForUser(refreshedBooking.customer, {
            type: "booking_cancelled",
            recipientRole: ROLES.CUSTOMER,
            category: "booking",
            title: "Booking cancelled",
            message: `${actorLabel} cancelled "${jobTitle}".`,
            link: getCustomerBookingLink(jobId),
            entityType: "booking",
            entityId: String(refreshedBooking._id),
            actorUserId: user._id,
          })
        : Promise.resolve(null),
      String(refreshedBooking.worker?._id || refreshedBooking.worker) !== String(user._id)
        ? notificationService.createForUser(refreshedBooking.worker, {
            type: "booking_cancelled",
            recipientRole: ROLES.WORKER,
            category: "booking",
            title: "Booking cancelled",
            message: `${actorLabel} cancelled "${jobTitle}".`,
            link: getHeroBookingLink(jobId),
            entityType: "booking",
            entityId: String(refreshedBooking._id),
            actorUserId: user._id,
          })
        : Promise.resolve(null),
      notificationService.notifyAdmins({
        type: "booking_cancelled",
        category: "booking",
        title: "Booking cancelled",
        message: `${actorLabel} cancelled "${jobTitle}".`,
        link: `/booking/${jobId}`,
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: user._id,
      }),
    ]);

    return refreshedBooking;
  }

  async updateBookingStatusByAdmin(adminUser, bookingId, status) {
    if (!hasRole(adminUser, ROLES.ADMIN)) {
      throw new AppError("Only admins can update booking status", 403);
    }

    const booking = await bookingRepository.findById(bookingId);
    if (!booking) {
      throw new AppError("Booking not found", 404);
    }

    if (status === "approved") {
      throw new AppError("Use the approval action to release payment for this booking", 400);
    }

    const update = { status };

    if (status === "in_progress") {
      await this.clearStoredProofMedia(booking);

      update.startedAt = new Date();
      update.workerCompletionNotes = "";
      update.verificationPhotoUrls = [];
      update.verificationVideoUrl = "";
      update.verificationSubmittedAt = null;
      update.verificationReviewedAt = null;
      update.verificationApprovedAt = null;
      update.verificationApprovedBy = null;
      update.verificationNotes = "";
    }

    if (status === "completed" || status === "pending_verification") {
      update.completedAt = new Date();
    }

    if (status === "cancelled") {
      update.cancelledAt = new Date();
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, update);

    const jobStatusMap = {
      assigned: "assigned",
      in_progress: "in_progress",
      pending_verification: "pending_verification",
      completed: "completed",
      cancelled: "cancelled",
    };

    await jobRepository.updateById(booking.job, {
      status: jobStatusMap[status] || "assigned",
    });

    const refreshedBooking = await bookingRepository.findBookingWithRelations(updatedBooking._id);
    const jobId = refreshedBooking.job?._id || refreshedBooking.job;
    const statusLabel = formatStatusLabel(status).toLowerCase();

    await Promise.allSettled([
      notificationService.createForUser(refreshedBooking.customer, {
        type: "booking_status_updated",
        recipientRole: ROLES.CUSTOMER,
        category: "booking",
        title: "Booking updated by admin",
        message: `Admin changed "${refreshedBooking.job?.title || "your booking"}" to ${statusLabel}.`,
        link: getCustomerBookingLink(jobId),
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: adminUser._id,
      }),
      notificationService.createForUser(refreshedBooking.worker, {
        type: "booking_status_updated",
        recipientRole: ROLES.WORKER,
        category: "booking",
        title: "Booking updated by admin",
        message: `Admin changed "${refreshedBooking.job?.title || "your booking"}" to ${statusLabel}.`,
        link: getHeroBookingLink(jobId),
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: adminUser._id,
      }),
    ]);

    return refreshedBooking;
  }
}

module.exports = new BookingService();
