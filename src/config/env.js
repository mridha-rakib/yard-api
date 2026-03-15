require("dotenv").config({ quiet: true });

const cleanValue = (value, fallback = "") => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).trim().replace(/^['"]|['"]$/g, "");
};

const parseNumber = (value, fallback) => {
  const parsedValue = Number(cleanValue(value, fallback));
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const parseBoolean = (value, fallback = false) => {
  const normalizedValue = cleanValue(value);

  if (!normalizedValue) {
    return fallback;
  }

  if (["true", "1", "yes", "on"].includes(normalizedValue.toLowerCase())) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalizedValue.toLowerCase())) {
    return false;
  }

  return fallback;
};

const resolvedNodeEnv = cleanValue(process.env.NODE_ENV, "development");
const defaultAdminPassword = resolvedNodeEnv === "production" ? "" : "Admin@12345";

const env = {
  nodeEnv: resolvedNodeEnv,
  port: parseNumber(process.env.PORT, 5000),
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
  emailFrom: cleanValue(process.env.EMAIL_FROM, "no-reply@yardheroes.com"),
  smtpHost: cleanValue(process.env.SMTP_HOST),
  smtpPort: parseNumber(process.env.SMTP_PORT, 587),
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
  smtpUser: cleanValue(process.env.SMTP_USER),
  smtpPass: cleanValue(process.env.SMTP_PASS),
  otpCodeLength: parseNumber(process.env.OTP_CODE_LENGTH, 6),
  otpExpiresInMinutes: parseNumber(process.env.OTP_EXPIRES_IN_MINUTES, 10),
  otpRequestCooldownSeconds: parseNumber(process.env.OTP_REQUEST_COOLDOWN_SECONDS, 60),
  passwordResetTokenExpiresInMinutes: parseNumber(
    process.env.PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES,
    15
  ),
  stripeSecretKey: cleanValue(process.env.STRIPE_SECRET_KEY),
  stripeWebhookSecret: cleanValue(process.env.STRIPE_WEBHOOK_SECRET),
  stripeRepairEnabled: parseBoolean(process.env.STRIPE_REPAIR_ENABLED, true),
  stripeRepairIntervalMs: parseNumber(process.env.STRIPE_REPAIR_INTERVAL_MS, 30000),
  stripeRepairBatchSize: parseNumber(process.env.STRIPE_REPAIR_BATCH_SIZE, 10),
  stripeRepairMinAgeMs: parseNumber(process.env.STRIPE_REPAIR_MIN_AGE_MS, 60000),
  stripeRepairStartupDelayMs: parseNumber(
    process.env.STRIPE_REPAIR_STARTUP_DELAY_MS,
    5000
  ),
  defaultPlatformFeePercentage: parseNumber(process.env.DEFAULT_PLATFORM_FEE_PERCENTAGE, 12),
  adminName: cleanValue(process.env.ADMIN_NAME, "John Administrator"),
  adminEmail: cleanValue(process.env.ADMIN_EMAIL, "admin@yardworkpro.com").toLowerCase(),
  adminPhone: cleanValue(process.env.ADMIN_PHONE, "+15550000001"),
  adminPassword: cleanValue(process.env.ADMIN_PASSWORD, defaultAdminPassword),
};

module.exports = env;
