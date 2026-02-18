const caseMaterials = require('./case-materials.json')
const disclosureStatuses = require('./disclosure-statuses.json')
const disclosureNonSensitiveRows = require('./disclosure-non-sensitive-rows.json')
const disclosureSensitiveRows = require('./disclosure-sensitive-rows.json')
const disclosureNoLongerRelevantRows = require('./disclosure-no-longer-relevant-rows.json')
const countsData = require('./case-indictments.json')
const chargeLibrary = require('./charge-library.json')

module.exports = {
  caseSort: 'Name',
  taskSort: 'Due date',
  caseMaterials,
  disclosureStatuses,
  disclosureNonSensitiveRows,
  disclosureSensitiveRows,
  disclosureNoLongerRelevantRows,
  countsData,
  chargeLibrary,

  // ✅ NEW: rows generated when CPS marks Evidence as "unused non-sensitive"
  disclosureAssessedUnusedRows: []
}