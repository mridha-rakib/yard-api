class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  create(payload, options = {}) {
    return this.model.create([payload], options).then(([document]) => document);
  }

  findById(id, options = {}) {
    const query = this.model.findById(id);
    return this.applyOptions(query, options);
  }

  findOne(filter, options = {}) {
    const query = this.model.findOne(filter);
    return this.applyOptions(query, options);
  }

  findMany(filter = {}, options = {}) {
    const query = this.model.find(filter);
    return this.applyOptions(query, options);
  }

  updateById(id, update, options = {}) {
    return this.model.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
      ...options,
    });
  }

  updateOne(filter, update, options = {}) {
    return this.model.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
      ...options,
    });
  }

  updateMany(filter, update, options = {}) {
    return this.model.updateMany(filter, update, {
      runValidators: true,
      ...options,
    });
  }

  deleteById(id, options = {}) {
    return this.model.findByIdAndDelete(id, options);
  }

  deleteOne(filter, options = {}) {
    return this.model.findOneAndDelete(filter, options);
  }

  deleteMany(filter = {}, options = {}) {
    return this.model.deleteMany(filter, options);
  }

  count(filter = {}) {
    return this.model.countDocuments(filter);
  }

  async paginate(filter = {}, options = {}) {
    const {
      page = 1,
      limit = 10,
      sort = { createdAt: -1 },
      select,
      populate,
      lean = true,
    } = options;

    const safePage = Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number(limit) > 0 ? Number(limit) : 10;
    const skip = (safePage - 1) * safeLimit;

    const query = this.model.find(filter).sort(sort).skip(skip).limit(safeLimit);

    if (select) {
      query.select(select);
    }

    if (populate) {
      const populateEntries = Array.isArray(populate) ? populate : [populate];
      populateEntries.forEach((entry) => query.populate(entry));
    }

    if (lean) {
      query.lean();
    }

    const [items, total] = await Promise.all([query, this.count(filter)]);

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  applyOptions(query, options = {}) {
    const { select, populate, lean = false, sort } = options;

    if (select) {
      query.select(select);
    }

    if (sort) {
      query.sort(sort);
    }

    if (populate) {
      const populateEntries = Array.isArray(populate) ? populate : [populate];
      populateEntries.forEach((entry) => query.populate(entry));
    }

    if (lean) {
      query.lean();
    }

    return query;
  }
}

module.exports = BaseRepository;
