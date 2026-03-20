const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const bookingRepository = require("./booking.repository");
const jobRepository = require("../jobs/job.repository");
const paymentRepository = require("../payments/payment.repository");
const notificationService = require("../notifications/notification.service");

const getCustomerBookingLink = (jobId) => `/booking-details?jobId=${jobId}`;
const getWorkerBookingLink = (jobId) => `/all-jobs/job-details?jobId=${jobId}`;
const formatStatusLabel = (status = "") =>
  String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

class BookingService {
  async createBookingFromJob(worker, jobId, payload = {}) {
    if (!hasRole(worker, ROLES.WORKER) && !hasRole(worker, ROLES.ADMIN)) {
      throw new AppError("Only workers and admins can create bookings", 403);
    }

    if (hasRole(worker, ROLES.WORKER) && worker.workerStatus !== "approved") {
      throw new AppError("Your worker account is awaiting approval", 403);
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
        type: "booking_assigned",
        category: "booking",
        title: "Worker assigned to your job",
        message: `${worker.name || "A worker"} has been assigned to "${job.title}".`,
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
      throw new AppError("Only workers can accept jobs", 403);
    }

    if (worker.workerStatus !== "approved") {
      throw new AppError("Your worker account is awaiting approval", 403);
    }

    const claimedJob = await jobRepository.claimAvailableJob(jobId, worker._id);

    if (!claimedJob) {
      const existingJob = await jobRepository.findById(jobId);

      if (!existingJob) {
        throw new AppError("Job not found", 404);
      }

      throw new AppError("This job has already been accepted by another worker", 409);
    }

    try {
      const booking = await bookingRepository.create({
        job: claimedJob._id,
        customer: claimedJob.customer,
        worker: worker._id,
        scheduledDate: claimedJob.preferredDate || null,
        scheduledTime: claimedJob.preferredTime || "",
        notes: "Created when the worker accepted the job",
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
          type: "booking_assigned",
          category: "booking",
          title: "Worker assigned to your job",
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
        throw new AppError("This job has already been accepted by another worker", 409);
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
      throw new AppError("Only the assigned worker can start this booking", 403);
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, {
      status: "in_progress",
      startedAt: new Date(),
    });

    await jobRepository.updateById(booking.job?._id || booking.job, {
      status: "in_progress",
    });

    const refreshedBooking = await bookingRepository.findBookingWithRelations(updatedBooking._id);
    await Promise.allSettled([
      notificationService.createForUser(refreshedBooking.customer, {
        type: "booking_started",
        category: "booking",
        title: "Work is now in progress",
        message: `${user.name || "Your worker"} started work on "${refreshedBooking.job?.title || "your job"}".`,
        link: getCustomerBookingLink(refreshedBooking.job?._id || refreshedBooking.job),
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: user._id,
      }),
    ]);

    return refreshedBooking;
  }

  async completeBooking(user, bookingId) {
    const booking = await this.getBookingById(user, bookingId);

    if (!hasRole(user, ROLES.ADMIN) && String(booking.worker?._id || booking.worker) !== String(user._id)) {
      throw new AppError("Only the assigned worker can complete this booking", 403);
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, {
      status: "completed",
      completedAt: new Date(),
    });

    await jobRepository.updateById(booking.job?._id || booking.job, {
      status: "completed",
    });

    const refreshedBooking = await bookingRepository.findBookingWithRelations(updatedBooking._id);
    const paymentService = require("../payments/payment.service");
    const paymentCapture = await paymentService.captureAuthorizedPaymentForBooking(
      refreshedBooking,
      {
        completedByUserId: String(user._id),
      }
    );
    const jobId = refreshedBooking.job?._id || refreshedBooking.job;
    const jobTitle = refreshedBooking.job?.title || "your job";
    const paymentStatus = String(paymentCapture?.status || "").trim().toLowerCase();
    const customerNotification =
      paymentStatus === "failed"
        ? {
            title: "Job completed, payment needs attention",
            message: `"${jobTitle}" was marked complete, but the payment needs manual review.`,
          }
        : paymentStatus === "paid" || paymentStatus === "already_paid"
          ? {
              title: "Job completed successfully",
              message: `"${jobTitle}" was completed and payment was captured successfully.`,
            }
          : {
              title: "Job completed successfully",
              message: `"${jobTitle}" was marked complete.`,
            };
    const workerNotification =
      paymentStatus === "failed"
        ? {
            title: "Job completed, payment needs attention",
            message: `You completed "${jobTitle}", but the payment needs manual review.`,
            link: "/payment",
          }
        : paymentStatus === "paid" || paymentStatus === "already_paid"
          ? {
              title: "Job completed and payment captured",
              message: `You completed "${jobTitle}" and the payment was captured successfully.`,
              link: "/payment",
            }
          : {
              title: "Job completed",
              message: `You completed "${jobTitle}".`,
              link: getWorkerBookingLink(jobId),
            };

    await Promise.allSettled([
      notificationService.createForUser(refreshedBooking.customer, {
        type: "booking_completed",
        category: "booking",
        title: customerNotification.title,
        message: customerNotification.message,
        link: getCustomerBookingLink(jobId),
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: user._id,
      }),
      notificationService.createForUser(refreshedBooking.worker, {
        type: "booking_completed",
        category: "booking",
        title: workerNotification.title,
        message: workerNotification.message,
        link: workerNotification.link,
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: user._id,
      }),
      ...(paymentStatus === "failed"
        ? [
            notificationService.notifyAdmins(
              {
                type: "payment_issue",
                category: "payment",
                title: "Payment capture failed",
                message: `Payment capture failed after "${jobTitle}" was completed.`,
                link: `/payments`,
                entityType: "booking",
                entityId: String(refreshedBooking._id),
                actorUserId: user._id,
              },
              {
                preferenceKey: "paymentIssues",
              }
            ),
          ]
        : [
            notificationService.notifyAdmins(
              {
                type: "booking_completed",
                category: "booking",
                title: "Service completed",
                message: `${refreshedBooking.worker?.name || "A worker"} completed "${jobTitle}".`,
                link: `/booking/${jobId}`,
                entityType: "booking",
                entityId: String(refreshedBooking._id),
                actorUserId: user._id,
              },
              {
                preferenceKey: "serviceCompletions",
              }
            ),
          ]),
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
            category: "booking",
            title: "Booking cancelled",
            message: `${actorLabel} cancelled "${jobTitle}".`,
            link: getWorkerBookingLink(jobId),
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

    const update = { status };

    if (status === "in_progress") {
      update.startedAt = new Date();
    }

    if (status === "completed") {
      update.completedAt = new Date();
    }

    if (status === "cancelled") {
      update.cancelledAt = new Date();
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, update);

    const jobStatusMap = {
      assigned: "assigned",
      in_progress: "in_progress",
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
        category: "booking",
        title: "Booking updated by admin",
        message: `Admin changed "${refreshedBooking.job?.title || "your booking"}" to ${statusLabel}.`,
        link: getWorkerBookingLink(jobId),
        entityType: "booking",
        entityId: String(refreshedBooking._id),
        actorUserId: adminUser._id,
      }),
    ]);

    return refreshedBooking;
  }
}

module.exports = new BookingService();
