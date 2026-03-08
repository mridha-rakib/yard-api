const express = require("express");
const router = express.Router();
const { protect ,authorize} = require("../../middleware/authMiddleware");
const applicationController = require("./application.controller");

// Worker apply
router.post("/:jobId", protect, applicationController.applyToJob);

// Employer view
router.get(
  "/job/:jobId",
  protect,
    authorize("customer"),
  applicationController.viewApplications
);

router.patch(
  "/:applicationId/status",
  protect,
  authorize("customer"),
  applicationController.updateStatus
);

router.get(
  "/my",
  protect,
  authorize("worker"),
  applicationController.getMyApplications
);

module.exports = router;