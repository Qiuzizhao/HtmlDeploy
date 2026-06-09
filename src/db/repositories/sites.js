function createSitesRepository(store) {
  return {
    list() {
      return store.listSites();
    },
    replace(sites) {
      return store.replaceSites(sites);
    },
    incrementUsage(site, type) {
      return store.incrementUsage(site, type);
    }
  };
}

module.exports = {
  createSitesRepository
};
