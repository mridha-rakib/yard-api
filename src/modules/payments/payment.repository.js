const BaseRepository = require("../../utils/base.repository");
const Payment = require("./payment.model");

class PaymentRepository extends BaseRepository {
  constructor() {
    super(Payment);
  }

  buildRelationsPopulate() {
    return [
      {
        path: "job",
        select:
          "title serviceType streetAddress city zipCode status paymentStatus estimatedPrice preferredDate preferredTime",
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
    ];
  }

  findBySessionId(sessionId) {
    return this.findOne({ stripeCheckoutSessionId: sessionId });
  }

  findBySessionIdWithRelations(sessionId) {
    return this.findOne(
      { stripeCheckoutSessionId: sessionId },
      {
        populate: this.buildRelationsPopulate(),
      }
    );
  }

  findByJob(jobId) {
    return this.findOne({ job: jobId });
  }

  paginateWithRelations(filter = {}, options = {}) {
    return this.paginate(filter, {
      ...options,
      populate: this.buildRelationsPopulate(),
    });
  }
}

module.exports = new PaymentRepository();
