const BaseRepository = require("../../utils/base.repository");
const Notification = require("./notification.model");

class NotificationRepository extends BaseRepository {
  constructor() {
    super(Notification);
  }

  countUnread(recipientId) {
    return this.count({
      recipient: recipientId,
      isRead: false,
    });
  }

  findByIdForRecipient(notificationId, recipientId, options = {}) {
    return this.findOne(
      {
        _id: notificationId,
        recipient: recipientId,
      },
      options
    );
  }

  listForRecipient(recipientId, filter = {}, options = {}) {
    return this.paginate(
      {
        recipient: recipientId,
        ...filter,
      },
      options
    );
  }

  async createMany(payloads = []) {
    const items = Array.isArray(payloads) ? payloads.filter(Boolean) : [];

    if (!items.length) {
      return [];
    }

    return this.model.insertMany(items, {
      ordered: false,
    });
  }
}

module.exports = new NotificationRepository();
