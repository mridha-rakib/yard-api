const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const authController = require("./auth.controller");
const { authenticate } = require("../../middleware/auth.middleware");

const router = express.Router();

router.post("/register", asyncHandler(authController.register));
router.post("/worker-register", asyncHandler(authController.registerWorker));
router.post("/login", asyncHandler(authController.login));
router.post(
  "/email-verification/request",
  authenticate,
  asyncHandler(authController.requestEmailVerificationCode)
);
router.post(
  "/email-verification/verify",
  authenticate,
  asyncHandler(authController.verifyEmailVerificationCode)
);
router.post(
  "/forgot-password/request",
  asyncHandler(authController.requestPasswordResetCode)
);
router.post(
  "/forgot-password/verify",
  asyncHandler(authController.verifyPasswordResetCode)
);
router.post(
  "/forgot-password/reset",
  asyncHandler(authController.resetPasswordWithToken)
);
router.post("/refresh", asyncHandler(authController.refresh));
router.post("/logout", authenticate, asyncHandler(authController.logout));
router.post("/logout-all", authenticate, asyncHandler(authController.logoutAll));
router.get("/me", authenticate, asyncHandler(authController.me));

module.exports = router;
