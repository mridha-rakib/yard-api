const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const jobController = require("./job.controller");
const {
  authenticate,
  authorize,
  optionalAuthenticate,
} = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.get("/", optionalAuthenticate, asyncHandler(jobController.listJobs));
router.get(
  "/available",
  authenticate,
  authorize(ROLES.WORKER, ROLES.ADMIN),
  asyncHandler(jobController.listAvailableJobs)
);
router.get("/my", authenticate, asyncHandler(jobController.listMyJobs));
router.get("/:jobId", optionalAuthenticate, asyncHandler(jobController.getJobById));
router.post(
  "/",
  authenticate,
  authorize(ROLES.CUSTOMER, ROLES.ADMIN),
  asyncHandler(jobController.createJob)
);
router.patch("/:jobId", authenticate, asyncHandler(jobController.updateJob));
router.patch("/:jobId/cancel", authenticate, asyncHandler(jobController.cancelJob));

module.exports = router;
