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

  async getUserById(req, res) {
    const user = await userService.getUserById(req.user, req.params.userId);
    res.json({ success: true, data: user });
  }

  async changePassword(req, res) {
    await userService.changePassword(req.user, req.body);
    res.json({
      success: true,
      message: "Password updated successfully",
    });
  }
}

module.exports = new UserController();
