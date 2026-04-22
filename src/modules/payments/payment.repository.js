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
          "title serviceType serviceId serviceCategoryLabel streetAddress city zipCode status paymentStatus estimatedPrice preferredDate preferredTime pricing",
      },
      {
        path: "booking",
        select:
          "status scheduledDate scheduledTime completedAt verificationSubmittedAt verificationApprovedAt verificationPhotoUrls verificationVideoUrl verificationNotes",
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

  findByChargeId(chargeId, options = {}) {
    return this.findOne(
      { stripeChargeId: chargeId },
      options
    );
  }

  findByDisputeId(disputeId, options = {}) {
    return this.findOne(
      { stripeDisputeId: disputeId },
      options
    );
  }

  findPendingStripePaymentsForRepair(cutoffDate, limit = 10) {
    return this.model
      .find({
        status: "pending",
        gateway: "stripe",
        stripeCheckoutSessionId: { $exists: true, $ne: "" },
        createdAt: { $lte: cutoffDate },
      })
      .sort({ createdAt: 1 })
      .limit(limit);
  }

  acquireReconciliationLock(paymentId, staleBefore) {
    return this.model.findOneAndUpdate(
      {
        _id: paymentId,
        $or: [
          { reconciliationLockedAt: null },
          { reconciliationLockedAt: { $lt: staleBefore } },
        ],
      },
      {
        reconciliationLockedAt: new Date(),
      },
      {
        new: true,
        runValidators: true,
      }
    );
  }

  releaseReconciliationLock(paymentId) {
    return this.model.findByIdAndUpdate(
      paymentId,
      { reconciliationLockedAt: null },
      { new: true, runValidators: true }
    );
  }

  findByJob(jobId, options = {}) {
    return this.findOne({ job: jobId }, options);
  }

  listForDashboard(filter = {}, options = {}) {
    const {
      page = 1,
      limit = 10,
      search = "",
      exactDate = "",
      dateRangeStart = null,
      includeSummary = true,
    } = options;
    const safePage = Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number(limit) > 0 ? Number(limit) : 10;
    const skip = (safePage - 1) * safeLimit;
    const normalizedSearch = String(search || "").trim();
    const searchRegex = normalizedSearch
      ? normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : "";
    const pipeline = [
      { $match: filter },
      {
        $addFields: {
          paymentTimestamp: {
            $ifNull: [
              "$refundedAt",
              {
                $ifNull: [
                  "$paidAt",
                  {
                    $ifNull: ["$authorizedAt", "$createdAt"],
                  },
                ],
              },
            ],
          },
          paymentIdString: { $toString: "$_id" },
        },
      },
      ...(exactDate
        ? [
            {
              $match: {
                $expr: {
                  $eq: [
                    {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: "$paymentTimestamp",
                      },
                    },
                    exactDate,
                  ],
                },
              },
            },
          ]
        : []),
      ...(dateRangeStart
        ? [
            {
              $match: {
                paymentTimestamp: { $gte: dateRangeStart },
              },
            },
          ]
        : []),
      {
        $lookup: {
          from: "jobs",
          localField: "job",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                title: 1,
                serviceType: 1,
                streetAddress: 1,
                city: 1,
                zipCode: 1,
                preferredDate: 1,
                preferredTime: 1,
              },
            },
          ],
          as: "job",
        },
      },
      {
        $lookup: {
          from: "bookings",
          localField: "booking",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                scheduledDate: 1,
                scheduledTime: 1,
              },
            },
          ],
          as: "booking",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "customer",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                name: 1,
                email: 1,
                phone: 1,
              },
            },
          ],
          as: "customer",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "worker",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                name: 1,
                email: 1,
                phone: 1,
              },
            },
          ],
          as: "worker",
        },
      },
      {
        $addFields: {
          job: { $arrayElemAt: ["$job", 0] },
          booking: { $arrayElemAt: ["$booking", 0] },
          customer: { $arrayElemAt: ["$customer", 0] },
          worker: { $arrayElemAt: ["$worker", 0] },
        },
      },
      {
        $addFields: {
          jobIdString: {
            $cond: [{ $ifNull: ["$job._id", false] }, { $toString: "$job._id" }, ""],
          },
        },
      },
      ...(normalizedSearch
        ? [
            {
              $match: {
                $or: [
                  { paymentIdString: { $regex: searchRegex, $options: "i" } },
                  { jobIdString: { $regex: searchRegex, $options: "i" } },
                  { stripePaymentIntentId: { $regex: searchRegex, $options: "i" } },
                  { stripeCheckoutSessionId: { $regex: searchRegex, $options: "i" } },
                  { description: { $regex: searchRegex, $options: "i" } },
                  { "job.title": { $regex: searchRegex, $options: "i" } },
                  { "job.serviceType": { $regex: searchRegex, $options: "i" } },
                  { "customer.name": { $regex: searchRegex, $options: "i" } },
                  { "customer.email": { $regex: searchRegex, $options: "i" } },
                  { "worker.name": { $regex: searchRegex, $options: "i" } },
                  { "worker.email": { $regex: searchRegex, $options: "i" } },
                ],
              },
            },
          ]
        : []),
      {
        $facet: {
          items: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: safeLimit },
            {
              $project: {
                amount: 1,
                currency: 1,
                platformFeePercentage: 1,
                platformFee: 1,
                workerPayout: 1,
                status: 1,
                gateway: 1,
                paymentMethod: 1,
                stripeCheckoutSessionId: 1,
                stripePaymentIntentId: 1,
                stripeRefundAmount: 1,
                stripeRefundStatus: 1,
                refundedAt: 1,
                refundReason: 1,
                refundFailureReason: 1,
                stripeDisputeId: 1,
                stripeDisputeStatus: 1,
                stripeDisputeReason: 1,
                stripeDisputeAmount: 1,
                stripeDisputeEvidenceDueBy: 1,
                stripeDisputeSubmittedAt: 1,
                stripeDisputeLastAction: 1,
                stripeDisputeOutcome: 1,
                paidAt: 1,
                authorizedAt: 1,
                createdAt: 1,
                customer: 1,
                worker: 1,
                job: 1,
                booking: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
          ...(includeSummary
            ? {
                summary: [
                  {
                    $group: {
                      _id: null,
                      totalAmount: { $sum: { $ifNull: ["$amount", 0] } },
                      totalPlatformFee: { $sum: { $ifNull: ["$platformFee", 0] } },
                      totalHeroPayout: { $sum: { $ifNull: ["$workerPayout", 0] } },
                      pendingPayments: {
                        $sum: {
                          $cond: [
                            { $in: ["$status", ["pending", "authorized"]] },
                            { $ifNull: ["$amount", 0] },
                            0,
                          ],
                        },
                      },
                      pendingCount: {
                        $sum: {
                          $cond: [{ $in: ["$status", ["pending", "authorized"]] }, 1, 0],
                        },
                      },
                      paidCount: {
                        $sum: {
                          $cond: [{ $eq: ["$status", "paid"] }, 1, 0],
                        },
                      },
                      totalCount: { $sum: 1 },
                    },
                  },
                ],
              }
            : {}),
        },
      },
    ];

    return this.model.aggregate(pipeline).allowDiskUse(true);
  }

  paginateWithRelations(filter = {}, options = {}) {
    return this.paginate(filter, {
      ...options,
      populate: this.buildRelationsPopulate(),
    });
  }
}

module.exports = new PaymentRepository();
