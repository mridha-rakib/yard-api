const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const authController = require("./auth.controller");
const { authenticate } = require("../../middleware/auth.middleware");

const router = express.Router();

router.post("/register", asyncHandler(authController.register));
router.post("/worker-register", asyncHandler(authController.registerWorker));
router.post("/login", asyncHandler(authController.login));
router.post("/refresh", asyncHandler(authController.refresh));
router.post("/logout", authenticate, asyncHandler(authController.logout));
router.post("/logout-all", authenticate, asyncHandler(authController.logoutAll));
router.get("/me", authenticate, asyncHandler(authController.me));

module.exports = router;
