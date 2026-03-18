const { ROLES } = require("../constants/roles");
const { getPrimaryRole, getUserRoles, hasRole } = require("./user-roles");

const sanitizeUser = (user) => {
  if (!user) {
    return null;
  }

  const plainUser = typeof user.toObject === "function" ? user.toObject() : { ...user };
  delete plainUser.password;
  plainUser.roles = getUserRoles(plainUser);
  plainUser.role = getPrimaryRole(plainUser);
  plainUser.isEmailVerified =
    hasRole(plainUser, ROLES.ADMIN)
      ? true
      : plainUser.emailVerifiedAt === undefined
        ? true
        : Boolean(plainUser.emailVerifiedAt);
  return plainUser;
};

module.exports = sanitizeUser;
