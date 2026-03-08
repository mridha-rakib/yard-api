const BaseRepository = require("../../utils/base.repository");
const Job = require("./job.model");

class JobRepository extends BaseRepository {
  constructor() {
    super(Job);
  }

  findJobWithRelations(jobId) {
    return this.findById(jobId, {
      populate: [
        {
          path: "customer",
          select: "name email phone profilePhotoUrl",
        },
        {
          path: "assignedWorker",
          select: "name email phone workerStatus skills profilePhotoUrl availability",
        },
      ],
    });
  }

  findManyWithRelations(filter = {}, options = {}) {
    return this.paginate(filter, {
      ...options,
      populate: [
        {
          path: "customer",
          select: "name email phone",
        },
        {
          path: "assignedWorker",
          select: "name email phone workerStatus skills",
        },
      ],
    });
  }
}

module.exports = new JobRepository();
