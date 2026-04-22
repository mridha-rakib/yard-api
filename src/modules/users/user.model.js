const mongoose = require("mongoose");
const { ROLE_VALUES, ROLES } = require("../../constants/roles");
const { USER_STATUSES, WORKER_STATUSES } = require("../../constants/statuses");
const { getPrimaryRole, getUserRoles } = require("../../utils/user-roles");

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

const portfolioItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      trim: true,
      default: "",
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    serviceType: {
      type: String,
      trim: true,
      default: "",
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    completedAt: {
      type: Date,
      default: null,
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
    roles: {
      type: [String],
      enum: ROLE_VALUES,
      default: undefined,
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
    workerBio: {
      type: String,
      trim: true,
      default: "",
    },
    portfolioItems: {
      type: [portfolioItemSchema],
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
    stripeConnectedAccountId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    stripeConnectCountry: {
      type: String,
      trim: true,
      uppercase: true,
      default: "US",
    },
    stripeConnectBusinessType: {
      type: String,
      enum: ["individual", "company", "non_profit", "government_entity"],
      default: "individual",
    },
    stripeConnectDefaultCurrency: {
      type: String,
      trim: true,
      lowercase: true,
      default: "usd",
    },
    stripeConnectDetailsSubmitted: {
      type: Boolean,
      default: false,
    },
    stripeConnectChargesEnabled: {
      type: Boolean,
      default: false,
    },
    stripeConnectPayoutsEnabled: {
      type: Boolean,
      default: false,
    },
    stripeConnectRequirementsDue: {
      type: [String],
      default: [],
    },
    stripeConnectDisabledReason: {
      type: String,
      trim: true,
      default: "",
    },
    stripeConnectOnboardingCompletedAt: {
      type: Date,
      default: null,
    },
    stripeConnectLastSyncedAt: {
      type: Date,
      default: null,
    },
    stripeExternalAccountId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeExternalAccountBankName: {
      type: String,
      trim: true,
      default: "",
    },
    stripeExternalAccountLast4: {
      type: String,
      trim: true,
      default: "",
    },
    stripeExternalAccountCurrency: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    stripeLastPayoutId: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLastPayoutStatus: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLastPayoutFailureCode: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLastPayoutFailureMessage: {
      type: String,
      trim: true,
      default: "",
    },
    stripeLastPayoutArrivalDate: {
      type: Date,
      default: null,
    },
    stripeLastPayoutUpdatedAt: {
      type: Date,
      default: null,
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

userSchema.pre("validate", function syncRoles(next) {
  const normalizedRoles = getUserRoles(this);

  if (normalizedRoles.length) {
    this.roles = normalizedRoles;
    this.role = getPrimaryRole({
      role: this.role,
      roles: normalizedRoles,
    });
  }

  next();
});

userSchema.index({ role: 1, isDeleted: 1, createdAt: -1 });
userSchema.index({ role: 1, status: 1, workerStatus: 1, isDeleted: 1, createdAt: -1 });
userSchema.index({ roles: 1, isDeleted: 1, createdAt: -1 });
userSchema.index({ roles: 1, status: 1, workerStatus: 1, isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
