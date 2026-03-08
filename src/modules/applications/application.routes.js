const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const applicationController = require("./application.controller");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.use(authenticate);

router.post(
  "/:jobId",
  authorize(ROLES.WORKER),
  asyncHandler(applicationController.applyToJob)
);
router.get(
  "/job/:jobId",
  authorize(ROLES.CUSTOMER, ROLES.ADMIN),
  asyncHandler(applicationController.listApplicationsForJob)
);
router.get(
  "/my",
  authorize(ROLES.WORKER),
  asyncHandler(applicationController.listMyApplications)
);
router.patch(
  "/:applicationId/status",
  authorize(ROLES.CUSTOMER, ROLES.ADMIN),
  asyncHandler(applicationController.updateApplicationStatus)
);

module.exports = router;
