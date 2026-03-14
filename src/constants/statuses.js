const USER_STATUSES = ["active", "inactive", "suspended"];
const WORKER_STATUSES = ["not_applicable", "pending", "approved", "rejected"];
const JOB_STATUSES = ["new", "assigned", "in_progress", "completed", "cancelled", "paid"];
const BOOKING_STATUSES = ["assigned", "in_progress", "completed", "cancelled"];
const APPLICATION_STATUSES = ["pending", "accepted", "rejected", "withdrawn"];
const PAYMENT_STATUSES = ["pending", "authorized", "paid", "failed", "refunded", "cancelled"];
const PAYMENT_METHODS = ["card", "cash", "paypal", "bank_transfer", "unknown"];
const SUPPORT_STATUSES = ["open", "in_progress", "resolved", "closed"];
const SUPPORT_ROLES = ["customer", "worker", "admin", "guest", "system"];

module.exports = {
  USER_STATUSES,
  WORKER_STATUSES,
  JOB_STATUSES,
  BOOKING_STATUSES,
  APPLICATION_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  SUPPORT_STATUSES,
  SUPPORT_ROLES,
};
