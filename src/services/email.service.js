const nodemailer = require("nodemailer");
const env = require("../config/env");
const logger = require("../config/logger");

class EmailService {
  constructor() {
    this.transport = null;
  }

  hasConfiguredTransport() {
    return Boolean(env.smtpHost && env.smtpPort);
  }

  getTransport() {
    if (this.transport) {
      return this.transport;
    }

    if (this.hasConfiguredTransport()) {
      this.transport = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth:
          env.smtpUser || env.smtpPass
            ? {
                user: env.smtpUser,
                pass: env.smtpPass,
              }
            : undefined,
      });

      return this.transport;
    }

    this.transport = nodemailer.createTransport({
      jsonTransport: true,
    });

    return this.transport;
  }

  buildPreviewResponse(code) {
    if (this.hasConfiguredTransport() || env.nodeEnv === "production") {
      return {
        channel: "email",
      };
    }

    return {
      channel: "log",
      previewCode: String(code || ""),
    };
  }

  async sendOtpEmail({ to, name, code, purpose }) {
    const subject =
      purpose === "verify_email"
        ? "Verify your Yard Heroes email"
        : "Your Yard Heroes password reset code";
    const intro =
      purpose === "verify_email"
        ? "Use this one-time code to verify your email address."
        : "Use this one-time code to continue resetting your password.";
    const recipientName = String(name || "").trim() || "there";
    const text = [
      `Hi ${recipientName},`,
      "",
      intro,
      "",
      `Code: ${code}`,
      "",
      `This code expires in ${env.otpExpiresInMinutes} minutes.`,
      "",
      "If you did not request this code, you can ignore this email.",
    ].join("\n");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #10231a; line-height: 1.6;">
        <p>Hi ${recipientName},</p>
        <p>${intro}</p>
        <div style="margin: 24px 0; padding: 16px 20px; background: #f3f7f4; border-radius: 12px; display: inline-block;">
          <span style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${code}</span>
        </div>
        <p>This code expires in ${env.otpExpiresInMinutes} minutes.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      </div>
    `;

    if (!this.hasConfiguredTransport()) {
      logger.info(
        {
          to,
          purpose,
          otpCode: code,
        },
        "OTP email preview generated because SMTP is not configured"
      );

      return this.buildPreviewResponse(code);
    }

    await this.getTransport().sendMail({
      from: env.emailFrom,
      to,
      subject,
      text,
      html,
    });

    return this.buildPreviewResponse(code);
  }
}

module.exports = new EmailService();
