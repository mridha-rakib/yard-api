const bookingService = require("./booking.service");

class BookingController {
  async createBooking(req, res) {
    const booking = await bookingService.createBookingFromJob(
      req.user,
      req.body.jobId,
      req.body
    );

    res.status(201).json({
      success: true,
      message: "Booking created successfully",
      data: booking,
    });
  }

  async getBookingById(req, res) {
    const booking = await bookingService.getBookingById(req.user, req.params.bookingId);
    res.json({ success: true, data: booking });
  }

  async listBookings(req, res) {
    const result = await bookingService.listBookings(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async startBooking(req, res) {
    const booking = await bookingService.startBooking(req.user, req.params.bookingId);
    res.json({ success: true, message: "Booking started", data: booking });
  }

  async completeBooking(req, res) {
    const result = await bookingService.completeBooking(
      req.user,
      req.params.bookingId,
      req.body
    );
    const message = "Completion proof submitted for review";

    res.json({ success: true, message, data: result });
  }

  async approveCompletion(req, res) {
    const result = await bookingService.approveCompletionByAdmin(
      req.user,
      req.params.bookingId,
      req.body
    );
    const captureStatus = result?.paymentCapture?.status || "";
    const workerTransferStatus = String(result?.paymentCapture?.workerTransferStatus || "")
      .trim()
      .toLowerCase();
    const message =
      captureStatus === "failed" ||
      captureStatus === "payment_not_found" ||
      ["failed", "worker_not_ready", "charge_not_ready"].includes(workerTransferStatus)
        ? "Completion approved, but payment needs review"
        : "Completion approved and payout released";

    res.json({ success: true, message, data: result });
  }

  async cancelBooking(req, res) {
    const booking = await bookingService.cancelBooking(
      req.user,
      req.params.bookingId,
      req.body.reason
    );

    res.json({ success: true, message: "Booking cancelled", data: booking });
  }

  async updateBookingStatus(req, res) {
    const booking = await bookingService.updateBookingStatusByAdmin(
      req.user,
      req.params.bookingId,
      req.body.status
    );

    res.json({ success: true, message: "Booking status updated", data: booking });
  }
}

module.exports = new BookingController();
