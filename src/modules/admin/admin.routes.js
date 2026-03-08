const express = require("express");
const {
  getAllWorkers,
  getPendingWorkers,
  approveWorker,
  rejectWorker,
  getAllCustomers,
  getAllWorkers,
  getAllBookings,
  updateBookingStatus,
  getAllPayments,
  getDashboardStats,
} = require("./admin.controller");

const { protect, isAdmin } = require("../../middleware/auth.middleware");
const express = require("express");

const router = express.Router();

router.get("/workers", protect, isAdmin, getAllWorkers);
router.get("/workers/pending", protect, isAdmin, getPendingWorkers);
router.patch("/workers/:id/approve", protect, isAdmin, approveWorker);
router.patch("/workers/:id/reject", protect, isAdmin, rejectWorker);
router.get("/customers", protect, isAdmin, getAllCustomers);
router.get("/workers", protect, isAdmin, getAllWorkers);
router.get("/bookings", protect, isAdmin, getAllBookings);
router.patch("/bookings/:id", protect, isAdmin, updateBookingStatus);
router.get("/payments", protect, isAdmin, getAllPayments);
router.get("/stats", protect, isAdmin, getDashboardStats);

module.exports = router;
