const contentService = require("./content.service");

class ContentController {
  async listContent(req, res) {
    const result = await contentService.listContent(req.query);
    res.json({ success: true, ...result });
  }

  async getContent(req, res) {
    const content = await contentService.getContentByKey(
      req.params.key,
      req.user?.role === "admin"
    );
    res.json({ success: true, data: content });
  }

  async upsertContent(req, res) {
    const content = await contentService.upsertContent(req.params.key, req.body);
    res.json({
      success: true,
      message: "Content updated successfully",
      data: content,
    });
  }
}

module.exports = new ContentController();
