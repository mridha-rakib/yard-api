const AppError = require("../../errors/AppError");
const contentRepository = require("./content.repository");

const DEFAULT_LEGAL_DOCS = [
  {
    id: "terms-of-service",
    name: "Terms of Service",
    status: "active",
    body: "",
  },
  {
    id: "privacy-policy",
    name: "Privacy Policy",
    status: "active",
    body: "",
  },
  {
    id: "cookie-policy",
    name: "Cookie Policy",
    status: "active",
    body: "",
  },
  {
    id: "gdpr-compliance",
    name: "GDPR Compliance",
    status: "active",
    body: "",
  },
];

class ContentService {
  normalizeLegalDocuments(documents = [], updatedAt = null) {
    const sourceDocuments =
      Array.isArray(documents) && documents.length ? documents : DEFAULT_LEGAL_DOCS;

    return sourceDocuments.map((document, index) => ({
      id: String(document?.id || DEFAULT_LEGAL_DOCS[index]?.id || `document-${index + 1}`).trim(),
      name: String(
        document?.name || DEFAULT_LEGAL_DOCS[index]?.name || `Document ${index + 1}`
      ).trim(),
      status:
        String(document?.status || DEFAULT_LEGAL_DOCS[index]?.status || "active").toLowerCase() ===
        "inactive"
          ? "inactive"
          : "active",
      body: String(document?.body || "").trim(),
      updatedAt: document?.updatedAt || updatedAt || null,
    }));
  }

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

  async listLegalDocuments(includeInactive = false) {
    const legalDocsEntry = await contentRepository.findByKey("legal-docs");
    const legalDocuments = this.normalizeLegalDocuments(
      legalDocsEntry?.value,
      legalDocsEntry?.updatedAt || null
    );

    if (includeInactive) {
      return legalDocuments;
    }

    return legalDocuments.filter((document) => document.status === "active");
  }

  async getLegalDocument(documentId, includeInactive = false) {
    const legalDocuments = await this.listLegalDocuments(true);
    const legalDocument = legalDocuments.find((document) => document.id === String(documentId || "").trim());

    if (!legalDocument) {
      throw new AppError("Legal document not found", 404);
    }

    if (!includeInactive && legalDocument.status === "inactive") {
      throw new AppError("Legal document not found", 404);
    }

    return legalDocument;
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
