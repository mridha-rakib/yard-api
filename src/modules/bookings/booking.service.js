const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const bookingRepository = require("./booking.repository");
const jobRepository = require("../jobs/job.repository");
const paymentRepository = require("../payments/payment.repository");

class BookingService {
  async createBookingFromJob(worker, jobId, payload = {}) {
    if (worker.role !== ROLES.WORKER && worker.role !== ROLES.ADMIN) {
      throw new AppError("Only workers and admins can create bookings", 403);
    }

    if (worker.role === ROLES.WORKER && worker.workerStatus !== "approved") {
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

    return bookingRepository.findBookingWithRelations(booking._id);
  }

  async acceptAvailableJob(worker, jobId) {
    if (worker.role !== ROLES.WORKER) {
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

      return bookingRepository.findBookingWithRelations(booking._id);
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
      user.role === ROLES.ADMIN ||
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

    if (user.role !== ROLES.ADMIN && String(booking.worker?._id || booking.worker) !== String(user._id)) {
      throw new AppError("Only the assigned worker can start this booking", 403);
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, {
      status: "in_progress",
      startedAt: new Date(),
    });

    await jobRepository.updateById(booking.job?._id || booking.job, {
      status: "in_progress",
    });

    return bookingRepository.findBookingWithRelations(updatedBooking._id);
  }

  async completeBooking(user, bookingId) {
    const booking = await this.getBookingById(user, bookingId);

    if (user.role !== ROLES.ADMIN && String(booking.worker?._id || booking.worker) !== String(user._id)) {
      throw new AppError("Only the assigned worker can complete this booking", 403);
    }

    const updatedBooking = await bookingRepository.updateById(bookingId, {
      status: "completed",
      completedAt: new Date(),
    });

    await jobRepository.updateById(booking.job?._id || booking.job, {
      status: "completed",
    });

    return bookingRepository.findBookingWithRelations(updatedBooking._id);
  }

  async cancelBooking(user, bookingId, reason = "") {
    const booking = await this.getBookingById(user, bookingId);

    const isAllowed =
      user.role === ROLES.ADMIN ||
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

    return bookingRepository.findBookingWithRelations(updatedBooking._id);
  }

  async updateBookingStatusByAdmin(adminUser, bookingId, status) {
    if (adminUser.role !== ROLES.ADMIN) {
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

    return bookingRepository.findBookingWithRelations(updatedBooking._id);
  }
}

module.exports = new BookingService();
