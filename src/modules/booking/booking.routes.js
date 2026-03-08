const express = require("express");
const {
  createBooking,
  completeBooking,
  cancelBooking,
  getAllBookings
} = require("./booking.controller");

const { protect, isAdmin } = require("../../middleware/auth.middleware");

const router = express.Router();

// Worker accept job
router.post("/", protect, createBooking);

// Worker complete
router.patch("/:id/complete", protect, completeBooking);

// Customer cancel
router.patch("/:id/cancel", protect, cancelBooking);

// Admin get all
router.get("/admin/all", protect, isAdmin, getAllBookings);

module.exports = router;