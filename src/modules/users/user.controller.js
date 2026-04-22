const userService = require("./user.service");

class UserController {
  async getProfile(req, res) {
    const user = await userService.getProfile(req.user._id);
    res.json({ success: true, data: user });
  }

  async updateProfile(req, res) {
    const user = await userService.updateProfile(req.user, req.body);
    res.json({ success: true, data: user, message: "Profile updated successfully" });
  }

  async getWorkerPayoutAccountStatus(req, res) {
    const payoutAccount = await userService.getWorkerPayoutAccountStatus(req.user);
    res.json({ success: true, data: payoutAccount });
  }

  async createWorkerPayoutOnboardingLink(req, res) {
    const result = await userService.createWorkerPayoutOnboardingLink(req.user, req.body);
    res.json({
      success: true,
      data: result,
      message: "Stripe onboarding link created successfully",
    });
  }

  async createWorkerPayoutDashboardLink(req, res) {
    const result = await userService.createWorkerPayoutDashboardLink(req.user);
    res.json({
      success: true,
      data: result,
      message: "Stripe dashboard link created successfully",
    });
  }

  async getUserById(req, res) {
    const user = await userService.getUserById(req.user, req.params.userId);
    res.json({ success: true, data: user });
  }

  async changePassword(req, res) {
    await userService.changePassword(req.user, req.body, req.auth?.sessionId || "");
    res.json({
      success: true,
      message: "Password updated successfully",
    });
  }
}

module.exports = new UserController();
