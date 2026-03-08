const applicationService = require("./application.service");

const applyToJob = async (req, res) => {
  try {
    const application = await applicationService.createApplication(
      req.user,
      req.params.jobId,
      req.body.coverLetter
    );

    res.status(201).json(application);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "You already applied to this job" });
    }

    res.status(400).json({ message: error.message });
  }
};

const viewApplications = async (req, res) => {
  try {
    const applications = await applicationService.getApplicationsByJob(
      req.user,
      req.params.jobId
    );

    res.json(applications);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const application = await applicationService.updateApplicationStatus(
      req.user,
      req.params.applicationId,
      req.body.status
    );

    res.json(application);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getMyApplications = async (req, res) => {
  try {
    const applications = await applicationService.getMyApplications(
      req.user
    );

    res.json(applications);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  applyToJob,
  viewApplications,
    updateStatus,
    getMyApplications,
};