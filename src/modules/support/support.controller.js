const supportService = require("./support.service");

class SupportController {
  async createConversation(req, res) {
    const conversation = await supportService.createConversation(req.user, req.body);
    res.status(201).json({
      success: true,
      message: "Support conversation created successfully",
      data: conversation,
    });
  }

  async listConversations(req, res) {
    const result = await supportService.listConversations(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async getConversation(req, res) {
    const conversation = await supportService.getConversation(req.user, req.params.conversationId);
    res.json({ success: true, data: conversation });
  }

  async addMessage(req, res) {
    const conversation = await supportService.addMessage(
      req.user,
      req.params.conversationId,
      req.body
    );
    res.json({ success: true, message: "Message sent successfully", data: conversation });
  }

  async updateConversationStatus(req, res) {
    const conversation = await supportService.updateConversationStatus(
      req.user,
      req.params.conversationId,
      req.body.status
    );
    res.json({
      success: true,
      message: "Support conversation updated successfully",
      data: conversation,
    });
  }
}

module.exports = new SupportController();
