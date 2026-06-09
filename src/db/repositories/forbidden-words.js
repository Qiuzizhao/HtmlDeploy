function createForbiddenWordsRepository(store) {
  return {
    list() {
      return store.listForbiddenWords();
    },
    replace(words) {
      return store.replaceForbiddenWords(words);
    }
  };
}

module.exports = {
  createForbiddenWordsRepository
};
