const Job = require("./job.model");
const jobService = require("./job.service");
// Create Job
const createJob = async (req, res) => {
  try {
    const job = await Job.create({
      ...req.body,
      employer: req.user._id,
    });

    res.status(201).json({
      message: "Job Created Successfully",
      job,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get All Jobs
const getJobs = async (req, res) => {
  try {
    const jobs = await Job.find();

    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getMyJobs = async (req, res) => {
  try {
    const jobs = await jobService.getMyJobsWithStats(req.user);
    res.json(jobs);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
module.exports = { createJob, getJobs,getMyJobs };
