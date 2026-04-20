const BaseRepository = require("../../utils/base.repository");
const Application = require("./application.model");

class ApplicationRepository extends BaseRepository {
  constructor() {
    super(Application);
  }

  findByJobAndHero(jobId, workerId) {
    return this.findOne({ job: jobId, worker: workerId });
  }

  listByJob(jobId, options = {}) {
    return this.paginate(
      { job: jobId },
      {
        ...options,
        populate: [
          {
            path: "worker",
            select: "name email phone workerStatus skills profilePhotoUrl",
          },
          {
            path: "job",
            select: "title serviceType status",
          },
        ],
      }
    );
  }

  listByHero(workerId, options = {}) {
    return this.paginate(
      { worker: workerId },
      {
        ...options,
        populate: [
          {
            path: "job",
            select:
              "title serviceType streetAddress city zipCode urgency preferredDate preferredTime status estimatedPrice",
          },
        ],
      }
    );
  }
}

module.exports = new ApplicationRepository();
