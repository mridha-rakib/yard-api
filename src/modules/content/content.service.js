const AppError = require("../../errors/AppError");
const contentRepository = require("./content.repository");

class ContentService {
  async listContent(query = {}) {
    const filter = {};

    if (query.isPublic !== undefined) {
      filter.isPublic = query.isPublic === "true";
    }

    return contentRepository.paginate(filter, {
      page: query.page || 1,
      limit: query.limit || 20,
      sort: { updatedAt: -1 },
    });
  }

  async getContentByKey(key, includePrivate = false) {
    const content = await contentRepository.findByKey(key);

    if (!content) {
      throw new AppError("Content entry not found", 404);
    }

    if (!includePrivate && !content.isPublic) {
      throw new AppError("Content entry is private", 403);
    }

    return content;
  }

  async upsertContent(key, payload) {
    const existingEntry = await contentRepository.findByKey(key);

    if (existingEntry) {
      return contentRepository.updateById(existingEntry._id, {
        title: payload.title ?? existingEntry.title,
        body: payload.body ?? existingEntry.body,
        value: payload.value ?? existingEntry.value,
        isPublic: payload.isPublic ?? existingEntry.isPublic,
      });
    }

    return contentRepository.create({
      key,
      title: payload.title || "",
      body: payload.body || "",
      value: payload.value ?? null,
      isPublic: Boolean(payload.isPublic),
    });
  }
}

module.exports = new ContentService();
