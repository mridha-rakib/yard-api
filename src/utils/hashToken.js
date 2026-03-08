const crypto = require("crypto");

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

module.exports = hashToken;
