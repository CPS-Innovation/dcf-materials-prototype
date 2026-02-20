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

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})
    const stepStatus = _.get(req, `session.data.indictmentDrafts.${caseId}.stepStatus`, {})

    const successBanner = _.get(req, 'session.data.successBanner', null)
    _.unset(req, 'session.data.successBanner')

    return res.render('cases/indictment/index', {
      _case,
      indictment,
      draftCount,
      stepStatus,
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