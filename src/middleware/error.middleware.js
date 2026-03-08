const logger = require("../config/logger");
const AppError = require("../errors/AppError");

const errorHandler = (error, req, res, next) => {
  const normalizedError =
    error instanceof AppError
      ? error
      : new AppError(error.message || "Internal server error", error.statusCode || 500);

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
