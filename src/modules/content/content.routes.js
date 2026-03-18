const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const contentController = require("./content.controller");
const {
  authenticate,
  authorize,
  optionalAuthenticate,
} = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.get("/", authenticate, authorize(ROLES.ADMIN), asyncHandler(contentController.listContent));
router.get(
  "/legal-documents",
  optionalAuthenticate,
  asyncHandler(contentController.listLegalDocuments)
);
router.get(
  "/legal-documents/:documentId",
  optionalAuthenticate,
  asyncHandler(contentController.getLegalDocument)
);
router.get("/:key", optionalAuthenticate, asyncHandler(contentController.getContent));
router.patch(
  "/:key",
  authenticate,
  authorize(ROLES.ADMIN),
  asyncHandler(contentController.upsertContent)
);

module.exports = router;
