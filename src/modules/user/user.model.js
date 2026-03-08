const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
     phone: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "customer", "worker"],
      default: "customer",
    },
    workerStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);