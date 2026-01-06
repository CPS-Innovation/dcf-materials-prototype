const caseMaterials = require('./case-materials.json');
const disclosureStatuses = require('./disclosure-statuses.json');
const disclosureNonSensitiveRows = require('./disclosure-non-sensitive-rows.json');

module.exports = {
  caseSort: 'Name',
  taskSort: 'Due date',
  // Insert values here
  caseMaterials,
  disclosureStatuses,
  disclosureNonSensitiveRows

}
