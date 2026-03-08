const pino = require("pino");
const env = require("./env");

const transport =
  env.nodeEnv === "production"
    ? undefined
    : pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      });

const logger = pino(
  {
    level: env.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.body.password",
        "req.body.confirmPassword",
        "password",
        "token",
      ],
      censor: "[Redacted]",
    },
  },
  transport
);

module.exports = logger;
