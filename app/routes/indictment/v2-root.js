// app/routes/indictment/v2-root.js
// V2 overrides for indictment root routes.
// Renders from views/v2/ so v1 templates are untouched.

const {
  _,
  fetchCase,
  parseCaseId,
  getCountsCaseFor,
  buildChargeOptionsFromCountsCase,
  buildChargeOptionsFromPrismaCase,
  chargeLibrary
} = require('./_shared')

module.exports = router => {

  // GET /cases/:caseId/indictment
  // V2 override — same URL as v1, but Express matches this first because
  // case--indictment-v2.js is required before case--indictment.js.
  // res.render uses a plain path; the version middleware adds v2/ automatically.
  router.get('/cases/:caseId/indictment', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found`)

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)
    const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

    const isCompleted = _.get(req, `session.data.indictmentCompleted.${caseId}`, false)
    const completedIndictment = _.get(req, `session.data.completedIndictments.${caseId}`, null)

    const indictment = (isCompleted && completedIndictment)
      ? completedIndictment
      : _.get(req, `session.data.indictments.${caseId}`, {
          status: isCompleted ? 'Completed' : 'Not started',
          counts: []
        })

    const successBanner = _.get(req, 'session.data.successBanner', null)
    _.unset(req, 'session.data.successBanner')

    // Plain path — version middleware prepends v1/ or v2/ automatically
    return res.render('cases/indictment/index', {
      _case,
      indictment,
      isCompleted,
      completedIndictment,
      readOnlyUrl: `/cases/${caseId}/indictment/preview/read-only`,
      successBanner,
      countsCase,
      chargeOptions,
      caseChargeOptions,
      chargeLibrary
    })
  })

}
