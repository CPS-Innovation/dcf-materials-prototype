// app/routes/indictment/v2-counts.js
//
// V2 overrides for count-related routes.
// Only routes where the v2 flow differs from v1 live here.
// Register this BEFORE the v1 counts.js (via case--indictment-v2.js).

const {
  _,
  fetchCase,
  parseCaseId,
  safeReturnTo,
  getCountsCaseFor,
  buildChargeOptionsFromCountsCase,
  chargeLibrary                          // ← add
} = require('./_shared')

module.exports = router => {

  // ============================================================
  // GET /cases/:caseId/indictment/counts/date-and-charges (V2)
  //
  // In v1 this page relies on /counts/charges having run first to
  // populate selectedChargeCodes in the session.
  //
  // In v2 the /counts/charges step is removed, so we auto-seed from
  // countsCase.policeCharges (case-indictments.json) which is already
  // enriched with policeCharge from the charge library via
  // buildChargeOptionsFromCountsCase.
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)

    // Use the counts case builder — reads from case-indictments.json
    // and enriches each charge with policeCharge from the charge library
    const allChargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const draftCount = _.get(req, `${draftBasePath}.currentCount`, {})

    // Read shared charge pool from session
    let sharedSelectedChargeCodes =
      (_.get(req, `${draftBasePath}.selectedChargeCodes`, []) || []).map(String)

    // V2: /counts/charges was skipped so pool will be empty on first visit.
    // Auto-seed from all case charges so the radios have options to show.
    if (!sharedSelectedChargeCodes.length) {
      sharedSelectedChargeCodes = allChargeOptions.map(c => String(c.chargeCode))
      _.set(req, `${draftBasePath}.selectedChargeCodes`, sharedSelectedChargeCodes)
    }

    // Sync onto draftCount too (keeps downstream steps consistent)
    if (!draftCount.selectedChargeCodes || !draftCount.selectedChargeCodes.length) {
      draftCount.selectedChargeCodes = sharedSelectedChargeCodes
    }

    const selectedChargeOptions = allChargeOptions.filter(c =>
      sharedSelectedChargeCodes.includes(String(c.chargeCode))
    )

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/date-and-charges', {
      _case,
      countsCase,
      selectedChargeOptions,
      caseChargeOptions: allChargeOptions,
      chargeLibrary,                     // ← add
      draftCount,
      returnTo
    })
  })

}