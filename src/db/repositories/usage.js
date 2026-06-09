function createUsageRepository(store) {
  return {
    getById() {
      return store.getUsageById();
    },
    replace(usageById) {
      return store.replaceUsage(usageById);
    },
    increment(site, type) {
      return store.incrementUsage(site, type);
    }
  };
}

module.exports = {
  createUsageRepository
};
