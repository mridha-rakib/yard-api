const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const notificationController = require("./notification.controller");
const { authenticate } = require("../../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/", asyncHandler(notificationController.listNotifications));
router.patch("/read-all", asyncHandler(notificationController.markAllAsRead));
router.patch("/:notificationId/read", asyncHandler(notificationController.markAsRead));

module.exports = router;
