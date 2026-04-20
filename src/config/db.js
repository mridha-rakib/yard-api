const dns = require("dns");
const mongoose = require("mongoose");
const env = require("./env");
const logger = require("./logger");

const getTopologyServerErrors = (error) => {
  const serverDescriptions = error?.reason?.servers;

  if (!(serverDescriptions instanceof Map)) {
    return [];
  }

  return Array.from(serverDescriptions.entries())
    .map(([address, description]) => ({
      address,
      message: description?.error?.message,
    }))
    .filter((serverError) => serverError.message);
};

const buildConnectionHint = (error) => {
  const uri = env.mongoUri || "";
  const dnsServers = dns.getServers();
  const serverErrors = getTopologyServerErrors(error);
  const usesSingleAtlasHost =
    uri.startsWith("mongodb://") && uri.includes(".mongodb.net") && !uri.includes(",");

  if (
    usesSingleAtlasHost &&
    serverErrors.some((serverError) => serverError.message.includes("ENOTFOUND"))
  ) {
    return "MongoDB Atlas cluster root hosts should use mongodb+srv:// or an explicit replica-set host list. The current single-host mongodb:// URI cannot resolve correctly on this machine.";
  }

  if ((error?.message || "").includes("querySrv ECONNREFUSED")) {
    const resolverDetails = dnsServers.length
      ? ` Node is currently using DNS resolver(s): ${dnsServers.join(", ")}.`
      : "";

    return `SRV DNS lookups are being refused on this machine.${resolverDetails} Fix the local DNS resolver or use an explicit Atlas host list.`;
  }

  return null;
};

const applyConfiguredDnsServers = () => {
  if (!env.dnsServers.length) {
    return;
  }

  dns.setServers(env.dnsServers);
  logger.info(
    { dnsServers: env.dnsServers },
    "Using configured DNS servers for MongoDB lookups"
  );
};

const connectDb = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGO_URI is not configured");
  }

  mongoose.set("strictQuery", true);
  applyConfiguredDnsServers();

  try {
    await mongoose.connect(env.mongoUri);
  } catch (error) {
    const hint = buildConnectionHint(error);

    if (hint) {
      logger.error({ err: error, hint }, "MongoDB connection failed");
      error.message = `${error.message} ${hint}`;
    }

    throw error;
  }

  logger.info("MongoDB connected");
};

module.exports = connectDb;
