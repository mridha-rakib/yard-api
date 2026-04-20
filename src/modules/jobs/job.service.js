const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { hasAnyRole, hasRole } = require("../../utils/user-roles");
const bookingRepository = require("../bookings/booking.repository");
const bookingService = require("../bookings/booking.service");
const paymentRepository = require("../payments/payment.repository");
const jobRepository = require("./job.repository");
const notificationService = require("../notifications/notification.service");

class JobService {
  normalizeUrgency(urgency = "flexible") {
    if (urgency === "within24hours") {
      return "within24";
    }

    if (["today", "within24", "flexible", "scheduled"].includes(urgency)) {
      return urgency;
    }

    return "flexible";
  }

  buildTitle(serviceType, title) {
    if (title) {
      return title;
    }

    return String(serviceType || "Service Request")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  getPriorityFromUrgency(urgency, priority) {
    if (priority) {
      return priority;
    }

    if (urgency === "today") {
      return "high";
    }

    if (urgency === "within24") {
      return "medium";
    }

    return "low";
  }

  mapCreatePayload(user, payload) {
    const serviceId = payload.serviceId || "";
    const serviceType = payload.serviceType || payload.serviceTitle || payload.category || serviceId;
    const urgency = this.normalizeUrgency(payload.urgency);
    const jobDescription =
      payload.jobDescription || payload.description || payload.stateCountry;
    const pricing =
      payload.pricing && typeof payload.pricing === "object" ? payload.pricing : {};
    const estimatedPrice =
      pricing?.finalPrice ?? payload.estimatedPrice ?? payload.estimatedTotal ?? 0;

    return {
      customer: user._id,
      assignedWorker: null,
      title: this.buildTitle(serviceType, payload.title),
      serviceId,
      serviceType,
      serviceCategoryId: payload.serviceCategoryId || payload.categoryId || "",
      serviceCategoryLabel: payload.serviceCategoryLabel || payload.categoryLabel || "",
      fullName: payload.fullName || user.name,
      phoneNumber: payload.phoneNumber || payload.phone || "",
      email: payload.email || user.email,
      streetAddress: payload.streetAddress,
      city: payload.city,
      state: payload.state || "",
      zipCode: payload.zipCode,
      jobDescription,
      urgency,
      preferredDate: payload.preferredDate || null,
      preferredTime: payload.preferredTime || "",
      jobSize: payload.jobSize || "",
      priority: this.getPriorityFromUrgency(urgency, payload.priority),
      estimatedPrice: Number(estimatedPrice || 0),
      priceQuoted: Number(payload.priceQuoted || estimatedPrice || 0),
      pricing,
      photos: payload.photos || payload.photoUrls || [],
      paymentStatus: payload.isPaid ? "paid" : "pending",
      isPaid: Boolean(payload.isPaid),
      status: "new",
    };
  }

  validateCreatePayload(payload) {
    const requiredFields = [
      "serviceType",
      "streetAddress",
      "city",
      "zipCode",
      "jobDescription",
    ];

    const missingField = requiredFields.find((field) => !payload[field]);
    if (missingField) {
      throw new AppError(`${missingField} is required`, 400);
    }
  }

  async createJob(user, payload) {
    if (!hasAnyRole(user, ROLES.CUSTOMER, ROLES.ADMIN)) {
      throw new AppError("Only customers and admins can create jobs", 403);
    }

    const mappedPayload = this.mapCreatePayload(user, payload);
    this.validateCreatePayload(mappedPayload);

    const job = await jobRepository.create(mappedPayload);
    const hydratedJob = await jobRepository.findJobWithRelations(job._id);

    if (hasRole(user, ROLES.CUSTOMER)) {
      await Promise.allSettled([
        notificationService.createForUser(user, {
          type: "job_created",
          recipientRole: ROLES.CUSTOMER,
          category: "job",
          title: "Job request created",
          message: `"${hydratedJob.title}" was submitted successfully.`,
          link: `/booking-details?jobId=${hydratedJob._id}`,
          entityType: "job",
          entityId: String(hydratedJob._id),
          actorUserId: user._id,
        }),
        notificationService.notifyAdmins({
          type: "job_created",
          category: "job",
          title: "New job request",
          message: `${user.name} submitted "${hydratedJob.title}".`,
          link: `/booking/${hydratedJob._id}`,
          entityType: "job",
          entityId: String(hydratedJob._id),
          actorUserId: user._id,
        }),
      ]);
    }

    return hydratedJob;
  }

  buildQueryFilter(query = {}) {
    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.paymentStatus) {
      filter.paymentStatus = query.paymentStatus;
    }

    if (query.serviceType) {
      filter.serviceType = query.serviceType;
    }

    if (query.customerId) {
      filter.customer = query.customerId;
    }

    if (query.workerId) {
      filter.assignedWorker = query.workerId;
    }

    if (query.search) {
      filter.$or = [
        { title: { $regex: query.search, $options: "i" } },
        { fullName: { $regex: query.search, $options: "i" } },
        { email: { $regex: query.search, $options: "i" } },
        { serviceType: { $regex: query.search, $options: "i" } },
        { city: { $regex: query.search, $options: "i" } },
      ];
    }

    return filter;
  }

  async attachOperationalDetails(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return items;
    }

    const jobIds = items.map((item) => item?._id).filter(Boolean);

    if (jobIds.length === 0) {
      return items;
    }

    const [bookings, payments] = await Promise.all([
      bookingRepository.findMany(
        { job: { $in: jobIds } },
        {
          lean: true,
          select:
            "job status scheduledDate scheduledTime notes workerCompletionNotes verificationPhotoUrls verificationVideoUrl verificationSubmittedAt verificationReviewedAt verificationApprovedAt verificationApprovedBy verificationNotes cancelReason startedAt completedAt cancelledAt createdAt",
        }
      ),
      paymentRepository.findMany(
        { job: { $in: jobIds } },
        {
          lean: true,
          select:
            "job amount currency status platformFee platformFeePercentage workerPayout paidAt authorizedAt authorizationExpiresAt captureAttemptedAt lastCaptureError createdAt",
        }
      ),
    ]);

    const bookingsByJobId = new Map(
      bookings.map((booking) => [String(booking.job), booking])
    );
    const paymentsByJobId = new Map(
      payments.map((payment) => [String(payment.job), payment])
    );

    return items.map((item) => {
      const normalizedItem = item?.toObject ? item.toObject() : item;
      const jobId = String(normalizedItem._id);

      return {
        ...normalizedItem,
        booking: bookingsByJobId.get(jobId) || null,
        payment: paymentsByJobId.get(jobId) || null,
      };
    });
  }

  async listJobs(requestingUser, query = {}) {
    const pagination = buildPagination(query);
    const filter = this.buildQueryFilter(query);

    if (!requestingUser) {
      filter.status = "new";
      filter.assignedWorker = null;
    }

    if (requestingUser?.role === ROLES.CUSTOMER && !query.includeAll) {
      filter.customer = requestingUser._id;
    }

    if (requestingUser?.role === ROLES.WORKER && !query.includeAll) {
      filter.$or = [
        { assignedWorker: requestingUser._id },
        { status: "new", assignedWorker: null },
      ];
    }

    const result = await jobRepository.findManyWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });

    return {
      ...result,
      items: await this.attachOperationalDetails(result.items),
    };
  }

  async listAvailableJobs(worker, query = {}) {
    if (!hasRole(worker, ROLES.WORKER)) {
      throw new AppError("Only Heroes can view available jobs", 403);
    }

    if (worker.workerStatus !== "approved") {
      throw new AppError("Your Hero account is awaiting approval", 403);
    }

    const pagination = buildPagination(query);
    const filter = {
      status: "new",
      assignedWorker: null,
    };

    if (query.search) {
      filter.$or = [
        { title: { $regex: query.search, $options: "i" } },
        { serviceType: { $regex: query.search, $options: "i" } },
        { city: { $regex: query.search, $options: "i" } },
      ];
    }

    const result = await jobRepository.findManyWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });

    return {
      ...result,
      items: await this.attachOperationalDetails(result.items),
    };
  }

  async listMyJobs(user, query = {}) {
    const pagination = buildPagination(query);
    const filter = user.role === ROLES.WORKER ? { assignedWorker: user._id } : { customer: user._id };

    if (query.status) {
      filter.status = query.status;
    }

    const result = await jobRepository.findManyWithRelations(filter, {
      ...pagination,
      sort: { createdAt: -1 },
    });

    const [
      newCount,
      assignedCount,
      inProgressCount,
      pendingVerificationCount,
      completedCount,
    ] = await Promise.all([
      jobRepository.count({ ...filter, status: "new" }),
      jobRepository.count({ ...filter, status: "assigned" }),
      jobRepository.count({ ...filter, status: "in_progress" }),
      jobRepository.count({ ...filter, status: "pending_verification" }),
      jobRepository.count({ ...filter, status: { $in: ["completed", "paid"] } }),
    ]);

    return {
      ...result,
      items: await this.attachOperationalDetails(result.items),
      summary: {
        new: newCount,
        assigned: assignedCount,
        inProgress: inProgressCount,
        pendingVerification: pendingVerificationCount,
        completed: completedCount,
      },
    };
  }

  async getJobById(requestingUser, jobId) {
    const job = await jobRepository.findJobWithRelations(jobId);

    if (!job) {
      throw new AppError("Job not found", 404);
    }

    if (
      requestingUser &&
      !hasRole(requestingUser, ROLES.ADMIN) &&
      String(job.customer?._id || job.customer) !== String(requestingUser._id) &&
      String(job.assignedWorker?._id || job.assignedWorker || "") !== String(requestingUser._id) &&
      !(requestingUser.role === ROLES.WORKER && job.status === "new")
    ) {
      throw new AppError("You do not have access to this job", 403);
    }

    const [enrichedJob] = await this.attachOperationalDetails([job]);
    return enrichedJob;
  }

  async acceptJob(worker, jobId) {
    const booking = await bookingService.acceptAvailableJob(worker, jobId);
    const job = await this.getJobById(worker, jobId);

    return {
      job,
      booking,
    };
  }

  async updateJob(user, jobId, payload) {
    const job = await jobRepository.findById(jobId);

    if (!job) {
      throw new AppError("Job not found", 404);
    }

    if (!hasRole(user, ROLES.ADMIN) && String(job.customer) !== String(user._id)) {
      throw new AppError("You do not have permission to update this job", 403);
    }

    if (["completed", "paid"].includes(job.status)) {
      throw new AppError("Completed jobs cannot be updated", 400);
    }

    const update = {};
    [
      "title",
      "serviceType",
      "serviceId",
      "serviceCategoryId",
      "serviceCategoryLabel",
      "streetAddress",
      "city",
      "state",
      "zipCode",
      "preferredTime",
      "jobSize",
      "priority",
    ].forEach((field) => {
      if (payload[field] !== undefined) {
        update[field] = payload[field];
      }
    });

    if (payload.jobDescription !== undefined || payload.description !== undefined) {
      update.jobDescription = payload.jobDescription || payload.description;
    }

    if (payload.urgency !== undefined) {
      update.urgency = this.normalizeUrgency(payload.urgency);
    }

    if (payload.preferredDate !== undefined) {
      update.preferredDate = payload.preferredDate || null;
    }

    if (payload.photos !== undefined || payload.photoUrls !== undefined) {
      update.photos = payload.photos || payload.photoUrls || [];
    }

    if (payload.estimatedPrice !== undefined || payload.estimatedTotal !== undefined) {
      update.estimatedPrice = Number(payload.estimatedPrice || payload.estimatedTotal || 0);
    }

    if (payload.pricing !== undefined) {
      update.pricing =
        payload.pricing && typeof payload.pricing === "object" ? payload.pricing : {};
    }

    const updatedJob = await jobRepository.updateById(jobId, update);
    return jobRepository.findJobWithRelations(updatedJob._id);
  }

  async cancelJob(user, jobId, reason = "") {
    const job = await jobRepository.findById(jobId);

    if (!job) {
      throw new AppError("Job not found", 404);
    }

    const isAllowed =
      hasRole(user, ROLES.ADMIN) ||
      String(job.customer) === String(user._id) ||
      String(job.assignedWorker || "") === String(user._id);

    if (!isAllowed) {
      throw new AppError("You do not have permission to cancel this job", 403);
    }

    const updatedJob = await jobRepository.updateById(jobId, {
      status: "cancelled",
      cancelReason: reason,
    });

    return jobRepository.findJobWithRelations(updatedJob._id);
  }
}

module.exports = new JobService();
