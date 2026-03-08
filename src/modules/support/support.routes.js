const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const supportController = require("./support.controller");
const {
  authenticate,
  authorize,
  optionalAuthenticate,
} = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.post(
  "/conversations",
  optionalAuthenticate,
  asyncHandler(supportController.createConversation)
);
router.get("/conversations", authenticate, asyncHandler(supportController.listConversations));
router.get(
  "/conversations/:conversationId",
  authenticate,
  asyncHandler(supportController.getConversation)
);
router.post(
  "/conversations/:conversationId/messages",
  authenticate,
  asyncHandler(supportController.addMessage)
);
router.patch(
  "/conversations/:conversationId/status",
  authenticate,
  authorize(ROLES.ADMIN),
  asyncHandler(supportController.updateConversationStatus)
);

module.exports = router;
