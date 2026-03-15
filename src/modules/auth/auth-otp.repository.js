const BaseRepository = require("../../utils/base.repository");
const { AuthOtp } = require("./auth-otp.model");

class AuthOtpRepository extends BaseRepository {
  constructor() {
    super(AuthOtp);
  }

  findLatestByEmailAndPurpose(email, purpose, options = {}) {
    return this.findOne(
      {
        email: String(email || "").toLowerCase(),
        purpose,
      },
      {
        sort: { createdAt: -1 },
        ...options,
      }
    );
  }

  findLatestActiveByEmailAndPurpose(email, purpose, now = new Date(), options = {}) {
    return this.findOne(
      {
        email: String(email || "").toLowerCase(),
        purpose,
        consumedAt: null,
        expiresAt: { $gt: now },
      },
      {
        sort: { createdAt: -1 },
        ...options,
      }
    );
  }

  async replaceLatestByEmailAndPurpose(email, purpose, payload = {}) {
    const normalizedEmail = String(email || "").toLowerCase();

    await this.deleteMany({
      email: normalizedEmail,
      purpose,
    });

    return this.create({
      email: normalizedEmail,
      purpose,
      ...payload,
    });
  }
}

module.exports = new AuthOtpRepository();
