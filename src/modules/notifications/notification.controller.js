const notificationService = require("./notification.service");

class NotificationController {
  async listNotifications(req, res) {
    const result = await notificationService.listNotifications(req.user, req.query);
    res.json({
      success: true,
      items: result.items,
      pagination: result.pagination,
      summary: result.summary,
    });
  }

  async markAsRead(req, res) {
    const notification = await notificationService.markAsRead(req.user, req.params.notificationId);
    res.json({
      success: true,
      message: "Notification marked as read",
      data: notification,
    });
  }

  async markAllAsRead(req, res) {
    const result = await notificationService.markAllAsRead(req.user);
    res.json({
      success: true,
      message: "Notifications marked as read",
      data: result,
    });
  }
}

module.exports = new NotificationController();
