const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    // Service Info
    serviceType: {
      type: String,
      required: true,
    },

    // Contact Details
    fullName: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },

    // Location
    streetAddress: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: true,
    },
    zipCode: {
      type: String,
      required: true,
    },

    jobDescription: {
      type: String,
      required: true,
    },

    // Timing
    urgency: {
      type: String,
      enum: ["today", "within24hours", "flexible"],
      default: "flexible",
    },

    preferredDate: {
      type: Date,
    },

    preferredTime: {
      type: String,
    },

    // Photo Upload (later cloud storage add করবো)
    photos: [
      {
        type: String, // image URL
      },
    ],

    // Job Owner
    employer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isPaid: {
  type: Boolean,
  default: false
}
  },
  { timestamps: true }
);

module.exports = mongoose.model("Job", jobSchema);