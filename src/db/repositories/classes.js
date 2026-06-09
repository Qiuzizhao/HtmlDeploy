function createClassesRepository(store) {
  return {
    list() {
      return store.listClasses();
    },
    replace(classes) {
      return store.replaceClasses(classes);
    }
  };
}

module.exports = {
  createClassesRepository
};
