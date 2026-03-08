const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const AppError = require("../../errors/AppError");
const hashToken = require("../../utils/hashToken");
const sanitizeUser = require("../../utils/sanitizeUser");
const { ROLES } = require("../../constants/roles");
const authSessionRepository = require("./auth-session.repository");
const userRepository = require("../users/user.repository");

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

  async registerCustomer(payload, sessionMetadata = {}) {
    const { name, email, phone, password } = payload;

    if (!name || !email || !phone || !password) {
      throw new AppError("Name, email, phone, and password are required", 400);
    }

    await this.ensureUniqueIdentity(email.toLowerCase(), phone);

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await userRepository.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: ROLES.CUSTOMER,
      workerStatus: "not_applicable",
    });

    const tokens = await this.createSessionTokens(user, sessionMetadata);

    return this.buildAuthResponse(user, tokens);
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

    await this.ensureUniqueIdentity(email.toLowerCase(), resolvedPhone);

    const temporaryPassword =
      password || `WorkerTemp#${Math.random().toString(36).slice(2, 10)}`;

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
      email: email.toLowerCase(),
      phone: resolvedPhone,
      password: hashedPassword,
      role: ROLES.WORKER,
      workerStatus: "pending",
      age,
      skills,
      location: {
        city: parsedCity,
        state: state || "",
        zipCode: parsedZipCode,
      },
      availability: {
        label: availabilityLabel || availability || "",
        days: availableDays,
        startTime,
        endTime,
      },
      profilePhotoUrl,
      idDocumentUrl,
    });

    const tokens = await this.createSessionTokens(user, sessionMetadata);

    return this.buildAuthResponse(user, tokens, {
      metadata: {
        generatedPassword: password ? null : temporaryPassword,
      },
    });
  }

  async login(payload, sessionMetadata = {}) {
    const { email, password } = payload;

    if (!email || !password) {
      throw new AppError("Email and password are required", 400);
    }

    const user = await userRepository.findByEmail(email.toLowerCase());

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

    return this.buildAuthResponse(updatedUser, tokens);
  }

  async refreshSession(refreshToken, sessionMetadata = {}) {
    if (!refreshToken) {
      throw new AppError("Refresh token is required", 400);
    }

    const { user, session } = await this.getUserAndSessionFromRefreshToken(refreshToken);
    const tokens = await this.rotateSessionTokens(user, session, sessionMetadata);

    return this.buildAuthResponse(user, tokens);
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
}

module.exports = new AuthService();
