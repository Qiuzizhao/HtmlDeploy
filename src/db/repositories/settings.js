function createSettingsRepository(store) {
  return {
    get() {
      return store.getSettings();
    },
    write(settings) {
      return store.writeSettings(settings);
    },
    getAiSettings() {
      return store.getAiSettings();
    },
    writeAiSettings(settings) {
      return store.writeAiSettings(settings);
    }
  };
}

module.exports = {
  createSettingsRepository
};
