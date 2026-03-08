const BaseRepository = require("../../utils/base.repository");
const SupportConversation = require("./support.model");

class SupportRepository extends BaseRepository {
  constructor() {
    super(SupportConversation);
  }

  findConversationWithRelations(conversationId) {
    return this.findById(conversationId, {
      populate: [
        {
          path: "user",
          select: "name email phone role",
        },
      ],
    });
  }

  paginateConversations(filter = {}, options = {}) {
    return this.paginate(filter, {
      ...options,
      populate: [
        {
          path: "user",
          select: "name email phone role",
        },
      ],
    });
  }
}

module.exports = new SupportRepository();
