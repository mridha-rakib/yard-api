require("dotenv").config({ quiet: true });

const cleanValue = (value, fallback = "") => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).trim().replace(/^['"]|['"]$/g, "");
};

const env = {
  nodeEnv: cleanValue(process.env.NODE_ENV, "development"),
  port: Number(cleanValue(process.env.PORT, 5000)),
  apiPrefix: cleanValue(process.env.API_PREFIX, "/api/v1"),
  logLevel: cleanValue(process.env.LOG_LEVEL, "info"),
  mongoUri: cleanValue(process.env.MONGO_URI),
  accessTokenSecret: cleanValue(
    process.env.ACCESS_TOKEN_SECRET,
    cleanValue(process.env.JWT_SECRET, "access-secret-change-me")
  ),
  accessTokenExpiresIn: cleanValue(
    process.env.ACCESS_TOKEN_EXPIRES_IN,
    cleanValue(process.env.JWT_EXPIRES_IN, "15m")
  ),
  refreshTokenSecret: cleanValue(
    process.env.REFRESH_TOKEN_SECRET,
    "refresh-secret-change-me"
  ),
  refreshTokenExpiresIn: cleanValue(process.env.REFRESH_TOKEN_EXPIRES_IN, "30d"),
  clientUrl: cleanValue(process.env.CLIENT_URL, "http://localhost:3000"),
  stripeSecretKey: cleanValue(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: cleanValue(process.env.STRIPE_WEBHOOK_SECRET),
  defaultPlatformFeePercentage: Number(
    cleanValue(process.env.DEFAULT_PLATFORM_FEE_PERCENTAGE, 12)
  ),
};

module.exports = env;
