const mongoose = require("mongoose");
const { JOB_STATUSES, PAYMENT_STATUSES } = require("../../constants/statuses");

const jobSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    assignedWorker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sourcePayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    serviceId: {
      type: String,
      trim: true,
      default: "",
    },
    serviceType: {
      type: String,
      required: true,
      trim: true,
    },
    serviceCategoryId: {
      type: String,
      trim: true,
      default: "",
    },
    serviceCategoryLabel: {
      type: String,
      trim: true,
      default: "",
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    streetAddress: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
      default: "",
    },
    zipCode: {
      type: String,
      required: true,
      trim: true,
    },
    jobDescription: {
      type: String,
      required: true,
      trim: true,
    },
    urgency: {
      type: String,
      enum: ["today", "within24", "flexible", "scheduled"],
      default: "flexible",
    },
    preferredDate: {
      type: Date,
      default: null,
    },
    preferredTime: {
      type: String,
      trim: true,
      default: "",
    },
    jobSize: {
      type: String,
      trim: true,
      default: "",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    estimatedPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    priceQuoted: {
      type: Number,
      default: 0,
      min: 0,
    },
    pricing: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    photos: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: "new",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "pending",
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    cancelReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

jobSchema.index({ sourcePayment: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Job", jobSchema);
