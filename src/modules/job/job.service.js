const Job = require("./job.model");
const Application = require("../application/application.model");

const getMyJobsWithStats = async (user) => {
  if (user.role !== "customer") {
    throw new Error("Access denied");
  }

  const jobs = await Job.find({ createdBy: user.id })
    .sort({ createdAt: -1 })
    .lean();

  for (let job of jobs) {
    const stats = await Application.aggregate([
      { $match: { job: job._id } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    job.totalApplications = 0;
    job.accepted = 0;
    job.pending = 0;
    job.rejected = 0;

    stats.forEach((s) => {
      job.totalApplications += s.count;
      job[s._id] = s.count;
    });
  }

  return jobs;
};

module.exports = {
  getMyJobsWithStats,
};