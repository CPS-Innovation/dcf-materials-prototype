const caseMaterials = require('./case-materials.json')
const disclosureStatuses = require('./disclosure-statuses.json')
const disclosureNonSensitiveRows = require('./disclosure-non-sensitive-rows.json')
const countsData = require('./case-indictments.json')

module.exports = {
  caseSort: 'Name',
  taskSort: 'Due date',
  caseMaterials,
  disclosureStatuses,
  disclosureNonSensitiveRows,
  countsData,

  // ✅ NEW: rows generated when CPS marks Evidence as "unused non-sensitive"
  disclosureAssessedUnusedRows: []
}
