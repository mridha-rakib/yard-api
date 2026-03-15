const mongoose = require("mongoose");

const OTP_PURPOSES = ["verify_email", "reset_password"];

const authOtpSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: OTP_PURPOSES,
      required: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
      index: true,
    },
    verifyAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    resetTokenHash: {
      type: String,
      trim: true,
      default: "",
    },
    resetTokenExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

authOtpSchema.index({ email: 1, purpose: 1, createdAt: -1 });

module.exports = {
  AuthOtp: mongoose.model("AuthOtp", authOtpSchema),
  OTP_PURPOSES,
};
