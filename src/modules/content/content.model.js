const mongoose = require("mongoose");

const contentSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    body: {
      type: String,
      default: "",
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Content", contentSchema);
