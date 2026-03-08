const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const supportRepository = require("./support.repository");

class SupportService {
  async createConversation(user, payload) {
    const requesterName = payload.name || user?.name;
    const requesterEmail = payload.email || user?.email;

    if (!requesterName || !requesterEmail || !payload.subject || !payload.message) {
      throw new AppError("Name, email, subject, and message are required", 400);
    }

    return supportRepository.create({
      user: user?._id || null,
      requesterName,
      requesterEmail: requesterEmail.toLowerCase(),
      requesterRole: user?.role || "guest",
      subject: payload.subject,
      category: payload.category || "general",
      priority: payload.priority || "medium",
      status: "open",
      messages: [
        {
          senderRole: user?.role || "guest",
          senderName: requesterName,
          message: payload.message,
          attachments: payload.attachments || [],
        },
      ],
      lastMessageAt: new Date(),
    });
  }

  async listConversations(user, query = {}) {
    const pagination = buildPagination(query);
    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search) {
      filter.$or = [
        { subject: { $regex: query.search, $options: "i" } },
        { requesterName: { $regex: query.search, $options: "i" } },
        { requesterEmail: { $regex: query.search, $options: "i" } },
      ];
    }

    if (user.role !== ROLES.ADMIN) {
      filter.user = user._id;
    }

    return supportRepository.paginateConversations(filter, {
      ...pagination,
      sort: { lastMessageAt: -1 },
    });
  }

  async getConversation(user, conversationId) {
    const conversation = await supportRepository.findConversationWithRelations(conversationId);

    if (!conversation) {
      throw new AppError("Support conversation not found", 404);
    }

    const isAllowed =
      user.role === ROLES.ADMIN ||
      (conversation.user && String(conversation.user._id || conversation.user) === String(user._id));

    if (!isAllowed) {
      throw new AppError("You do not have access to this conversation", 403);
    }

    return conversation;
  }

  async addMessage(user, conversationId, payload) {
    const conversation = await this.getConversation(user, conversationId);

    if (!payload.message) {
      throw new AppError("Message is required", 400);
    }

    conversation.messages.push({
      senderRole: user.role,
      senderName: user.name,
      message: payload.message,
      attachments: payload.attachments || [],
    });

    if (user.role === ROLES.ADMIN && conversation.status === "open") {
      conversation.status = "in_progress";
    }

    conversation.lastMessageAt = new Date();
    await conversation.save();

    return supportRepository.findConversationWithRelations(conversationId);
  }

  async updateConversationStatus(user, conversationId, status) {
    if (user.role !== ROLES.ADMIN) {
      throw new AppError("Only admins can update support conversation status", 403);
    }

    const conversation = await supportRepository.findById(conversationId);

    if (!conversation) {
      throw new AppError("Support conversation not found", 404);
    }

    const updatedConversation = await supportRepository.updateById(conversationId, {
      status,
      lastMessageAt: new Date(),
    });

    return supportRepository.findConversationWithRelations(updatedConversation._id);
  }
}

module.exports = new SupportService();
