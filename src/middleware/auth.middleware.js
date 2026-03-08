const jwt = require("jsonwebtoken");
const env = require("../config/env");
const AppError = require("../errors/AppError");
const authSessionRepository = require("../modules/auth/auth-session.repository");
const userRepository = require("../modules/users/user.repository");

const extractToken = (authorizationHeader = "") => {
  if (!authorizationHeader) {
    return null;
  }

  if (authorizationHeader.startsWith("Bearer ")) {
    return authorizationHeader.slice(7);
  }

  return authorizationHeader;
};

const validateSession = async (decoded) => {
  if (decoded.type !== "access") {
    throw new AppError("Invalid access token type", 401);
  }

  const session = await authSessionRepository.findActiveById(decoded.sessionId);

  if (!session) {
    throw new AppError("Session is invalid or has been revoked", 401);
  }

  if (String(session.user) !== String(decoded.userId)) {
    throw new AppError("Token session does not match the authenticated user", 401);
  }

  if (session.expiresAt <= new Date()) {
    await authSessionRepository.revokeById(session._id, "session_expired");
    throw new AppError("Session has expired", 401);
  }

  return session;
};

const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req.headers.authorization);

    if (!token) {
      throw new AppError("Authentication token is missing", 401);
    }

    const decoded = jwt.verify(token, env.accessTokenSecret);
    const session = await validateSession(decoded);
    const user = await userRepository.findById(decoded.userId);

    if (!user) {
      throw new AppError("Authenticated user no longer exists", 401);
    }

    req.user = user;
    req.auth = {
      sessionId: String(session._id),
      tokenType: decoded.type,
    };
    next();
  } catch (error) {
    next(error.name === "JsonWebTokenError" || error.name === "TokenExpiredError"
      ? new AppError("Invalid or expired token", 401)
      : error);
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError("Authentication is required", 401));
  }

  if (!roles.includes(req.user.role)) {
    return next(new AppError("You do not have permission to access this resource", 403));
  }

  return next();
};

const optionalAuthenticate = async (req, res, next) => {
  try {
    const token = extractToken(req.headers.authorization);

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, env.accessTokenSecret);
    const session = await validateSession(decoded);
    const user = await userRepository.findById(decoded.userId);
    req.user = user || null;
    req.auth = user
      ? {
          sessionId: String(session._id),
          tokenType: decoded.type,
        }
      : null;
    return next();
  } catch (error) {
    req.user = null;
    req.auth = null;
    return next();
  }
};

module.exports = {
  authenticate,
  authorize,
  optionalAuthenticate,
};
