const app = require("./app");
const env = require("./config/env");
const logger = require("./config/logger");
const connectDb = require("./config/db");

const startServer = async () => {
  try {
    await connectDb();

    app.listen(env.port, () => {
      logger.info(`Server running on port ${env.port}`);
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

startServer();
