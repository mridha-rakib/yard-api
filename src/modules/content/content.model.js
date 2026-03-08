const mongoose = require("mongoose");

const contentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["terms", "privacy"]
  },
  content: String
}, { timestamps: true });

module.exports = mongoose.model("Content", contentSchema);