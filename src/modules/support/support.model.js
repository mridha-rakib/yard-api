const mongoose = require("mongoose");
const { SUPPORT_ROLES, SUPPORT_STATUSES } = require("../../constants/statuses");

const supportMessageSchema = new mongoose.Schema(
  {
    senderRole: {
      type: String,
      enum: SUPPORT_ROLES,
      required: true,
    },
    senderName: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: {
      type: [String],
      default: [],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const supportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    requesterName: {
      type: String,
      required: true,
      trim: true,
    },
    requesterEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    requesterRole: {
      type: String,
      enum: SUPPORT_ROLES,
      default: "guest",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      default: "general",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    status: {
      type: String,
      enum: SUPPORT_STATUSES,
      default: "open",
      index: true,
    },
    messages: {
      type: [supportMessageSchema],
      default: [],
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

supportSchema.index({ status: 1, lastMessageAt: -1 });
supportSchema.index({ user: 1, status: 1, lastMessageAt: -1 });

module.exports = mongoose.model("SupportConversation", supportSchema);
