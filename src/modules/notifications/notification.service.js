const contentRepository = require("../content/content.repository");
const notificationRepository = require("./notification.repository");
const userRepository = require("../users/user.repository");
const AppError = require("../../errors/AppError");
const { ROLES } = require("../../constants/roles");
const { buildRoleMembershipFilter, combineMongoFilters } = require("../../utils/user-roles");

const DEFAULT_ADMIN_NOTIFICATION_SETTINGS = {
  newUserRegistrations: true,
  serviceCompletions: true,
  paymentIssues: true,
};

class NotificationService {
  async listNotifications(user, query = {}) {
    const readFilter = String(query.read || "all").trim().toLowerCase();
    const filter = {};

    if (readFilter === "read") {
      filter.isRead = true;
    } else if (readFilter === "unread") {
      filter.isRead = false;
    }

    const result = await notificationRepository.listForRecipient(user._id, filter, {
      page: query.page || 1,
      limit: query.limit || 10,
      sort: { createdAt: -1 },
      lean: true,
    });
    const unreadCount = await notificationRepository.countUnread(user._id);

    return {
      ...result,
      summary: {
        unreadCount,
      },
    };
  }

  async markAsRead(user, notificationId) {
    const notification = await notificationRepository.findByIdForRecipient(notificationId, user._id);

    if (!notification) {
      throw new AppError("Notification not found", 404);
    }

    if (notification.isRead) {
      return notification;
    }

    return notificationRepository.updateById(notification._id, {
      isRead: true,
      readAt: new Date(),
    });
  }

  async markAllAsRead(user) {
    const result = await notificationRepository.updateMany(
      {
        recipient: user._id,
        isRead: false,
      },
      {
        isRead: true,
        readAt: new Date(),
      }
    );

    return {
      updatedCount: Number(result?.modifiedCount || result?.nModified || 0),
    };
  }

  async createForUser(recipient, payload = {}) {
    const recipientId = String(recipient?._id || recipient || "").trim();

    if (!recipientId || !payload?.title || !payload?.message) {
      return null;
    }

    const recipientRole = String(payload.recipientRole || recipient?.role || "").trim().toLowerCase();

    return notificationRepository.create({
      recipient: recipientId,
      recipientRole,
      actorUser: payload.actorUserId || null,
      type: String(payload.type || "general").trim(),
      category: String(payload.category || "system").trim(),
      title: String(payload.title || "").trim(),
      message: String(payload.message || "").trim(),
      link: String(payload.link || "").trim(),
      entityType: String(payload.entityType || "").trim(),
      entityId: String(payload.entityId || "").trim(),
      metadata: payload.metadata || {},
    });
  }

  async createForUsers(recipients = [], payload = {}) {
    const preparedPayloads = recipients
      .map((recipient) => {
        const recipientId = String(recipient?._id || recipient || "").trim();

        if (!recipientId || !payload?.title || !payload?.message) {
          return null;
        }

        return {
          recipient: recipientId,
          recipientRole: String(payload.recipientRole || recipient?.role || "").trim().toLowerCase(),
          actorUser: payload.actorUserId || null,
          type: String(payload.type || "general").trim(),
          category: String(payload.category || "system").trim(),
          title: String(payload.title || "").trim(),
          message: String(payload.message || "").trim(),
          link: String(payload.link || "").trim(),
          entityType: String(payload.entityType || "").trim(),
          entityId: String(payload.entityId || "").trim(),
          metadata: payload.metadata || {},
        };
      })
      .filter(Boolean);

    return notificationRepository.createMany(preparedPayloads);
  }

  async getAdminNotificationSettings() {
    const settingsEntry = await contentRepository.findByKey("notification-settings");

    return {
      ...DEFAULT_ADMIN_NOTIFICATION_SETTINGS,
      ...(settingsEntry?.value || {}),
    };
  }

  async notifyAdmins(payload = {}, options = {}) {
    if (options.preferenceKey) {
      const settings = await this.getAdminNotificationSettings();

      if (!settings[options.preferenceKey]) {
        return [];
      }
    }

    const admins = await userRepository.findMany(
      combineMongoFilters(
        { isDeleted: { $ne: true }, status: "active" },
        buildRoleMembershipFilter(ROLES.ADMIN)
      ),
      {
        lean: true,
        select: "_id role",
      }
    );
    const excludedUserIds = new Set(
      (Array.isArray(options.excludeUserIds) ? options.excludeUserIds : [options.excludeUserIds])
        .filter(Boolean)
        .map((value) => String(value))
    );
    const recipients = admins.filter((admin) => !excludedUserIds.has(String(admin._id)));

    if (!recipients.length) {
      return [];
    }

    return this.createForUsers(recipients, {
      ...payload,
      recipientRole: ROLES.ADMIN,
    });
  }
}

module.exports = new NotificationService();
