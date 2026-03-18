const { ROLES, ROLE_VALUES } = require("../constants/roles");

const uniqueValidRoles = (values = []) => [
  ...new Set(
    values
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => ROLE_VALUES.includes(value))
  ),
];

const normalizeRoles = (values = []) => {
  const roles = uniqueValidRoles(values);

  if (roles.includes(ROLES.WORKER) && !roles.includes(ROLES.CUSTOMER)) {
    roles.push(ROLES.CUSTOMER);
  }

  return roles;
};

const getUserRoles = (user) =>
  normalizeRoles([
    ...(Array.isArray(user?.roles) ? user.roles : []),
    user?.role,
  ]);

const hasRole = (user, role) => getUserRoles(user).includes(role);

const hasAnyRole = (user, ...roles) => roles.some((role) => hasRole(user, role));

const getPrimaryRole = (user) => {
  const roles = getUserRoles(user);

  if (user?.role && roles.includes(user.role)) {
    return user.role;
  }

  if (roles.includes(ROLES.CUSTOMER)) {
    return ROLES.CUSTOMER;
  }

  return roles[0] || "";
};

const combineMongoFilters = (...filters) => {
  const normalizedFilters = filters.filter(
    (filter) => filter && Object.keys(filter).length > 0
  );

  if (normalizedFilters.length === 0) {
    return {};
  }

  if (normalizedFilters.length === 1) {
    return normalizedFilters[0];
  }

  return {
    $and: normalizedFilters,
  };
};

const buildRoleMembershipFilter = (role) => {
  if (!ROLE_VALUES.includes(role)) {
    return {};
  }

  const fallbackRoles = [role];

  if (role === ROLES.CUSTOMER) {
    fallbackRoles.push(ROLES.WORKER);
  }

  return {
    $or: [
      { roles: role },
      {
        $and: [
          { roles: { $exists: false } },
          { role: { $in: fallbackRoles } },
        ],
      },
    ],
  };
};

module.exports = {
  normalizeRoles,
  getUserRoles,
  hasRole,
  hasAnyRole,
  getPrimaryRole,
  combineMongoFilters,
  buildRoleMembershipFilter,
};
