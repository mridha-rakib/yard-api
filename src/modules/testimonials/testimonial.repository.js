const BaseRepository = require("../../utils/base.repository");
const Testimonial = require("./testimonial.model");

class TestimonialRepository extends BaseRepository {
  constructor() {
    super(Testimonial);
  }

  findByCustomerId(customerId, options = {}) {
    return this.findOne({ customer: customerId }, options);
  }
}

module.exports = new TestimonialRepository();
