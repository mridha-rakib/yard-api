const buildPagination = (query = {}) => ({
  page: Number(query.page) > 0 ? Number(query.page) : 1,
  limit: Number(query.limit) > 0 ? Math.min(Number(query.limit), 100) : 10,
});

module.exports = buildPagination;
