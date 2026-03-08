const sanitizeUser = (user) => {
  if (!user) {
    return null;
  }

  const plainUser = typeof user.toObject === "function" ? user.toObject() : { ...user };
  delete plainUser.password;
  return plainUser;
};

module.exports = sanitizeUser;
