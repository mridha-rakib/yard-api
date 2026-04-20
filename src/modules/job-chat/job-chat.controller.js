const jobChatService = require("./job-chat.service");

class JobChatController {
  async getConversation(req, res) {
    const conversation = await jobChatService.getConversation(req.user, req.params.jobId);
    res.json({ success: true, data: conversation });
  }

  async addMessage(req, res) {
    const conversation = await jobChatService.addMessage(
      req.user,
      req.params.jobId,
      req.body
    );

    res.json({
      success: true,
      message: "Message sent successfully",
      data: conversation,
    });
  }
}

module.exports = new JobChatController();
