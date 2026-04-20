const AppError = require("../../errors/AppError");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const bookingRepository = require("../bookings/booking.repository");
const jobRepository = require("../jobs/job.repository");
const notificationService = require("../notifications/notification.service");
const jobChatRepository = require("./job-chat.repository");

const getCustomerChatLink = (jobId) => `/booking-details?jobId=${jobId}`;
const getWorkerChatLink = (jobId) => `/all-jobs/job-details?jobId=${jobId}`;

class JobChatService {
  async getConversation(user, jobId) {
    const context = await this.getJobContext(user, jobId);
    return this.ensureConversation(context.job);
  }

  async addMessage(user, jobId, payload = {}) {
    if (hasRole(user, ROLES.ADMIN)) {
      throw new AppError("Admins cannot send messages in worker-customer chat", 403);
    }

    const message = String(payload.message || "").trim();

    if (!message) {
      throw new AppError("Message is required", 400);
    }

    const context = await this.getJobContext(user, jobId);
    const conversation = await this.ensureConversationDocument(context.job);

    conversation.messages.push({
      senderUser: user._id,
      senderRole: user.role,
      senderName: user.name || "YardHero user",
      message,
      attachments: Array.isArray(payload.attachments) ? payload.attachments.filter(Boolean) : [],
    });
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const refreshedConversation = await jobChatRepository.findConversationWithRelations(
      conversation._id
    );
    const jobTitle = refreshedConversation?.job?.title || context.job.title || "your job";
    const recipient =
      user.role === ROLES.CUSTOMER
        ? refreshedConversation?.worker
        : refreshedConversation?.customer;
    const recipientRole = user.role === ROLES.CUSTOMER ? ROLES.WORKER : ROLES.CUSTOMER;
    const recipientLink =
      recipientRole === ROLES.CUSTOMER
        ? getCustomerChatLink(context.job._id)
        : getWorkerChatLink(context.job._id);

    await Promise.allSettled([
      notificationService.createForUser(recipient, {
        type: "job_chat_message_received",
        recipientRole,
        category: "chat",
        title: "New job message",
        message: `${user.name || "Someone"} sent a new message about "${jobTitle}".`,
        link: recipientLink,
        entityType: "job_chat",
        entityId: String(refreshedConversation?._id || conversation._id),
        actorUserId: user._id,
        metadata: {
          jobId: String(context.job._id),
        },
      }),
    ]);

    return refreshedConversation;
  }

  async getJobContext(user, jobId) {
    const job = await jobRepository.findJobWithRelations(jobId);

    if (!job) {
      throw new AppError("Job not found", 404);
    }

    const customerId = String(job.customer?._id || job.customer || "");
    const workerId = String(job.assignedWorker?._id || job.assignedWorker || "");
    const userId = String(user?._id || "");
    const isAdmin = hasRole(user, ROLES.ADMIN);
    const isCustomer = customerId === userId;
    const isWorker = workerId === userId;

    if (!isAdmin && !isCustomer && !isWorker) {
      throw new AppError("You do not have access to this job chat", 403);
    }

    if (!workerId) {
      throw new AppError("Chat becomes available after a Hero accepts this job", 409);
    }

    return {
      job,
      isAdmin,
      isCustomer,
      isWorker,
    };
  }

  async ensureConversation(job) {
    const conversation = await this.ensureConversationDocument(job);
    return jobChatRepository.findConversationWithRelations(conversation._id);
  }

  async ensureConversationDocument(job) {
    const booking = await bookingRepository.findByJob(job._id);
    const workerId = String(job.assignedWorker?._id || job.assignedWorker || "");
    const customerId = String(job.customer?._id || job.customer || "");

    let conversation = await jobChatRepository.findByJob(job._id);

    if (
      conversation &&
      (String(conversation.worker || "") !== workerId ||
        String(conversation.customer || "") !== customerId)
    ) {
      await jobChatRepository.deleteById(conversation._id);
      conversation = null;
    }

    if (!conversation) {
      try {
        conversation = await jobChatRepository.create({
          job: job._id,
          booking: booking?._id || null,
          customer: customerId,
          worker: workerId,
          messages: [],
          lastMessageAt: new Date(),
        });
      } catch (error) {
        if (error?.code === 11000) {
          conversation = await jobChatRepository.findByJob(job._id);
        } else {
          throw error;
        }
      }
    }

    if (!conversation) {
      throw new AppError("We could not prepare the job chat", 500);
    }

    const nextBookingId = String(booking?._id || "");
    const currentBookingId = String(conversation.booking || "");

    if (nextBookingId && nextBookingId !== currentBookingId) {
      conversation.booking = booking._id;
      await conversation.save();
    }

    return conversation;
  }
}

module.exports = new JobChatService();
