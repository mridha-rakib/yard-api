const mongoose = require("mongoose");

const stripeWebhookEventSchema = new mongoose.Schema(
  {
    stripeEventId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
    status: {
      type: String,
      enum: ["pending", "processing", "processed", "failed"],
      default: "pending",
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    processingLockedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastError: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

stripeWebhookEventSchema.index({ status: 1, receivedAt: 1 });

module.exports = mongoose.model("StripeWebhookEvent", stripeWebhookEventSchema);
