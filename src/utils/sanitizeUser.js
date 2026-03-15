const { ROLES } = require("../constants/roles");

const sanitizeUser = (user) => {
  if (!user) {
    return null;
  }

  const plainUser = typeof user.toObject === "function" ? user.toObject() : { ...user };
  delete plainUser.password;
  plainUser.isEmailVerified =
    plainUser.role === ROLES.ADMIN
      ? true
      : plainUser.emailVerifiedAt === undefined
        ? true
        : Boolean(plainUser.emailVerifiedAt);
  return plainUser;
};

module.exports = sanitizeUser;
