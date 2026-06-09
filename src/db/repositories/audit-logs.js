function createAuditLogsRepository(store) {
  return {
    list() {
      return store.listAuditLogs();
    },
    append(log) {
      return store.appendAuditLog(log);
    }
  };
}

module.exports = {
  createAuditLogsRepository
};
