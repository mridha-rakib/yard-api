const Application = require("./application.model");
const Job = require("../job/job.model");

const createApplication = async (user, jobId, coverLetter) => {
  if (user.role !== "worker") {
    throw new Error("Access denied");
  }

  const job = await Job.findById(jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  return await Application.create({
    job: jobId,
    worker: user.id,
    coverLetter,
  });
};

const getApplicationsByJob = async (user, jobId) => {
  if (user.role !== "customer") {
    throw new Error("Access denied");
  }

  return await Application.find({ job: jobId }).populate(
    "worker",
    "name email"
  );
};


const updateApplicationStatus = async (user, applicationId, status) => {
  if (user.role !== "customer") {
    throw new Error("Access denied");
  }

  if (!["accepted", "rejected"].includes(status)) {
    throw new Error("Invalid status");
  }

  const application = await Application.findById(applicationId);
  if (!application) {
    throw new Error("Application not found");
  }

  const job = await Job.findById(application.job);

  // ✅ Ensure Customer owns the job
  if (job.createdBy.toString() !== user.id.toString()) {
    throw new Error("You are not the owner of this job");
  }

  application.status = status;
  await application.save();

  return application;
};

const getMyApplications = async (user) => {
  if (user.role !== "worker") {
    throw new Error("Access denied");
  }

  const applications = await Application.find({
    worker: user.id,
  })
    .populate("job") // job info show করবে
    .sort({ createdAt: -1 });

  return applications;
};

module.exports = {
  createApplication,
  getApplicationsByJob,
  updateApplicationStatus,
  getMyApplications,
};