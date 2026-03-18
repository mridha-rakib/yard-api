const BaseRepository = require("../../utils/base.repository");
const User = require("./user.model");
const { ROLES } = require("../../constants/roles");
const {
  buildRoleMembershipFilter,
  combineMongoFilters,
} = require("../../utils/user-roles");

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  findByEmail(email, options = {}) {
    return this.findOne({ email: email.toLowerCase() }, options);
  }

  findByPhone(phone, options = {}) {
    return this.findOne({ phone }, options);
  }

  listWorkers(filter = {}, options = {}) {
    return this.paginate(
      combineMongoFilters(filter, buildRoleMembershipFilter(ROLES.WORKER)),
      options
    );
  }

  listCustomers(filter = {}, options = {}) {
    return this.paginate(
      combineMongoFilters(filter, buildRoleMembershipFilter(ROLES.CUSTOMER)),
      options
    );
  }

  listAdmins(filter = {}, options = {}) {
    return this.paginate(
      combineMongoFilters(filter, buildRoleMembershipFilter(ROLES.ADMIN)),
      options
    );
  }
}

module.exports = new UserRepository();
