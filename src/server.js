const app = require("./app");
const env = require("./config/env");
const logger = require("./config/logger");
const connectDb = require("./config/db");
const adminService = require("./modules/admin/admin.service");

const startServer = async () => {
  try {
    await connectDb();
    const adminSeedResult = await adminService.seedAdmin();

    if (adminSeedResult.status === "created") {
      logger.info({ email: adminSeedResult.email }, "Initial admin account seeded");
    } else {
      logger.info("Admin seed skipped because an admin account already exists");
    }

    app.listen(env.port, () => {
      logger.info(`Server running on port ${env.port}`);
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
};

startServer();
