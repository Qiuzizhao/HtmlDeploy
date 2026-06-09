function createJobLogsRepository(store) {
  return {
    list() {
      return store.listJobLogs();
    },
    replace(logs) {
      return store.replaceJobLogs(logs);
    },
    append(log) {
      return store.appendJobLog(log);
    }
  };
}

module.exports = {
  createJobLogsRepository
};
