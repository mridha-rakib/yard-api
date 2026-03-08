const BaseRepository = require("../../utils/base.repository");
const User = require("./user.model");
const { ROLES } = require("../../constants/roles");

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
    return this.paginate({ role: ROLES.WORKER, ...filter }, options);
  }

  listCustomers(filter = {}, options = {}) {
    return this.paginate({ role: ROLES.CUSTOMER, ...filter }, options);
  }

  listAdmins(filter = {}, options = {}) {
    return this.paginate({ role: ROLES.ADMIN, ...filter }, options);
  }
}

module.exports = new UserRepository();
