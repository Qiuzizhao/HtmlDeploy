const { createSitesRepository } = require('./sites');
const { createClassesRepository } = require('./classes');
const { createSettingsRepository } = require('./settings');
const { createForbiddenWordsRepository } = require('./forbidden-words');
const { createUsageRepository } = require('./usage');
const { createAuditLogsRepository } = require('./audit-logs');
const { createJobLogsRepository } = require('./job-logs');
const { createStudentsRepository } = require('./students');

function createRepositories(store) {
  return {
    sites: createSitesRepository(store),
    classes: createClassesRepository(store),
    settings: createSettingsRepository(store),
    forbiddenWords: createForbiddenWordsRepository(store),
    usage: createUsageRepository(store),
    auditLogs: createAuditLogsRepository(store),
    jobLogs: createJobLogsRepository(store),
    students: createStudentsRepository(store)
  };
}

module.exports = {
  createRepositories
};
