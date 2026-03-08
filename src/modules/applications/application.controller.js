const applicationService = require("./application.service");

class ApplicationController {
  async applyToJob(req, res) {
    const application = await applicationService.applyToJob(
      req.user,
      req.params.jobId,
      req.body
    );

    res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      data: application,
    });
  }

  async listApplicationsForJob(req, res) {
    const result = await applicationService.listApplicationsForJob(
      req.user,
      req.params.jobId,
      req.query
    );

    res.json({ success: true, ...result });
  }

  async listMyApplications(req, res) {
    const result = await applicationService.listMyApplications(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async updateApplicationStatus(req, res) {
    const application = await applicationService.updateApplicationStatus(
      req.user,
      req.params.applicationId,
      req.body.status
    );

    res.json({
      success: true,
      message: "Application status updated",
      data: application,
    });
  }
}

module.exports = new ApplicationController();
