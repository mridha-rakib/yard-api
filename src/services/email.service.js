const nodemailer = require("nodemailer");
const env = require("../config/env");
const logger = require("../config/logger");

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDate = (value) => {
  if (!value) {
    return "Flexible";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Flexible";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
};

const formatCurrency = (value, currency = "USD") => {
  const amount = Number(value || 0);
  const normalizedCurrency = String(currency || "USD").trim().toUpperCase();

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency || "USD",
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch (_error) {
    return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }
};

const formatLocation = (job = {}) =>
  [job.city, job.state, job.zipCode].filter(Boolean).join(", ") || "Location pending";

const formatScheduleTime = (job = {}) => {
  const timeLabels = {
    anytime: "Any time",
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
  };
  const urgencyLabels = {
    today: "Today",
    within24: "Within 24 hours",
    within24hours: "Within 24 hours",
    flexible: "Flexible",
    scheduled: "Scheduled",
  };
  const preferredTime = String(job.preferredTime || "").trim();
  const urgency = String(job.urgency || "").trim().toLowerCase();

  return timeLabels[preferredTime] || preferredTime || urgencyLabels[urgency] || "Any time";
};

const buildClientUrl = (path = "/") => {
  const baseUrl = String(env.clientUrl || "").replace(/\/+$/, "");
  const normalizedPath = `/${String(path || "/").replace(/^\/+/, "")}`;

  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
};

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
    const safeRecipientName = escapeHtml(recipientName);
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
        <p>Hi ${safeRecipientName},</p>
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

  async sendWorkerWelcomeEmail({ to, name }) {
    const recipientName = String(name || "").trim() || "there";
    const safeRecipientName = escapeHtml(recipientName);
    const subject = "Welcome to YardHero \u2013 Complete Your Setup";
    const text = [
      `Hi ${recipientName},`,
      "",
      "Welcome to YardHero.",
      "",
      "Before getting started, please go to the Payment section on the platform and connect your bank account.",
      "This is required in order to receive payouts for completed jobs.",
      "",
      "I also want to briefly explain how YardHero works so expectations are clear from the start.",
      "",
      "YardHero is a marketplace platform that connects homeowners with independent landscapers looking for yard work opportunities. You are not an employee of YardHero. There are no schedules, assigned hours, or required jobs.",
      "",
      "You have full control over:",
      "- Which jobs you accept",
      "- When you work",
      "- How often you work",
      "- Whether you use other platforms or find work independently",
      "",
      "YardHero simply provides access to available opportunities in your area.",
      "",
      "Because the platform is still growing, job availability may vary at times - especially during the early stages. As more customers join the platform, more opportunities will become available. Staying active and checking new job postings regularly will help you take advantage of available work.",
      "",
      "If you have any questions about how the platform works, feel free to reach out anytime.",
      "",
      "Thanks,",
      "Ivan",
      "Founder, YardHero",
    ].join("\n");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #10231a; line-height: 1.6;">
        <p>Hi ${safeRecipientName},</p>
        <p>Welcome to YardHero.</p>
        <p>
          Before getting started, please go to the Payment section on the platform and connect your
          bank account. This is required in order to receive payouts for completed jobs.
        </p>
        <p>
          I also want to briefly explain how YardHero works so expectations are clear from the start.
        </p>
        <p>
          YardHero is a marketplace platform that connects homeowners with independent landscapers
          looking for yard work opportunities. You are not an employee of YardHero. There are no
          schedules, assigned hours, or required jobs.
        </p>
        <p>You have full control over:</p>
        <ul style="padding-left: 20px; margin-top: 0;">
          <li>Which jobs you accept</li>
          <li>When you work</li>
          <li>How often you work</li>
          <li>Whether you use other platforms or find work independently</li>
        </ul>
        <p>YardHero simply provides access to available opportunities in your area.</p>
        <p>
          Because the platform is still growing, job availability may vary at times - especially
          during the early stages. As more customers join the platform, more opportunities will become
          available. Staying active and checking new job postings regularly will help you take
          advantage of available work.
        </p>
        <p>If you have any questions about how the platform works, feel free to reach out anytime.</p>
        <p>
          Thanks,<br />
          Ivan<br />
          Founder, YardHero
        </p>
      </div>
    `;

    if (!this.hasConfiguredTransport()) {
      logger.info(
        {
          to,
          subject,
        },
        "Worker welcome email skipped because SMTP is not configured"
      );

      return {
        channel: env.nodeEnv === "production" ? "email" : "log",
      };
    }

    await this.getTransport().sendMail({
      from: env.emailFrom,
      to,
      subject,
      text,
      html,
    });

    return {
      channel: "email",
    };
  }

  async sendCustomerHeroAssignedEmail({ to, customerName }) {
    const recipientName = String(customerName || "").trim() || "there";
    const safeRecipientName = escapeHtml(recipientName);
    const subject = "Your YardHero Job Has Been Assigned";
    const text = [
      `Hi ${recipientName},`,
      "",
      "Good news - your YardHero request has officially been assigned to a Hero.",
      "",
      "Your Hero will review the details provided and may contact you directly through the platform if any additional information is needed before arrival.",
      "",
      "We appreciate you choosing YardHero and will continue monitoring the job to help ensure everything goes smoothly.",
      "",
      "Thanks,",
      "YardHero",
    ].join("\n");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #10231a; line-height: 1.6;">
        <p>Hi ${safeRecipientName},</p>
        <p>Good news - your YardHero request has officially been assigned to a Hero.</p>
        <p>
          Your Hero will review the details provided and may contact you directly through the
          platform if any additional information is needed before arrival.
        </p>
        <p>
          We appreciate you choosing YardHero and will continue monitoring the job to help ensure
          everything goes smoothly.
        </p>
        <p>
          Thanks,<br />
          YardHero
        </p>
      </div>
    `;

    if (!this.hasConfiguredTransport()) {
      logger.info(
        {
          to,
          subject,
        },
        "Customer Hero assigned email skipped because SMTP is not configured"
      );

      return {
        channel: env.nodeEnv === "production" ? "email" : "log",
      };
    }

    await this.getTransport().sendMail({
      from: env.emailFrom,
      to,
      subject,
      text,
      html,
    });

    return {
      channel: "email",
    };
  }

  async sendCustomerJobCompletedPendingApprovalEmail({ to, customerName }) {
    const recipientName = String(customerName || "").trim() || "there";
    const safeRecipientName = escapeHtml(recipientName);
    const subject = "Your YardHero Job Has Been Completed";
    const text = [
      `Hi ${recipientName},`,
      "",
      "Your YardHero service has been marked as completed by the Hero and is currently pending final approval from the YardHero team.",
      "",
      "We are reviewing the completion details to ensure the service meets platform standards before closing the job.",
      "",
      "If you experienced any issues or have feedback regarding the completed work, please reply to this email or contact support as soon as possible.",
      "",
      "Thank you for choosing YardHero.",
      "",
      "\u2014 YardHero",
    ].join("\n");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #10231a; line-height: 1.6;">
        <p>Hi ${safeRecipientName},</p>
        <p>
          Your YardHero service has been marked as completed by the Hero and is currently pending
          final approval from the YardHero team.
        </p>
        <p>
          We are reviewing the completion details to ensure the service meets platform standards
          before closing the job.
        </p>
        <p>
          If you experienced any issues or have feedback regarding the completed work, please reply
          to this email or contact support as soon as possible.
        </p>
        <p>Thank you for choosing YardHero.</p>
        <p>&mdash; YardHero</p>
      </div>
    `;

    if (!this.hasConfiguredTransport()) {
      logger.info(
        {
          to,
          subject,
        },
        "Customer job completed pending approval email skipped because SMTP is not configured"
      );

      return {
        channel: env.nodeEnv === "production" ? "email" : "log",
      };
    }

    await this.getTransport().sendMail({
      from: env.emailFrom,
      to,
      subject,
      text,
      html,
    });

    return {
      channel: "email",
    };
  }

  async sendNewJobAvailableEmail({ to, job = {}, payment = {}, jobLink = "/all-jobs" }) {
    const subject = "Live Job ! Yard Hero";
    const service = String(job.serviceType || job.title || "Yard work").trim();
    const location = formatLocation(job);
    const date = formatDate(job.preferredDate);
    const time = formatScheduleTime(job);
    const payoutSource =
      payment.workerPayout ??
      job?.pricing?.workerPayout ??
      Number((Number(job.estimatedPrice || 0) * 0.88).toFixed(2));
    const heroPayout = formatCurrency(payoutSource, payment.currency || "USD");
    const customerNotes = String(job.jobDescription || "No customer notes provided.").trim();
    const viewJobUrl = buildClientUrl(jobLink);
    const safeService = escapeHtml(service);
    const safeLocation = escapeHtml(location);
    const safeDate = escapeHtml(date);
    const safeTime = escapeHtml(time);
    const safeHeroPayout = escapeHtml(heroPayout);
    const safeCustomerNotes = escapeHtml(customerNotes).replace(/\r?\n/g, "<br />");
    const safeViewJobUrl = escapeHtml(viewJobUrl);
    const text = [
      "A new job is now available on YardHero.",
      "",
      `- Service: ${service}`,
      `- Location: ${location}`,
      `- Date: ${date}`,
      `- Time: ${time}`,
      `- Hero Payout: ${heroPayout}`,
      "",
      "Customer Notes:",
      customerNotes,
      "",
      "Log in to YardHero to view and accept the job before another Hero claims it.",
      viewJobUrl,
      "",
      "Thanks,",
      "YardHero",
    ].join("\n");
    const html = `
      <div style="font-family: Arial, sans-serif; color: #10231a; line-height: 1.6;">
        <p>A new job is now available on YardHero.</p>
        <ul style="padding-left: 20px;">
          <li><strong>Service:</strong> ${safeService}</li>
          <li><strong>Location:</strong> ${safeLocation}</li>
          <li><strong>Date:</strong> ${safeDate}</li>
          <li><strong>Time:</strong> ${safeTime}</li>
          <li><strong>Hero Payout:</strong> ${safeHeroPayout}</li>
        </ul>
        <p><strong>Customer Notes:</strong><br />${safeCustomerNotes}</p>
        <p>
          Log in to YardHero to view and accept the job before another Hero claims it.
        </p>
        <p>
          <a href="${safeViewJobUrl}" style="color: #0A3019; font-weight: 700;">View job on YardHero</a>
        </p>
        <p>
          Thanks,<br />
          YardHero
        </p>
      </div>
    `;

    if (!this.hasConfiguredTransport()) {
      logger.info(
        {
          to,
          subject,
          jobId: String(job._id || ""),
        },
        "New job available email skipped because SMTP is not configured"
      );

      return {
        channel: env.nodeEnv === "production" ? "email" : "log",
      };
    }

    await this.getTransport().sendMail({
      from: env.emailFrom,
      to,
      subject,
      text,
      html,
    });

    return {
      channel: "email",
    };
  }
}

module.exports = new EmailService();
