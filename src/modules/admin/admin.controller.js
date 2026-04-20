const adminService = require("./admin.service");

class AdminController {
  async getDashboardStats(req, res) {
    const stats = await adminService.getDashboardStats();
    res.json({ success: true, data: stats });
  }

  async listHeroes(req, res) {
    const result = await adminService.listHeroes(req.query);
    res.json({ success: true, ...result });
  }

  async getHeroFilters(req, res) {
    const filters = await adminService.getHeroFilters();
    res.json({ success: true, data: filters });
  }

  async getHeroById(req, res) {
    const worker = await adminService.getHeroById(req.params.workerId);
    res.json({ success: true, data: worker });
  }

  async approveHero(req, res) {
    const worker = await adminService.updateHeroStatus(req.params.workerId, "approved");
    res.json({ success: true, message: "Hero approved", data: worker });
  }

  async rejectHero(req, res) {
    const worker = await adminService.updateHeroStatus(req.params.workerId, "rejected");
    res.json({ success: true, message: "Hero rejected", data: worker });
  }

  async deleteHero(req, res) {
    const result = await adminService.deleteHero(req.user, req.params.workerId);
    res.json({ success: true, message: "Hero deleted", data: result });
  }

  async updateHeroAccountStatus(req, res) {
    const worker = await adminService.updateHeroAccountStatus(
      req.params.workerId,
      req.body.status
    );
    res.json({ success: true, message: "Hero account status updated", data: worker });
  }

  async listCustomers(req, res) {
    const result = await adminService.listCustomers(req.query);
    res.json({ success: true, ...result });
  }

  async getCustomerById(req, res) {
    const customer = await adminService.getCustomerById(req.params.customerId);
    res.json({ success: true, data: customer });
  }

  async listBookings(req, res) {
    const result = await adminService.listBookings(req.query);
    res.json({ success: true, ...result });
  }

  async getBookingById(req, res) {
    const booking = await adminService.getBookingById(req.user, req.params.jobId);
    res.json({ success: true, data: booking });
  }

  async updateBookingStatus(req, res) {
    const booking = await adminService.updateBookingStatus(
      req.user,
      req.params.bookingId,
      req.body.status
    );
    res.json({ success: true, message: "Booking updated", data: booking });
  }

  async approveBookingCompletion(req, res) {
    const result = await adminService.approveBookingCompletion(
      req.user,
      req.params.bookingId,
      req.body.reviewNotes
    );
    res.json({
      success: true,
      message: "Booking completion approved",
      data: result,
    });
  }

  async listPayments(req, res) {
    const result = await adminService.listPayments(req.user, req.query);
    res.json({ success: true, ...result });
  }

  async listSupportConversations(req, res) {
    const result = await adminService.listSupportConversations(req.query);
    res.json({ success: true, ...result });
  }

  async getSettings(req, res) {
    const settings = await adminService.getSettings(req.user._id);
    res.json({ success: true, data: settings });
  }

  async updateSettings(req, res) {
    const settings = await adminService.updateSettings(req.user, req.body);
    res.json({ success: true, message: "Settings updated", data: settings });
  }
}

module.exports = new AdminController();
