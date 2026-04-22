const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const userController = require("./user.controller");
const { authenticate } = require("../../middleware/auth.middleware");

const router = express.Router();

router.get("/profile", authenticate, asyncHandler(userController.getProfile));
router.patch("/profile", authenticate, asyncHandler(userController.updateProfile));
router.patch("/profile/password", authenticate, asyncHandler(userController.changePassword));
router.get(
  "/profile/payout-account",
  authenticate,
  asyncHandler(userController.getWorkerPayoutAccountStatus)
);
router.post(
  "/profile/payout-account/onboarding-link",
  authenticate,
  asyncHandler(userController.createWorkerPayoutOnboardingLink)
);
router.post(
  "/profile/payout-account/dashboard-link",
  authenticate,
  asyncHandler(userController.createWorkerPayoutDashboardLink)
);
router.get("/:userId", authenticate, asyncHandler(userController.getUserById));

module.exports = router;
