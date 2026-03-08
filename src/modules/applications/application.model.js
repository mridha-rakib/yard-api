const mongoose = require("mongoose");
const { APPLICATION_STATUSES } = require("../../constants/statuses");

const applicationSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    coverLetter: {
      type: String,
      trim: true,
      default: "",
    },
    proposedPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

applicationSchema.index({ job: 1, worker: 1 }, { unique: true });

module.exports = mongoose.model("Application", applicationSchema);
