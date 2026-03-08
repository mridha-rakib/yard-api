const mongoose = require("mongoose");

const supportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  sender: {
    type: String,
    enum: ["user", "admin"]
  },
  message: String
}, { timestamps: true });

module.exports = mongoose.model("Support", supportSchema);