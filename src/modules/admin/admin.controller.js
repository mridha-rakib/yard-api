const adminService = require("./admin.service");

class AdminController {
  async getDashboardStats(req, res) {
    const stats = await adminService.getDashboardStats();
    res.json({ success: true, data: stats });
  }

  async listWorkers(req, res) {
    const result = await adminService.listWorkers(req.query);
    res.json({ success: true, ...result });
  }

  async getWorkerFilters(req, res) {
    const filters = await adminService.getWorkerFilters();
    res.json({ success: true, data: filters });
  }

  async getWorkerById(req, res) {
    const worker = await adminService.getWorkerById(req.params.workerId);
    res.json({ success: true, data: worker });
  }

  async approveWorker(req, res) {
    const worker = await adminService.updateWorkerStatus(req.params.workerId, "approved");
    res.json({ success: true, message: "Worker approved", data: worker });
  }

  async rejectWorker(req, res) {
    const worker = await adminService.updateWorkerStatus(req.params.workerId, "rejected");
    res.json({ success: true, message: "Worker rejected", data: worker });
  }

  async updateWorkerAccountStatus(req, res) {
    const worker = await adminService.updateWorkerAccountStatus(
      req.params.workerId,
      req.body.status
    );
    res.json({ success: true, message: "Worker account status updated", data: worker });
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

  async updateBookingStatus(req, res) {
    const booking = await adminService.updateBookingStatus(
      req.user,
      req.params.bookingId,
      req.body.status
    );
    res.json({ success: true, message: "Booking updated", data: booking });
  }

  async listPayments(req, res) {
    const result = await adminService.listPayments(req.query);
    res.json({ success: true, ...result });
  }

  async listSupportConversations(req, res) {
    const result = await adminService.listSupportConversations(req.query);
    res.json({ success: true, ...result });
  }

  async getSettings(req, res) {
    const settings = await adminService.getSettings();
    res.json({ success: true, data: settings });
  }

  async updateSettings(req, res) {
    const settings = await adminService.updateSettings(req.body);
    res.json({ success: true, message: "Settings updated", data: settings });
  }
}

module.exports = new AdminController();
