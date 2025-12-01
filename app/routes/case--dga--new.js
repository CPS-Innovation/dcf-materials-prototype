const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

let outcomes = {
  NOT_DISPUTED: "Not disputed",
  DISPUTED_SUCCESSFULLY: "Disputed successfully",
  DISPUTED_UNSUCCESSFULLY: "Disputed unsuccessfully",
}

module.exports = router => {
  router.get("/cases/:caseId/dga/new", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: {
        prosecutors: {
          include: {
            user: true
          }
        },
        paralegalOfficers: {
          include: {
            user: true
          }
        },
        defendants: true,
        hearing: true,
        location: true,
        tasks: true,
        dga: true
      },
    })

    res.render("cases/dga/new/index", { _case })
  })

  router.post("/cases/:caseId/dga/new", (req, res) => {
    res.redirect(`/cases/${req.params.caseId}/dga/new/check`)
  })

  router.get("/cases/:caseId/dga/new/check", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: {
        prosecutors: {
          include: {
            user: true
          }
        },
        paralegalOfficers: {
          include: {
            user: true
          }
        },
        defendants: true,
        hearing: true,
        location: true,
        tasks: true,
        dga: true
      },
    })



    let outcome = outcomes[req.session.data.recordDGA.outcome]

    res.render("cases/dga/new/check", { _case, outcome })
  })

  router.post("/cases/:caseId/dga/new/check", async (req, res) => {
    let caseId = parseInt(req.params.caseId)
    let outcome = req.session.data.recordDGA.outcome
  
    await prisma.DGA.update({
      where: { caseId },
      data: { outcome }
    })

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        prosecutors: {
          include: {
            user: true
          }
        },
        paralegalOfficers: {
          include: {
            user: true
          }
        },
        defendants: true,
        hearing: true,
        location: true,
        tasks: true,
        dga: true
      },
    })

    await prisma.activityLog.create({
      data: {
        userId: req.session.data.user.id,
        model: 'Case',
        recordId: caseId,
        action: 'UPDATE',
        title: 'DGA recorded',
        caseId: caseId,
        meta: { outcome: outcomes[outcome] }
      }
    })

    delete req.session.data.recordDGA

    req.flash('success', 'DGA recorded')

    res.redirect(`/cases/${req.params.caseId}`)
  })

}