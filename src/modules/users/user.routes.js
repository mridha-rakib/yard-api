const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const userController = require("./user.controller");
const { authenticate } = require("../../middleware/auth.middleware");

const router = express.Router();

router.get("/profile", authenticate, asyncHandler(userController.getProfile));
router.patch("/profile", authenticate, asyncHandler(userController.updateProfile));
router.get("/:userId", authenticate, asyncHandler(userController.getUserById));

module.exports = router;
