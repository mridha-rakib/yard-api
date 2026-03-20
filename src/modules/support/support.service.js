const AppError = require("../../errors/AppError");
const buildPagination = require("../../utils/pagination");
const { ROLES } = require("../../constants/roles");
const { hasRole } = require("../../utils/user-roles");
const notificationService = require("../notifications/notification.service");
const supportRepository = require("./support.repository");

const getSupportLinkForRole = (role = "") => {
  if (role === ROLES.CUSTOMER) {
    return "/my-profile";
  }

  if (role === ROLES.WORKER) {
    return "/help-support";
  }

  return "";
};

const formatStatusLabel = (status = "") =>
  String(status || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

class SupportService {
  async createConversation(user, payload) {
    const requesterName = payload.name || user?.name;
    const requesterEmail = payload.email || user?.email;

    if (!requesterName || !requesterEmail || !payload.subject || !payload.message) {
      throw new AppError("Name, email, subject, and message are required", 400);
    }

    const conversation = await supportRepository.create({
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
    await Promise.allSettled([
      notificationService.notifyAdmins({
        type: "support_conversation_created",
        category: "support",
        title: "New support message",
        message: `${requesterName} opened a support conversation: "${payload.subject}".`,
        link: "/support",
        entityType: "support_conversation",
        entityId: String(conversation._id),
        actorUserId: user?._id || null,
        metadata: {
          requesterRole: user?.role || "guest",
        },
      }),
    ]);

    return conversation;
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
        { "messages.message": { $regex: query.search, $options: "i" } },
      ];
    }

    if (!hasRole(user, ROLES.ADMIN)) {
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
      hasRole(user, ROLES.ADMIN) ||
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

    if (hasRole(user, ROLES.ADMIN) && conversation.status === "open") {
      conversation.status = "in_progress";
    } else if (!hasRole(user, ROLES.ADMIN) && conversation.status !== "open") {
      conversation.status = "open";
    }

    conversation.lastMessageAt = new Date();
    await conversation.save();

    const refreshedConversation = await supportRepository.findConversationWithRelations(conversationId);

    if (hasRole(user, ROLES.ADMIN)) {
      if (refreshedConversation?.user) {
        await Promise.allSettled([
          notificationService.createForUser(refreshedConversation.user, {
            type: "support_reply_received",
            category: "support",
            title: "New reply from support",
            message: `Support replied to "${refreshedConversation.subject}".`,
            link: getSupportLinkForRole(refreshedConversation.requesterRole),
            entityType: "support_conversation",
            entityId: String(refreshedConversation._id),
            actorUserId: user._id,
          }),
        ]);
      }
    } else {
      await Promise.allSettled([
        notificationService.notifyAdmins({
          type: "support_reply_received",
          category: "support",
          title: "Support reply received",
          message: `${user.name} replied to "${refreshedConversation.subject}".`,
          link: "/support",
          entityType: "support_conversation",
          entityId: String(refreshedConversation._id),
          actorUserId: user._id,
        }),
      ]);
    }

    return refreshedConversation;
  }

  async updateConversationStatus(user, conversationId, status) {
    if (!hasRole(user, ROLES.ADMIN)) {
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
    const refreshedConversation = await supportRepository.findConversationWithRelations(
      updatedConversation._id
    );

    if (refreshedConversation?.user) {
      await Promise.allSettled([
        notificationService.createForUser(refreshedConversation.user, {
          type: "support_status_updated",
          category: "support",
          title: "Support conversation updated",
          message: `"${refreshedConversation.subject}" is now ${formatStatusLabel(status).toLowerCase()}.`,
          link: getSupportLinkForRole(refreshedConversation.requesterRole),
          entityType: "support_conversation",
          entityId: String(refreshedConversation._id),
          actorUserId: user._id,
        }),
      ]);
    }

    return refreshedConversation;
  }
}

module.exports = new SupportService();
