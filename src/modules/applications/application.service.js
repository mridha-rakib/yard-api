const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const applicationRepository = require("./application.repository");
const jobRepository = require("../jobs/job.repository");
const bookingService = require("../bookings/booking.service");
const notificationService = require("../notifications/notification.service");

class ApplicationService {
  async applyToJob(worker, jobId, payload = {}) {
    if (!hasRole(worker, ROLES.WORKER)) {
      throw new AppError("Only workers can apply to jobs", 403);
    }

    if (worker.workerStatus !== "approved") {
      throw new AppError("Your worker account is awaiting approval", 403);
    }

    const job = await jobRepository.findById(jobId);

    if (!job) {
      throw new AppError("Job not found", 404);
    }

    if (job.status !== "new" || job.assignedWorker) {
      throw new AppError("This job is no longer open for applications", 400);
    }

    const existingApplication = await applicationRepository.findByJobAndWorker(jobId, worker._id);
    if (existingApplication) {
      throw new AppError("You have already applied to this job", 409);
    }

    const application = await applicationRepository.create({
      job: jobId,
      worker: worker._id,
      coverLetter: payload.coverLetter || "",
      proposedPrice: Number(payload.proposedPrice || 0),
    });
    await Promise.allSettled([
      notificationService.createForUser(job.customer, {
        type: "job_application_received",
        recipientRole: ROLES.CUSTOMER,
        category: "application",
        title: "New job application",
        message: `${worker.name} applied to "${job.title}".`,
        link: `/booking-details?jobId=${job._id}`,
        entityType: "application",
        entityId: String(application._id),
        actorUserId: worker._id,
      }),
      notificationService.notifyAdmins({
        type: "job_application_received",
        category: "application",
        title: "New worker application",
        message: `${worker.name} applied to customer job "${job.title}".`,
        link: `/booking/${job._id}`,
        entityType: "application",
        entityId: String(application._id),
        actorUserId: worker._id,
      }),
    ]);

    return applicationRepository.findById(application._id, {
      populate: [
        {
          path: "worker",
          select: "name email phone skills workerStatus",
        },
        {
          path: "job",
        },
      ],
    });
  }

  async listApplicationsForJob(user, jobId, query = {}) {
    const job = await jobRepository.findById(jobId);

    if (!job) {
      throw new AppError("Job not found", 404);
    }

    if (!hasRole(user, ROLES.ADMIN) && String(job.customer) !== String(user._id)) {
      throw new AppError("You do not have permission to view these applications", 403);
    }

    const pagination = buildPagination(query);
    return applicationRepository.listByJob(jobId, pagination);
  }

  async listMyApplications(worker, query = {}) {
    if (!hasRole(worker, ROLES.WORKER)) {
      throw new AppError("Only workers can view their applications", 403);
    }

    const pagination = buildPagination(query);
    return applicationRepository.listByWorker(worker._id, pagination);
  }

  async updateApplicationStatus(user, applicationId, status) {
    const application = await applicationRepository.findById(applicationId, {
      populate: [
        {
          path: "job",
        },
        {
          path: "worker",
          select: "name email phone workerStatus",
        },
      ],
    });

    if (!application) {
      throw new AppError("Application not found", 404);
    }

    const job = application.job;
    const canManageApplication =
      hasRole(user, ROLES.ADMIN) || String(job.customer) === String(user._id);

    if (!canManageApplication) {
      throw new AppError("You do not have permission to update this application", 403);
    }

    if (!["accepted", "rejected"].includes(status)) {
      throw new AppError("Application status must be accepted or rejected", 400);
    }

    const competingApplications =
      status === "accepted"
        ? await applicationRepository.findMany(
            { job: job._id, status: "pending", _id: { $ne: applicationId } },
            { lean: true, select: "worker" }
          )
        : [];

    const updatedApplication = await applicationRepository.updateById(applicationId, {
      status,
    });

    if (status === "accepted") {
      await applicationRepository.updateMany(
        { job: job._id, status: "pending", _id: { $ne: applicationId } },
        { status: "rejected" }
      );

      await bookingService.createBookingFromJob(application.worker, job._id, {
        scheduledDate: job.preferredDate,
        scheduledTime: job.preferredTime,
        notes: "Created from accepted application",
      });
    }

    await Promise.allSettled([
      notificationService.createForUser(application.worker, {
        type: `application_${status}`,
        recipientRole: ROLES.WORKER,
        category: "application",
        title: status === "accepted" ? "Application accepted" : "Application update",
        message:
          status === "accepted"
            ? `Your application for "${job.title}" was accepted.`
            : `Your application for "${job.title}" was not selected.`,
        link: `/all-jobs/job-details?jobId=${job._id}`,
        entityType: "application",
        entityId: String(application._id),
        actorUserId: user._id,
      }),
      ...(status === "accepted"
        ? competingApplications.map((item) =>
            notificationService.createForUser(item.worker, {
              type: "application_rejected",
              recipientRole: ROLES.WORKER,
              category: "application",
              title: "Application update",
              message: `Another worker was selected for "${job.title}".`,
              link: `/all-jobs/job-details?jobId=${job._id}`,
              entityType: "application",
              entityId: String(application._id),
              actorUserId: user._id,
            })
          )
        : []),
    ]);

    return applicationRepository.findById(updatedApplication._id, {
      populate: [
        {
          path: "worker",
          select: "name email phone skills workerStatus",
        },
        {
          path: "job",
        },
      ],
    });
  }
}

module.exports = new ApplicationService();
