const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { addTimeLimitDates } = require('../helpers/timeLimit')

module.exports = router => {
  router.get("/cases/:caseId/defendants", async (req, res) => {
    let _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: {
        witnesses: true,
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
        defendants: {
          include: {
            charges: true,
            defenceLawyer: true
          }
        },
        location: true,
        tasks: true,
        dga: true
      }
    })

    _case = addTimeLimitDates(_case)

    res.render("cases/defendants/index", { _case })
  })

  // ------------------------------------------------------------------
  // SHOW: /cases/:caseId/defendants/:defendantId
  // Lets links like <a href="/cases/{{ _case.id }}/defendants/{{ defendant.id }}">
  // land on a single-defendant page, with a clean back link to the index.
  router.get('/cases/:caseId/defendants/:defendantId', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const defendantId = parseInt(req.params.defendantId, 10)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        user: true,
        witnesses: true,
        lawyers: true,
        defendants: true,
        //hearing: true,
        location: true,
        tasks: true,
        dga: true
      }
    })
    if (!_case) return res.status(404).render('not-found')

    const defendant = _case.defendants.find(d => d.id === defendantId)
    if (!defendant) return res.status(404).render('not-found')

    // Render a show view; create views/cases/defendants/show.njk if you don't have one
    return res.render('cases/defendants/show', {
      _case,
      defendant,
      // pass this if your secondary nav highlights the Defendants tab
      secondaryNavId: 'defendants'
    })
  })

}
