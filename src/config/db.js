const mongoose = require("mongoose");
const env = require("./env");
const logger = require("./logger");

const connectDb = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGO_URI is not configured");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  logger.info("MongoDB connected");
};

module.exports = connectDb;
