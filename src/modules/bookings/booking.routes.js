const express = require("express");
const asyncHandler = require("../../utils/asyncHandler");
const bookingController = require("./booking.controller");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { ROLES } = require("../../constants/roles");

const router = express.Router();

router.use(authenticate);
router.get("/", asyncHandler(bookingController.listBookings));
router.get("/:bookingId", asyncHandler(bookingController.getBookingById));
router.post(
  "/",
  authorize(ROLES.WORKER, ROLES.ADMIN),
  asyncHandler(bookingController.createBooking)
);
router.patch(
  "/:bookingId/start",
  authorize(ROLES.WORKER, ROLES.ADMIN),
  asyncHandler(bookingController.startBooking)
);
router.patch(
  "/:bookingId/complete",
  authorize(ROLES.WORKER, ROLES.ADMIN),
  asyncHandler(bookingController.completeBooking)
);
router.patch("/:bookingId/cancel", asyncHandler(bookingController.cancelBooking));
router.patch(
  "/:bookingId/status",
  authorize(ROLES.ADMIN),
  asyncHandler(bookingController.updateBookingStatus)
);

module.exports = router;
