const contentService = require("./content.service");

class ContentController {
  async listContent(req, res) {
    const result = await contentService.listContent(req.query);
    res.json({ success: true, ...result });
  }

  async listLegalDocuments(req, res) {
    const documents = await contentService.listLegalDocuments(req.user?.role === "admin");
    res.json({ success: true, data: documents });
  }

  async getLegalDocument(req, res) {
    const document = await contentService.getLegalDocument(
      req.params.documentId,
      req.user?.role === "admin"
    );
    res.json({ success: true, data: document });
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
