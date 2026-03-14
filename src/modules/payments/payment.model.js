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

module.exports = mongoose.model("Payment", paymentSchema);
