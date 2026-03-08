const jobService = require("./job.service");

class JobController {
  async createJob(req, res) {
    const job = await jobService.createJob(req.user, req.body);
    res.status(201).json({
      success: true,
      message: "Job created successfully",
      data: job,
    });
  }

  async listJobs(req, res) {
    const result = await jobService.listJobs(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async listAvailableJobs(req, res) {
    const result = await jobService.listAvailableJobs(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async listMyJobs(req, res) {
    const result = await jobService.listMyJobs(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async getJobById(req, res) {
    const job = await jobService.getJobById(req.user, req.params.jobId);
    res.json({ success: true, data: job });
  }

  async updateJob(req, res) {
    const job = await jobService.updateJob(req.user, req.params.jobId, req.body);
    res.json({
      success: true,
      message: "Job updated successfully",
      data: job,
    });
  }

  async cancelJob(req, res) {
    const job = await jobService.cancelJob(req.user, req.params.jobId, req.body.reason);
    res.json({
      success: true,
      message: "Job cancelled successfully",
      data: job,
    });
  }
}

module.exports = new JobController();
