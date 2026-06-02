const mongoose = require("mongoose");
const { PAYMENT_METHODS, PAYMENT_STATUSES } = require("../../constants/statuses");

const paymentSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
      index: true,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    jobSubtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    bookingFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
      uppercase: true,
      trim: true,
    },
    platformFeePercentage: {
      type: Number,
      default: 12,
      min: 0,
    },
    platformFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    workerPayout: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "pending",
      index: true,
    },
    gateway: {
      type: String,
      default: "stripe",
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "unknown",
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    stripeCheckoutSessionId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeCustomerId: {
      type: String,
      trim: true,
      default: "",
    },
    stripePaymentMethodId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeChargeId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    stripeTransferGroup: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    stripeTransferId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLatestTransferReversalId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeTransferReversedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    stripeTransferReversedAt: {
      type: Date,
      default: null,
    },
    stripeTransferAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    stripeTransferDestinationAccountId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLastEventId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLastEventType: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLastSyncedAt: {
      type: Date,
      default: null,
    },
    stripeLatestRefundId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeRefundStatus: {
      type: String,
      trim: true,
      default: "",
    },
    stripeRefundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundedAt: {
      type: Date,
      default: null,
    },
    refundReason: {
      type: String,
      trim: true,
      default: "",
    },
    refundFailureReason: {
      type: String,
      trim: true,
      default: "",
    },
    stripeDisputeId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    stripeDisputeStatus: {
      type: String,
      trim: true,
      default: "",
    },
    stripeDisputeReason: {
      type: String,
      trim: true,
      default: "",
    },
    stripeDisputeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    stripeDisputeEvidenceDueBy: {
      type: Date,
      default: null,
    },
    stripeDisputeSubmittedAt: {
      type: Date,
      default: null,
    },
    stripeDisputeLastAction: {
      type: String,
      trim: true,
      default: "",
    },
    stripeDisputeLastActionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    stripeDisputeFundsWithdrawnAt: {
      type: Date,
      default: null,
    },
    stripeDisputeClosedAt: {
      type: Date,
      default: null,
    },
    stripeDisputeOutcome: {
      type: String,
      trim: true,
      default: "",
    },
    checkoutUrl: {
      type: String,
      trim: true,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    paidAt: {
      type: Date,
      default: null,
    },
    authorizedAt: {
      type: Date,
      default: null,
    },
    authorizationExpiresAt: {
      type: Date,
      default: null,
    },
    captureAttemptedAt: {
      type: Date,
      default: null,
    },
    lastCaptureError: {
      type: String,
      trim: true,
      default: "",
    },
    workerTransferStatus: {
      type: String,
      enum: [
        "pending",
        "not_ready",
        "pending_transfer",
        "transferred",
        "paid_out",
        "failed",
      ],
      default: "pending",
    },
    workerTransferFailedAt: {
      type: Date,
      default: null,
    },
    workerTransferredAt: {
      type: Date,
      default: null,
    },
    workerLastPayoutAt: {
      type: Date,
      default: null,
    },
    workerLastPayoutFailure: {
      type: String,
      trim: true,
      default: "",
    },
    reconciliationLockedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastRepairAttemptAt: {
      type: Date,
      default: null,
    },
    lastRepairError: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

paymentSchema.index({ customer: 1, status: 1, createdAt: -1 });
paymentSchema.index({ worker: 1, status: 1, createdAt: -1 });
paymentSchema.index({ status: 1, amount: 1, platformFee: 1, bookingFee: 1, workerPayout: 1 });
paymentSchema.index({ status: 1, paidAt: -1, createdAt: -1 });
paymentSchema.index({ status: 1, paymentMethod: 1, createdAt: -1 });
paymentSchema.index({ gateway: 1, status: 1, paymentMethod: 1, createdAt: -1 });
paymentSchema.index({ job: 1, status: 1, createdAt: -1 });
paymentSchema.index({ booking: 1, status: 1, createdAt: -1 });
paymentSchema.index({ stripeRefundStatus: 1, createdAt: -1 });
paymentSchema.index({ stripeDisputeStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
