const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const documentTypes = require('../data/document-types')
const pcdAppealCases = require('../data/pcd-appeal-cases')

function resetFilters(req) {
  _.set(req, 'session.data.documentListFilters.documentTypes', null)
}

module.exports = router => {
  router.get("/cases/:caseId/details", async (req, res) => {
    const caseId = parseInt(req.params.caseId)

    let selectedDocumentTypeFilters = _.get(req.session.data.documentListFilters, 'documentTypes', [])

    let selectedFilters = { categories: [] }

    // Document type filter display
    if (selectedDocumentTypeFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'Type' },
        items: selectedDocumentTypeFilters.map(function(label) {
          return { text: label, href: `/cases/${caseId}/material/remove-type/${label}` }
        })
      })
    }

    

    // Build Prisma where clause for documents
    let where = { caseId: caseId, AND: [] }

    if (selectedDocumentTypeFilters?.length) {
      where.AND.push({ type: { in: selectedDocumentTypeFilters } })
    }

    if (where.AND.length === 0) {
      delete where.AND
    }

    // Fetch the case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: {
          include: {
            defenceLawyer: true,
            charges: { include: { victim: true } }
          }
        },
        victims: { orderBy: { id: 'asc' } },
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
            user: true
          }
        },
        activityLogs: {
          include: {
            user: true
          }
        },
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
        factualSummaryVersions: {
          orderBy: { createdAt: 'desc' }
        }
      }
    })


    // Fetch documents with filters
    let documents = await prisma.document.findMany({
      where: where
    })

    // Search by document name
    let keywords = _.get(req.session.data.documentSearch, 'keywords')

    if(keywords) {
      keywords = keywords.toLowerCase()
      documents = documents.filter(document => {
        let documentName = document.name.toLowerCase()
        return documentName.indexOf(keywords) > -1
      })
    }

    // Session is the sole source of truth for 'Discontinued' status.
    // Charges not tracked here (including stale DB writes) are reset.
    const discontinuedIds = req.session.data.discontinuedChargeIds || []
    if (_case) {
      _case.defendants.forEach(defendant => {
        defendant.charges.forEach(charge => {
          if (discontinuedIds.includes(charge.id)) {
            charge.status = 'Discontinued'
          } else if (charge.status === 'Discontinued') {
            charge.status = 'Charged'
          }
        })
      })
    }

    let documentTypeItems = documentTypes.map(docType => ({
      text: docType,
      value: docType
    }))

    const placeholderTasks = [
      { name: 'Retrieve core details',  dueDate: '24 April 2026', status: 'Done', owner: 'Joe Bloggs',     hasWarning: false },
      { name: 'Prepare victim letter',  dueDate: '15 March 2026', status: 'Done', owner: 'Anni Arryuokay', hasWarning: false },
      { name: 'Request upgrade file',   dueDate: '06 Feb 2026',   status: 'Done', owner: 'Frank Bobbins',  hasWarning: false }
    ]
    const proposedDiscontinuanceIds = req.session.data.proposedDiscontinuanceChargeIds || []
    if (_case) {
      _case.defendants.forEach(defendant => {
        defendant.charges.forEach(charge => {
          if (proposedDiscontinuanceIds.includes(charge.id)) {
            charge.status = 'Discontinuance proposed'
          }
        })
      })
    }

    const reminderTasks = req.session.data.reminderTasks || []
    const tasks = [...reminderTasks, ...placeholderTasks]

    // successBanner is already read from session, validated and cleared,
    // and exposed as res.locals.successBanner by the global flash
    // middleware in app/routes.js — passing it again here as an explicit
    // local would shadow that (and by this point session.data.successBanner
    // has already been cleared by that middleware, so it'd shadow it with
    // undefined).
    res.render("cases/details/index", {
      _case,
      documents,
      documentTypeItems,
      selectedFilters,
      tasks,
      pcdAppeal: pcdAppealCases[caseId] || null
    })
  })


  /////////////////////////////////////////////////////////////////////

    router.get("/cases/:caseId/details/show", async (req, res) => {
    const caseId = parseInt(req.params.caseId)

    let selectedDocumentTypeFilters = _.get(req.session.data.documentListFilters, 'documentTypes', [])

    let selectedFilters = { categories: [] }

    // Document type filter display
    if (selectedDocumentTypeFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'Type' },
        items: selectedDocumentTypeFilters.map(function(label) {
          return { text: label, href: `/cases/${caseId}/material/remove-type/${label}` }
        })
      })
    }

    

    // Build Prisma where clause for documents
    let where = { caseId: caseId, AND: [] }

    if (selectedDocumentTypeFilters?.length) {
      where.AND.push({ type: { in: selectedDocumentTypeFilters } })
    }

    if (where.AND.length === 0) {
      delete where.AND
    }

    // Fetch case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: {
          include: {
            defenceLawyer: true,
            charges: { include: { victim: true } }
          }
        },
        victims: { orderBy: { id: 'asc' } },
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
            user: true
          }
        },
        activityLogs: {
          include: {
            user: true
          }
        },
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
        factualSummaryVersions: {
          orderBy: { createdAt: 'desc' }
        }
      }
    })


    // Fetch documents with filters
    let documents = await prisma.document.findMany({
      where: where
    })

    // Search by document name
    let keywords = _.get(req.session.data.documentSearch, 'keywords')

    if(keywords) {
      keywords = keywords.toLowerCase()
      documents = documents.filter(document => {
        let documentName = document.name.toLowerCase()
        return documentName.indexOf(keywords) > -1
      })
    }

    // Session is the sole source of truth for 'Discontinued' status.
    // Charges not tracked here (including stale DB writes) are reset.
    const discontinuedIds2 = req.session.data.discontinuedChargeIds || []
    if (_case) {
      _case.defendants.forEach(defendant => {
        defendant.charges.forEach(charge => {
          if (discontinuedIds2.includes(charge.id)) {
            charge.status = 'Discontinued'
          } else if (charge.status === 'Discontinued') {
            charge.status = 'Charged'
          }
        })
      })
    }

    let documentTypeItems = documentTypes.map(docType => ({
      text: docType,
      value: docType
    }))

    res.render("cases/details/show", {
      _case,
      documents,
      documentTypeItems,
      selectedFilters,
      pcdAppeal: pcdAppealCases[caseId] || null
    })
  })

  router.get('/cases/:caseId/details/remove-type/:type', (req, res) => {
    _.set(req, 'session.data.documentListFilters.documentTypes', _.pull(req.session.data.documentListFilters.documentTypes, req.params.type))
    res.redirect(`/cases/${req.params.caseId}/details`)
  })

  router.get('/cases/:caseId/details/clear-filters', (req, res) => {
    resetFilters(req)
    res.redirect(`/cases/${req.params.caseId}/details`)
  })

  router.get('/cases/:caseId/details/clear-search', (req, res) => {
    _.set(req, 'session.data.documentSearch.keywords', '')
    res.redirect(`/cases/${req.params.caseId}/details`)
  })

  const testLabels = {
    'full-code': 'Full Code Test',
    'threshold': 'Threshold Test'
  }
  const outcomeLabels = {
    uphold: 'Reject — charge not authorised',
    overturn: 'Accept — charge authorised'
  }

  // PCD appeal DCP decision — standalone page (Start task lands here,
  // matching how every other task type in this app opens its own page
  // rather than an inline form). Draft answers live in session (same
  // pattern as case--charges-discontinue.js) so the check-your-answers
  // page below can read them back and Change links can round-trip here.
  router.get('/cases/:caseId/pcd-appeal/decision', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const pcdAppeal = pcdAppealCases[caseId]
    if (!pcdAppeal) return res.redirect(`/cases/${caseId}/details`)

    if (req.query.returnUrl) {
      req.session.data.pcdAppealDecisionDraft = {
        ...req.session.data.pcdAppealDecisionDraft,
        returnUrl: req.query.returnUrl
      }
    }

    res.render('cases/pcd-appeal/decision', {
      pcdAppeal,
      draft: req.session.data.pcdAppealDecisionDraft || {}
    })
  })

  router.post('/cases/:caseId/pcd-appeal/decision', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const returnUrl = req.session.data.pcdAppealDecisionDraft?.returnUrl || null

    req.session.data.pcdAppealDecisionDraft = {
      ...req.body,
      returnUrl: null
    }

    res.redirect(returnUrl || `/cases/${caseId}/pcd-appeal/decision/check`)
  })

  // ── check ─────────────────────────────────────────────────────────

  router.get('/cases/:caseId/pcd-appeal/decision/check', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const pcdAppeal = pcdAppealCases[caseId]
    const draft = req.session.data.pcdAppealDecisionDraft
    if (!pcdAppeal || !draft) return res.redirect(`/cases/${caseId}/pcd-appeal/decision`)

    const appealedCharges = pcdAppeal.originalDecision.charges.filter(charge => charge.appealed)

    const chargeDecisionsSummary = appealedCharges
      .map(charge => `${charge.code}: ${outcomeLabels[draft['decision-' + charge.code]] || 'Not answered'}`)
      .join('<br>')

    res.render('cases/pcd-appeal/check', {
      pcdAppeal,
      chargeDecisionsSummary,
      testAppliedSummary: testLabels[draft['decision-test-applied']] || draft['decision-test-applied'],
      reasoningSummary: draft['decision-reasoning']
    })
  })

  // PCD appeal DCP decision — mutates the in-memory mock record (see
  // app/data/pcd-appeal-cases.js) so the summary card on the case overview
  // actually grows in place after submit. Not real persistence — it's
  // process-memory only and resets on server restart — but it lets the
  // whole journey be demoed end to end on one case, not just shown
  // structurally via two permanently-different mock cases.
  router.post('/cases/:caseId/pcd-appeal/decision/check', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const pcdAppeal = pcdAppealCases[caseId]
    const draft = req.session.data.pcdAppealDecisionDraft

    if (pcdAppeal && draft) {
      const currentUser = req.session.data.user
      const decidedBy = currentUser ? `DCP — ${currentUser.firstName} ${currentUser.lastName}` : 'DCP'

      pcdAppeal.dcpDecision = {
        chargeOutcomes: pcdAppeal.originalDecision.charges
          .filter(charge => charge.appealed)
          .map(charge => ({
            code: charge.code,
            outcome: outcomeLabels[draft['decision-' + charge.code]] || 'Not recorded'
          })),
        testApplied: testLabels[draft['decision-test-applied']] || draft['decision-test-applied'],
        reasoning: draft['decision-reasoning'],
        decidedBy,
        decidedDateDisplay: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      }
    }

    delete req.session.data.pcdAppealDecisionDraft

    _.set(req, 'session.data.successBanner', {
      titleText: 'Decision recorded',
      text: 'The PCD appeal decision has been recorded.',
      body: 'A formal MG3A-equivalent document and notification back to police still need to be sent outside this prototype.'
    })
    res.redirect(`/cases/${caseId}/details#overview`)
  })

  // Reset the PCD appeal demo back to its pending state (footer testing
  // link) — undoes the in-memory mutation from the decision check route
  // above, same idea as "Reset Redact and Edit" further down this file.
  router.post('/cases/:caseId/pcd-appeal/reset', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const pcdAppeal = pcdAppealCases[caseId]
    if (pcdAppeal) pcdAppeal.dcpDecision = null
    delete req.session.data.pcdAppealDecisionDraft
    res.redirect(req.body.returnTo || `/cases/${caseId}/details#overview`)
  })

}