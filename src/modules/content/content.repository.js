const BaseRepository = require("../../utils/base.repository");
const Content = require("./content.model");

class ContentRepository extends BaseRepository {
  constructor() {
    super(Content);
  }

  findByKey(key) {
    return this.findOne({ key });
  }
}

module.exports = new ContentRepository();
