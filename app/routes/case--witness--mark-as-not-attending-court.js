const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {
  
  router.get("/cases/:caseId/witnesses/:witnessId/mark-as-not-attending-court", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: { defendants: true, witnesses: true },
    })

    const witness = await prisma.witness.findUnique({
      where: { id: parseInt(req.params.witnessId )}
    })


    res.render("cases/witnesses/mark-as-not-attending-court/index", { 
      _case,
      witness
    })
  })

  router.post("/cases/:caseId/witnesses/:witnessId/mark-as-not-attending-court", async (req, res) => {
    res.redirect(`/cases/${req.params.caseId}/witnesses/${req.params.witnessId}/mark-as-not-attending-court/check`)
  })

  router.get("/cases/:caseId/witnesses/:witnessId/mark-as-not-attending-court/check", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: { defendants: true, witnesses: true },
    })

    const witness = await prisma.witness.findUnique({
      where: { id: parseInt(req.params.witnessId )}
    })

    res.render("cases/witnesses/mark-as-not-attending-court/check", { 
      _case,
      witness
    })
  })

  router.post("/cases/:caseId/witnesses/:witnessId/mark-as-not-attending-court/check", async (req, res) => {
    let witness = await prisma.witness.update({
      where: { id: parseInt(req.params.witnessId) },
      data: {
        isAppearingInCourt: false,
        reasonForNotAppearingInCourt: req.session.data.markWitnessAsNotAttendingCourt.reason
      }
    })

    await prisma.activityLog.create({
      data: {
        userId: req.session.data.user.id,
        model: 'Witness',
        recordId: witness.id,
        action: 'UPDATE',
        title: 'Witness marked as not attending court',
        caseId: parseInt(req.params.caseId),
        meta: {
          witness: {
            id: witness.id,
            firstName: witness.firstName,
            lastName: witness.lastName
          },
          reason: witness.reasonForNotAppearingInCourt
        }
      }
    })

    delete req.session.data.markWitnessAsNotAttendingCourt

    // req.flash('success', `Witness marked as not attending court (${witness.firstName} ${witness.lastName})`)
    // res.redirect(`/cases/${req.params.caseId}/witnesses`)
    
    req.flash('success', 'Witness marked as not attending court')
    res.redirect(`/cases/${req.params.caseId}/witnesses/${req.params.witnessId}`)

  })

}