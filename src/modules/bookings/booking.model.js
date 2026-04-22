const mongoose = require("mongoose");
const { BOOKING_STATUSES } = require("../../constants/statuses");

const bookingSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
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
      required: true,
      index: true,
    },
    scheduledDate: {
      type: Date,
      default: null,
    },
    scheduledTime: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "assigned",
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    workerCompletionNotes: {
      type: String,
      trim: true,
      default: "",
    },
    verificationPhotoUrls: {
      type: [String],
      default: [],
    },
    verificationVideoUrl: {
      type: String,
      trim: true,
      default: "",
    },
    verificationSubmittedAt: {
      type: Date,
      default: null,
    },
    verificationReviewedAt: {
      type: Date,
      default: null,
    },
    verificationApprovedAt: {
      type: Date,
      default: null,
    },
    verificationApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verificationNotes: {
      type: String,
      trim: true,
      default: "",
    },
    cancelReason: {
      type: String,
      trim: true,
      default: "",
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

bookingSchema.index({ job: 1 }, { unique: true });
bookingSchema.index({ worker: 1, status: 1, createdAt: -1 });
bookingSchema.index({ customer: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Booking", bookingSchema);
