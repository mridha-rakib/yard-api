const BaseRepository = require("../../utils/base.repository");
const AuthSession = require("./auth-session.model");

class AuthSessionRepository extends BaseRepository {
  constructor() {
    super(AuthSession);
  }

  findActiveById(sessionId) {
    return this.findOne({
      _id: sessionId,
      isRevoked: false,
    });
  }

  revokeById(sessionId, reason = "logout") {
    return this.updateById(sessionId, {
      isRevoked: true,
      revokedAt: new Date(),
      revokeReason: reason,
    });
  }

  revokeAllByUser(userId, reason = "logout_all") {
    return this.updateMany(
      {
        user: userId,
        isRevoked: false,
      },
      {
        isRevoked: true,
        revokedAt: new Date(),
        revokeReason: reason,
      }
    );
  }
}

module.exports = new AuthSessionRepository();
