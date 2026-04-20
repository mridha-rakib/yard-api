const BaseRepository = require("../../utils/base.repository");
const JobChatConversation = require("./job-chat.model");

class JobChatRepository extends BaseRepository {
  constructor() {
    super(JobChatConversation);
  }

  findByJob(jobId, options = {}) {
    return this.findOne({ job: jobId }, options);
  }

  findConversationWithRelations(conversationId) {
    return this.findById(conversationId, {
      populate: this.buildPopulateConfig(),
    });
  }

  findConversationWithRelationsByJob(jobId) {
    return this.findByJob(jobId, {
      populate: this.buildPopulateConfig(),
    });
  }

  buildPopulateConfig() {
    return [
      {
        path: "job",
        select:
          "title serviceType serviceCategoryLabel status streetAddress city state zipCode",
      },
      {
        path: "booking",
        select: "status scheduledDate scheduledTime startedAt completedAt verificationSubmittedAt",
      },
      {
        path: "customer",
        select: "name email phone profilePhotoUrl",
      },
      {
        path: "worker",
        select: "name email phone profilePhotoUrl workerBio skills",
      },
    ];
  }
}

module.exports = new JobChatRepository();
