const BaseRepository = require("../../utils/base.repository");
const Payment = require("./payment.model");

class PaymentRepository extends BaseRepository {
  constructor() {
    super(Payment);
  }

  findBySessionId(sessionId) {
    return this.findOne({ stripeCheckoutSessionId: sessionId });
  }

  findByJob(jobId) {
    return this.findOne({ job: jobId });
  }

  paginateWithRelations(filter = {}, options = {}) {
    return this.paginate(filter, {
      ...options,
      populate: [
        {
          path: "job",
          select:
            "title serviceType streetAddress city zipCode status paymentStatus estimatedPrice assignedWorker",
        },
        {
          path: "booking",
          select: "status scheduledDate scheduledTime completedAt",
        },
        {
          path: "customer",
          select: "name email phone",
        },
        {
          path: "worker",
          select: "name email phone",
        },
      ],
    });
  }
}

module.exports = new PaymentRepository();
