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
    const booking = await bookingService.completeBooking(req.user, req.params.bookingId);
    res.json({ success: true, message: "Booking completed", data: booking });
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
