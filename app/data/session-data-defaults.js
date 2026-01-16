const caseMaterials = require('./case-materials.json');
const disclosureStatuses = require('./disclosure-statuses.json');
const disclosureNonSensitiveRows = require('./disclosure-non-sensitive-rows.json');

module.exports = {
  caseSort: 'Name',
  taskSort: 'Due date',
  caseMaterials,
  disclosureStatuses,
  disclosureNonSensitiveRows,

  // ✅ NEW: rows generated when CPS marks Evidence as "unused non-sensitive"
  disclosureAssessedUnusedRows: []
}
