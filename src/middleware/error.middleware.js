const logger = require("../config/logger");
const AppError = require("../errors/AppError");

const normalizeUnexpectedError = (error) => {
  if (error instanceof AppError) {
    return error;
  }

  const rawMessage = String(error?.message || "").trim();

  if (error?.type === "entity.too.large") {
    return new AppError(
      "The upload is too large. Please use a smaller photo or keep the verification video under 25MB.",
      413
    );
  }

  if (
    (rawMessage.includes("offset") && rawMessage.includes("out of range")) ||
    rawMessage.toLowerCase().includes("bson")
  ) {
    return new AppError(
      "The proof upload is too large to save. Please keep the verification video under 25MB and try again.",
      400
    );
  }

  return new AppError(rawMessage || "Internal server error", error.statusCode || 500);
};

const errorHandler = (error, req, res, next) => {
  const normalizedError = normalizeUnexpectedError(error);

  logger.error(
    {
      err: error,
      path: req.originalUrl,
      method: req.method,
      requestId: req.id,
    },
    normalizedError.message
  );

  res.status(normalizedError.statusCode).json({
    success: false,
    message: normalizedError.message,
    details: normalizedError.details,
  });
};

module.exports = errorHandler;
