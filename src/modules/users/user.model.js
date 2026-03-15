const mongoose = require("mongoose");
const { ROLE_VALUES, ROLES } = require("../../constants/roles");
const { USER_STATUSES, WORKER_STATUSES } = require("../../constants/statuses");

const availabilitySchema = new mongoose.Schema(
  {
    label: {
      type: String,
      trim: true,
      default: "",
    },
    days: {
      type: [String],
      default: [],
    },
    startTime: {
      type: String,
      default: "",
    },
    endTime: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    addressLine1: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "",
    },
    state: {
      type: String,
      trim: true,
      default: "",
    },
    zipCode: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ROLE_VALUES,
      default: ROLES.CUSTOMER,
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: "active",
    },
    workerStatus: {
      type: String,
      enum: WORKER_STATUSES,
      default: "not_applicable",
    },
    age: {
      type: Number,
      min: 13,
      max: 100,
    },
    location: {
      type: locationSchema,
      default: () => ({}),
    },
    skills: {
      type: [String],
      default: [],
    },
    availability: {
      type: availabilitySchema,
      default: () => ({}),
    },
    profilePhotoUrl: {
      type: String,
      trim: true,
      default: "",
    },
    idDocumentUrl: {
      type: String,
      trim: true,
      default: "",
    },
    lastLoginAt: {
      type: Date,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
