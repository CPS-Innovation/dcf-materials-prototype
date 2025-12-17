// routes/case--disclosure.js
const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {
  router.get('/cases/:caseId/disclosure', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) {
      return res.status(400).send('Invalid case id')
    }

    // Fetch case – same include block you use in materials
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

    if (!_case) {
      return res.status(404).render('not-found')
    }

    // Render your new disclosure index template
    // (the one without moj-page-header-actions__actions)
    res.render('cases/disclosure/index', {
      _case
    })
  })
}
