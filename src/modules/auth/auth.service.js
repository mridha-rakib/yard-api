const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const logger = require("../../config/logger");
const AppError = require("../../errors/AppError");
const hashToken = require("../../utils/hashToken");
const sanitizeUser = require("../../utils/sanitizeUser");
const { normalizeTimeValue } = require("../../utils/time");
const { ROLES } = require("../../constants/roles");
const emailService = require("../../services/email.service");
const authSessionRepository = require("./auth-session.repository");
const authOtpRepository = require("./auth-otp.repository");
const userRepository = require("../users/user.repository");

const EMAIL_VERIFICATION_PURPOSE = "verify_email";
const PASSWORD_RESET_PURPOSE = "reset_password";

class AuthService {
  signAccessToken(user, sessionId) {
    return jwt.sign(
      {
        userId: String(user._id),
        role: user.role,
        sessionId: String(sessionId),
        type: "access",
      },
      env.accessTokenSecret,
      {
        expiresIn: env.accessTokenExpiresIn,
      }
    );
  }

  signRefreshToken(user, sessionId) {
    return jwt.sign(
      {
        userId: String(user._id),
        sessionId: String(sessionId),
        type: "refresh",
      },
      env.refreshTokenSecret,
      {
        expiresIn: env.refreshTokenExpiresIn,
      }
    );
  }

  getTokenExpiryDate(token) {
    const decoded = jwt.decode(token);

    if (!decoded?.exp) {
      throw new AppError("Unable to determine token expiration", 500);
    }

    return new Date(decoded.exp * 1000);
  }

  isEmailVerificationRequired(user) {
    return [ROLES.CUSTOMER, ROLES.WORKER].includes(user?.role);
  }

  isEmailVerified(user) {
    if (!user) {
      return false;
    }

    if (user.role === ROLES.ADMIN) {
      return true;
    }

    if (user.emailVerifiedAt === undefined) {
      return true;
    }

    return Boolean(user.emailVerifiedAt);
  }

  buildVerificationMetadata(user, delivery = null) {
    if (!this.isEmailVerificationRequired(user)) {
      return null;
    }

    return {
      emailVerificationRequired: !this.isEmailVerified(user),
      emailVerificationDelivery: delivery,
    };
  }

  buildAuthResponse(user, tokens, extra = {}) {
    return {
      user: sanitizeUser(user),
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresIn: env.accessTokenExpiresIn,
        refreshTokenExpiresIn: env.refreshTokenExpiresIn,
      },
      ...extra,
    };
  }

  async createSessionTokens(user, sessionMetadata = {}) {
    const sessionId = new mongoose.Types.ObjectId();
    const refreshToken = this.signRefreshToken(user, sessionId);
    const accessToken = this.signAccessToken(user, sessionId);

    await authSessionRepository.create({
      _id: sessionId,
      user: user._id,
      refreshTokenHash: hashToken(refreshToken),
      ipAddress: sessionMetadata.ipAddress || "",
      userAgent: sessionMetadata.userAgent || "",
      lastUsedAt: new Date(),
      expiresAt: this.getTokenExpiryDate(refreshToken),
    });

    return {
      sessionId,
      accessToken,
      refreshToken,
    };
  }

  async rotateSessionTokens(user, session, sessionMetadata = {}) {
    const refreshToken = this.signRefreshToken(user, session._id);
    const accessToken = this.signAccessToken(user, session._id);

    await authSessionRepository.updateById(session._id, {
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: this.getTokenExpiryDate(refreshToken),
      lastUsedAt: new Date(),
      ipAddress: sessionMetadata.ipAddress || session.ipAddress || "",
      userAgent: sessionMetadata.userAgent || session.userAgent || "",
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  verifyRefreshToken(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, env.refreshTokenSecret);

      if (decoded.type !== "refresh") {
        throw new AppError("Invalid refresh token type", 401);
      }

      return decoded;
    } catch (error) {
      throw error.name === "JsonWebTokenError" || error.name === "TokenExpiredError"
        ? new AppError("Invalid or expired refresh token", 401)
        : error;
    }
  }

  async getUserAndSessionFromRefreshToken(refreshToken) {
    const decoded = this.verifyRefreshToken(refreshToken);
    const session = await authSessionRepository.findById(decoded.sessionId);

    if (!session || session.isRevoked) {
      throw new AppError("Refresh session is invalid", 401);
    }

    if (session.expiresAt <= new Date()) {
      await authSessionRepository.revokeById(session._id, "refresh_token_expired");
      throw new AppError("Refresh session has expired", 401);
    }

    const incomingTokenHash = hashToken(refreshToken);
    if (session.refreshTokenHash !== incomingTokenHash) {
      await authSessionRepository.revokeById(session._id, "refresh_token_reuse_detected");
      throw new AppError("Refresh token is invalid", 401);
    }

    const user = await userRepository.findById(decoded.userId);

    if (!user || String(session.user) !== String(user._id)) {
      await authSessionRepository.revokeById(session._id, "user_missing_for_session");
      throw new AppError("Authenticated user no longer exists", 401);
    }

    return {
      user,
      session,
    };
  }

  normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  normalizeOtpCode(code) {
    return String(code || "").trim().replace(/\s+/g, "");
  }

  generateOtpCode() {
    const digits = Math.max(4, Number(env.otpCodeLength) || 6);
    const max = 10 ** digits;
    return String(crypto.randomInt(0, max)).padStart(digits, "0");
  }

  generateResetToken() {
    return crypto.randomBytes(24).toString("hex");
  }

  getOtpExpiryDate() {
    return new Date(Date.now() + Math.max(1, env.otpExpiresInMinutes) * 60 * 1000);
  }

  getResetTokenExpiryDate() {
    return new Date(
      Date.now() + Math.max(1, env.passwordResetTokenExpiresInMinutes) * 60 * 1000
    );
  }

  assertValidPassword(newPassword) {
    if (!String(newPassword || "")) {
      throw new AppError("A new password is required", 400);
    }

    if (String(newPassword).length < 8) {
      throw new AppError("New password must be at least 8 characters", 400);
    }
  }

  async ensureUniqueIdentity(email, phone) {
    const [existingEmail, existingPhone] = await Promise.all([
      userRepository.findByEmail(email),
      userRepository.findByPhone(phone),
    ]);

    if (existingEmail) {
      throw new AppError("An account already exists with this email", 409);
    }

    if (existingPhone) {
      throw new AppError("An account already exists with this phone number", 409);
    }
  }

  async issueOtpCode({ user = null, email, purpose, force = false }) {
    const normalizedEmail = this.normalizeEmail(email);
    const now = new Date();
    const latestOtp = await authOtpRepository.findLatestByEmailAndPurpose(
      normalizedEmail,
      purpose
    );

    if (!force && latestOtp?.lastSentAt) {
      const elapsedSeconds = Math.floor(
        (now.getTime() - new Date(latestOtp.lastSentAt).getTime()) / 1000
      );
      const retryAfterSeconds = Math.max(0, env.otpRequestCooldownSeconds - elapsedSeconds);

      if (retryAfterSeconds > 0) {
        throw new AppError(
          `Please wait ${retryAfterSeconds} seconds before requesting another code`,
          429,
          { retryAfterSeconds }
        );
      }
    }

    const code = this.generateOtpCode();
    const expiresAt = this.getOtpExpiryDate();

    const otpRecord = await authOtpRepository.replaceLatestByEmailAndPurpose(
      normalizedEmail,
      purpose,
      {
        user: user?._id || null,
        codeHash: hashToken(code),
        expiresAt,
        lastSentAt: now,
        verifiedAt: null,
        consumedAt: null,
        verifyAttempts: 0,
        resetTokenHash: "",
        resetTokenExpiresAt: null,
      }
    );

    try {
      const delivery = await emailService.sendOtpEmail({
        to: normalizedEmail,
        name: user?.name || "",
        code,
        purpose,
      });

      return {
        otpRecord,
        delivery,
        expiresAt,
      };
    } catch (error) {
      await authOtpRepository.deleteMany({
        email: normalizedEmail,
        purpose,
      });
      throw error;
    }
  }

  async queueEmailVerificationForUser(user, options = {}) {
    if (!this.isEmailVerificationRequired(user) || this.isEmailVerified(user)) {
      return null;
    }

    try {
      return await this.issueOtpCode({
        user,
        email: user.email,
        purpose: EMAIL_VERIFICATION_PURPOSE,
        force: Boolean(options.force),
      });
    } catch (error) {
      if (options.failSilently) {
        logger.warn(
          {
            err: error,
            email: user.email,
            purpose: EMAIL_VERIFICATION_PURPOSE,
          },
          "Unable to queue email verification code"
        );
        return null;
      }

      throw error;
    }
  }

  async verifyOtpCode(email, purpose, code) {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedCode = this.normalizeOtpCode(code);

    if (!normalizedEmail || !normalizedCode) {
      throw new AppError("Email and verification code are required", 400);
    }

    const otpRecord = await authOtpRepository.findLatestActiveByEmailAndPurpose(
      normalizedEmail,
      purpose
    );

    if (!otpRecord || otpRecord.codeHash !== hashToken(normalizedCode)) {
      if (otpRecord) {
        await authOtpRepository.updateById(otpRecord._id, {
          verifyAttempts: Number(otpRecord.verifyAttempts || 0) + 1,
        });
      }

      throw new AppError("Invalid or expired verification code", 400);
    }

    return otpRecord;
  }

  async registerCustomer(payload, sessionMetadata = {}) {
    const { name, email, phone, password } = payload;

    if (!name || !email || !phone || !password) {
      throw new AppError("Name, email, phone, and password are required", 400);
    }

    await this.ensureUniqueIdentity(this.normalizeEmail(email), phone);
    this.assertValidPassword(password);

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await userRepository.create({
      name,
      email: this.normalizeEmail(email),
      phone,
      password: hashedPassword,
      role: ROLES.CUSTOMER,
      workerStatus: "not_applicable",
      emailVerifiedAt: null,
    });

    const tokens = await this.createSessionTokens(user, sessionMetadata);
    const verification = await this.queueEmailVerificationForUser(user, {
      force: true,
      failSilently: true,
    });

    return this.buildAuthResponse(user, tokens, {
      metadata: this.buildVerificationMetadata(user, verification?.delivery || null),
    });
  }

  async registerWorker(payload, sessionMetadata = {}) {
    const {
      fullName,
      name,
      email,
      phone,
      phoneNumber,
      age,
      city,
      state,
      zipCode,
      cityZipCode,
      skills = [],
      availability,
      availabilityLabel,
      availableDays = [],
      startTime = "",
      endTime = "",
      profilePhotoUrl = "",
      idDocumentUrl = "",
      password,
    } = payload;

    const resolvedName = fullName || name;
    const resolvedPhone = phone || phoneNumber;

    if (!resolvedName || !email || !resolvedPhone) {
      throw new AppError("Name, email, and phone are required", 400);
    }

    await this.ensureUniqueIdentity(this.normalizeEmail(email), resolvedPhone);

    const temporaryPassword =
      password || `WorkerTemp#${Math.random().toString(36).slice(2, 10)}`;

    this.assertValidPassword(temporaryPassword);

    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    let parsedCity = city || "";
    let parsedZipCode = zipCode || "";

    if (cityZipCode && !city && !zipCode) {
      const cityZipParts = String(cityZipCode)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      parsedCity = cityZipParts[0] || "";
      parsedZipCode = cityZipParts[1] || "";
    }

    const user = await userRepository.create({
      name: resolvedName,
      email: this.normalizeEmail(email),
      phone: resolvedPhone,
      password: hashedPassword,
      role: ROLES.WORKER,
      workerStatus: "pending",
      age,
      skills,
      location: {
        city: parsedCity,
        state: state || "",
        zipCode: parsedZipCode || "",
      },
      availability: {
        label: availabilityLabel || availability || "",
        days: availableDays,
        startTime: normalizeTimeValue(startTime, "Start time"),
        endTime: normalizeTimeValue(endTime, "End time"),
      },
      profilePhotoUrl,
      idDocumentUrl,
      emailVerifiedAt: null,
    });

    const tokens = await this.createSessionTokens(user, sessionMetadata);
    const verification = await this.queueEmailVerificationForUser(user, {
      force: true,
      failSilently: true,
    });

    return this.buildAuthResponse(user, tokens, {
      metadata: {
        generatedPassword: password ? null : temporaryPassword,
        ...this.buildVerificationMetadata(user, verification?.delivery || null),
      },
    });
  }

  async login(payload, sessionMetadata = {}) {
    const { email, password } = payload;

    if (!email || !password) {
      throw new AppError("Email and password are required", 400);
    }

    const user = await userRepository.findByEmail(this.normalizeEmail(email));

    if (!user) {
      throw new AppError("Invalid email or password", 401);
    }

    const passwordMatched = await bcrypt.compare(password, user.password);

    if (!passwordMatched) {
      throw new AppError("Invalid email or password", 401);
    }

    const updatedUser = await userRepository.updateById(user._id, {
      lastLoginAt: new Date(),
    });

    const tokens = await this.createSessionTokens(updatedUser, sessionMetadata);
    const verification = await this.queueEmailVerificationForUser(updatedUser, {
      force: false,
      failSilently: true,
    });

    return this.buildAuthResponse(updatedUser, tokens, {
      metadata: this.buildVerificationMetadata(updatedUser, verification?.delivery || null),
    });
  }

  async refreshSession(refreshToken, sessionMetadata = {}) {
    if (!refreshToken) {
      throw new AppError("Refresh token is required", 400);
    }

    const { user, session } = await this.getUserAndSessionFromRefreshToken(refreshToken);
    const tokens = await this.rotateSessionTokens(user, session, sessionMetadata);

    return this.buildAuthResponse(user, tokens, {
      metadata: this.buildVerificationMetadata(user, null),
    });
  }

  async logout(sessionId) {
    if (!sessionId) {
      throw new AppError("Session id is required", 400);
    }

    const session = await authSessionRepository.findActiveById(sessionId);
    if (!session) {
      return { loggedOut: true };
    }

    await authSessionRepository.revokeById(sessionId, "logout");
    return { loggedOut: true };
  }

  async logoutAll(userId) {
    await authSessionRepository.revokeAllByUser(userId, "logout_all");
    return { loggedOut: true };
  }

  async getCurrentUser(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    return sanitizeUser(user);
  }

  async requestEmailVerificationCode(user, options = {}) {
    const currentUser = await userRepository.findById(user._id);

    if (!currentUser) {
      throw new AppError("User not found", 404);
    }

    if (!this.isEmailVerificationRequired(currentUser)) {
      return {
        alreadyVerified: true,
        user: sanitizeUser(currentUser),
        delivery: null,
      };
    }

    if (this.isEmailVerified(currentUser)) {
      return {
        alreadyVerified: true,
        user: sanitizeUser(currentUser),
        delivery: null,
      };
    }

    const verification = await this.issueOtpCode({
      user: currentUser,
      email: currentUser.email,
      purpose: EMAIL_VERIFICATION_PURPOSE,
      force: Boolean(options.force),
    });

    return {
      alreadyVerified: false,
      user: sanitizeUser(currentUser),
      delivery: verification.delivery,
      expiresAt: verification.expiresAt,
    };
  }

  async verifyEmailVerificationCode(user, payload) {
    const currentUser = await userRepository.findById(user._id);

    if (!currentUser) {
      throw new AppError("User not found", 404);
    }

    if (!this.isEmailVerificationRequired(currentUser) || this.isEmailVerified(currentUser)) {
      return {
        verified: true,
        alreadyVerified: true,
        user: sanitizeUser(currentUser),
      };
    }

    const otpRecord = await this.verifyOtpCode(
      currentUser.email,
      EMAIL_VERIFICATION_PURPOSE,
      payload.code
    );
    const updatedUser = await userRepository.updateById(currentUser._id, {
      emailVerifiedAt: new Date(),
    });

    await authOtpRepository.updateById(otpRecord._id, {
      verifiedAt: new Date(),
      consumedAt: new Date(),
    });

    return {
      verified: true,
      alreadyVerified: false,
      user: sanitizeUser(updatedUser),
    };
  }

  async requestPasswordResetCode(payload) {
    const email = this.normalizeEmail(payload.email);

    if (!email) {
      throw new AppError("Email is required", 400);
    }

    const user = await userRepository.findByEmail(email);

    if (!user) {
      return {
        accepted: true,
        delivery: null,
        expiresAt: null,
      };
    }

    const resetRequest = await this.issueOtpCode({
      user,
      email,
      purpose: PASSWORD_RESET_PURPOSE,
      force: Boolean(payload.force),
    });

    return {
      accepted: true,
      delivery: resetRequest.delivery,
      expiresAt: resetRequest.expiresAt,
    };
  }

  async verifyPasswordResetCode(payload) {
    const email = this.normalizeEmail(payload.email);
    const otpRecord = await this.verifyOtpCode(
      email,
      PASSWORD_RESET_PURPOSE,
      payload.code
    );
    const resetToken = this.generateResetToken();
    const resetTokenExpiresAt = this.getResetTokenExpiryDate();

    await authOtpRepository.updateById(otpRecord._id, {
      verifiedAt: new Date(),
      resetTokenHash: hashToken(resetToken),
      resetTokenExpiresAt,
    });

    return {
      verified: true,
      email,
      resetToken,
      resetTokenExpiresAt,
    };
  }

  async resetPasswordWithToken(payload) {
    const email = this.normalizeEmail(payload.email);
    const resetToken = String(payload.resetToken || "");
    const newPassword = String(payload.newPassword || "");

    if (!email || !resetToken) {
      throw new AppError("Email and reset token are required", 400);
    }

    this.assertValidPassword(newPassword);

    const otpRecord = await authOtpRepository.findLatestByEmailAndPurpose(
      email,
      PASSWORD_RESET_PURPOSE
    );

    if (
      !otpRecord ||
      otpRecord.consumedAt ||
      !otpRecord.verifiedAt ||
      !otpRecord.resetTokenHash ||
      otpRecord.resetTokenHash !== hashToken(resetToken) ||
      !otpRecord.resetTokenExpiresAt ||
      new Date(otpRecord.resetTokenExpiresAt) <= new Date()
    ) {
      throw new AppError("The password reset session is invalid or has expired", 400);
    }

    const user = await userRepository.findByEmail(email);

    if (!user) {
      throw new AppError("User not found", 404);
    }

    const nextPasswordMatchesCurrent = await bcrypt.compare(newPassword, user.password);

    if (nextPasswordMatchesCurrent) {
      throw new AppError("New password must be different from the current password", 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await userRepository.updateById(user._id, {
      password: hashedPassword,
    });
    await authSessionRepository.revokeAllByUser(user._id, "password_reset");
    await authOtpRepository.updateById(otpRecord._id, {
      consumedAt: new Date(),
    });

    return { reset: true };
  }
}

module.exports = new AuthService();
