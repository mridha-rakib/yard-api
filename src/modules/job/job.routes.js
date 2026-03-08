const express = require("express");
const router = express.Router();

const { createJob, getJobs } = require("./job.controller");
const { protect, authorize } = require("../../middleware/authMiddleware");
const jobController = require("./job.controller");

// 🔥 Job Create (Employer + Admin only)
router.post("/", protect, authorize("customer", "admin"), createJob);

// 🔥 Get All Jobs (Public)
router.get("/", getJobs);

router.get("/my", protect, authorize("customer"), jobController.getMyJobs);

module.exports = router;