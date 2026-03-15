const authService = require("./auth.service");

const getSessionMetadata = (req) => ({
  ipAddress: req.ip || req.socket?.remoteAddress || "",
  userAgent: req.get("user-agent") || "",
});

const getRefreshToken = (req) =>
  req.body.refreshToken || req.headers["x-refresh-token"] || "";

class AuthController {
  async register(req, res) {
    const result = await authService.registerCustomer(req.body, getSessionMetadata(req));
    res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: result,
    });
  }

  async registerWorker(req, res) {
    const result = await authService.registerWorker(req.body, getSessionMetadata(req));
    res.status(201).json({
      success: true,
      message: "Worker registration submitted successfully",
      data: result,
    });
  }

  async login(req, res) {
    const result = await authService.login(req.body, getSessionMetadata(req));
    res.json({
      success: true,
      message: "Login successful",
      data: result,
    });
  }

  async refresh(req, res) {
    const result = await authService.refreshSession(
      getRefreshToken(req),
      getSessionMetadata(req)
    );

    res.json({
      success: true,
      message: "Tokens refreshed successfully",
      data: result,
    });
  }

  async logout(req, res) {
    const result = await authService.logout(req.auth.sessionId);
    res.json({
      success: true,
      message: "Logged out successfully",
      data: result,
    });
  }

  async logoutAll(req, res) {
    const result = await authService.logoutAll(req.user._id);
    res.json({
      success: true,
      message: "Logged out from all sessions successfully",
      data: result,
    });
  }

  async me(req, res) {
    const user = await authService.getCurrentUser(req.user._id);
    res.json({
      success: true,
      data: user,
    });
  }

  async requestEmailVerificationCode(req, res) {
    const result = await authService.requestEmailVerificationCode(req.user, req.body || {});
    res.json({
      success: true,
      message: result.alreadyVerified
        ? "Email is already verified"
        : "Verification code sent successfully",
      data: result,
    });
  }

  async verifyEmailVerificationCode(req, res) {
    const result = await authService.verifyEmailVerificationCode(req.user, req.body || {});
    res.json({
      success: true,
      message: result.alreadyVerified
        ? "Email is already verified"
        : "Email verified successfully",
      data: result,
    });
  }

  async requestPasswordResetCode(req, res) {
    const result = await authService.requestPasswordResetCode(req.body || {});
    res.json({
      success: true,
      message: "If that email exists, a verification code has been sent",
      data: result,
    });
  }

  async verifyPasswordResetCode(req, res) {
    const result = await authService.verifyPasswordResetCode(req.body || {});
    res.json({
      success: true,
      message: "Verification code accepted",
      data: result,
    });
  }

  async resetPasswordWithToken(req, res) {
    const result = await authService.resetPasswordWithToken(req.body || {});
    res.json({
      success: true,
      message: "Password reset successfully",
      data: result,
    });
  }
}

module.exports = new AuthController();
