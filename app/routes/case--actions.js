const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {
  router.get("/cases/:caseId/actions", async (req, res) => {
    // Fetch case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: {
          include: {
            defenceLawyer: true,
            charges: true
          }
        },
        victims: true,
        witnesses: {
          include: {
            statements: true,
            specialMeasures: true
          }
        },
        hearings: true,
        location: true,
        tasks: true,
        directions: true,
        documents: true,
        dga: {
          include: {
            failureReasons: true
          }
        },
        notes: {
          include: {
            user: true            // ✅ Note.user
          }
        },
        activityLogs: {
          include: {
            user: true            // ✅ ActivityLog.user
          }
        },
        prosecutors: {
          include: {
            user: true            // ✅ CaseProsecutor.user
          }
        },
        paralegalOfficers: {
          include: {
            user: true            // ✅ CaseParalegalOfficer.user
          }
        }
      }
    })


    res.render("cases/actions/index", { _case })
  })

  // ------------------------------------------------------------------
  // SHOW: /cases/:caseId/actions/:defendantId
  // Lets links like <a href="/cases/{{ _case.id }}/actions/{{ defendant.id }}">
  // land on a single-defendant page, with a clean back link to the index.
  router.get('/cases/:caseId/actions/show', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const defendantId = parseInt(req.params.defendantId, 10)

    // Fetch case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: {
          include: {
            defenceLawyer: true,
            charges: true
          }
        },
        victims: true,
        witnesses: {
          include: {
            statements: true,
            specialMeasures: true
          }
        },
        hearings: true,
        location: true,
        tasks: true,
        directions: true,
        documents: true,
        dga: {
          include: {
            failureReasons: true
          }
        },
        notes: {
          include: {
            user: true            // ✅ Note.user
          }
        },
        activityLogs: {
          include: {
            user: true            // ✅ ActivityLog.user
          }
        },
        prosecutors: {
          include: {
            user: true            // ✅ CaseProsecutor.user
          }
        },
        paralegalOfficers: {
          include: {
            user: true            // ✅ CaseParalegalOfficer.user
          }
        }
      }
    })

    if (!_case) return res.status(404).render('not-found')

    const defendant = _case.defendants.find(d => d.id === defendantId)
    if (!defendant) return res.status(404).render('not-found')

    // Render a show view; create views/cases/defendants/show.njk if you don't have one
    return res.render('cases/actions/show', {
      _case,
      defendant,
      // pass this if your secondary nav highlights the Defendants tab
      secondaryNavId: 'actions'
    })
  })

}
