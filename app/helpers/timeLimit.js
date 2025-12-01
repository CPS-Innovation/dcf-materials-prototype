/**
 * Add time limit dates to a case object for CTL, STL, and PACE
 * Each property will be the soonest date for that type, or null if none exist
 *
 * @param {Object} _case - Case object with defendants (including charges)
 * @returns {Object} - The case object with custodyTimeLimit, statutoryTimeLimit, and paceTimeLimit properties added
 */
function addTimeLimitDates(_case) {
  const ctlDates = []
  const stlDates = []
  const paceDates = []

  _case.defendants.forEach(defendant => {
    if (defendant.paceTimeLimit) {
      paceDates.push(new Date(defendant.paceTimeLimit))
    }
    defendant.charges.forEach(charge => {
      if (charge.custodyTimeLimit) {
        ctlDates.push(new Date(charge.custodyTimeLimit))
      }
      if (charge.statutoryTimeLimit) {
        stlDates.push(new Date(charge.statutoryTimeLimit))
      }
    })
  })

  _case.custodyTimeLimit = ctlDates.length > 0 ? new Date(Math.min(...ctlDates)) : null
  _case.statutoryTimeLimit = stlDates.length > 0 ? new Date(Math.min(...stlDates)) : null
  _case.paceTimeLimit = paceDates.length > 0 ? new Date(Math.min(...paceDates)) : null

  return _case
}

module.exports = {
  addTimeLimitDates
}
