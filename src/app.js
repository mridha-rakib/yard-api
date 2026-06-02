const cors = require("cors");
const express = require("express");
const path = require("path");
const pinoHttp = require("pino-http");
const env = require("./config/env");
const logger = require("./config/logger");
const apiRouter = require("./routes");
const paymentController = require("./modules/payments/payment.controller");
const notFoundHandler = require("./middleware/notFound.middleware");
const errorHandler = require("./middleware/error.middleware");

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.headers["x-request-id"] || `req_${Date.now()}`,
    customLogLevel(req, res, error) {
      if (error || res.statusCode >= 500) {
        return "error";
      }

      if (res.statusCode >= 400) {
        return "warn";
      }

      return "info";
    },
  })
);

app.post(
  `${env.apiPrefix}/payments/webhook`,
  express.raw({ type: "application/json" }),
  paymentController.handleWebhook
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(
  "/uploads",
  express.static(path.resolve(process.cwd(), "uploads"), {
    immutable: true,
    maxAge: "365d",
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

app.use(env.apiPrefix, apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
