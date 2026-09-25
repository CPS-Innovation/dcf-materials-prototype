const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const documentTypes = require('../data/document-types')
const { getPcdAppealForCase, getRawTaskWithAppealForCase, getCaseTaskPanelRows, resetAppealAssignmentMix } = require('../helpers/pcdAppeal')

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
    const caseAppealTasks = await getCaseTaskPanelRows(caseId)
    const tasks = [...caseAppealTasks, ...reminderTasks, ...placeholderTasks]

    // successBanner is already read from session, validated and cleared,
    // and exposed as res.locals.successBanner by the global flash
    // middleware in app/routes.js — passing it again here as an explicit
    // local would shadow that (and by this point session.data.successBanner
    // has already been cleared by that middleware, so it'd shadow it with
    // undefined).
    const { pcdAppeal } = await getPcdAppealForCase(caseId)

    res.render("cases/details/index", {
      _case,
      documents,
      documentTypeItems,
      selectedFilters,
      tasks,
      pcdAppeal
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

    const { pcdAppeal } = await getPcdAppealForCase(caseId)

    res.render("cases/details/show", {
      _case,
      documents,
      documentTypeItems,
      selectedFilters,
      pcdAppeal
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
  router.get('/cases/:caseId/pcd-appeal/decision', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const { pcdAppeal, taskId } = await getPcdAppealForCase(caseId)
    if (!pcdAppeal) return res.redirect(`/cases/${caseId}/details`)

    if (req.query.returnUrl) {
      req.session.data.pcdAppealDecisionDraft = {
        ...req.session.data.pcdAppealDecisionDraft,
        returnUrl: req.query.returnUrl
      }
    }

    res.render('cases/pcd-appeal/decision', {
      pcdAppeal,
      taskId,
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

  router.get('/cases/:caseId/pcd-appeal/decision/check', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const { pcdAppeal } = await getPcdAppealForCase(caseId)
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

  // PCD appeal DCP decision — writes the real PcdAppeal/PcdAppealCharge rows
  // (see prisma/schema.prisma) so the summary card on the case overview
  // actually grows in place after submit, persisted for real this time.
  router.post('/cases/:caseId/pcd-appeal/decision/check', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const task = await getRawTaskWithAppealForCase(caseId)
    const draft = req.session.data.pcdAppealDecisionDraft

    if (task && task.pcdAppeal && draft) {
      const currentUser = req.session.data.user

      for (const pac of task.pcdAppeal.charges.filter(c => c.appealed)) {
        const code = pac.charge ? pac.charge.chargeCode : pac.chargeCode
        await prisma.pcdAppealCharge.update({
          where: { id: pac.id },
          data: { decisionOutcome: outcomeLabels[draft['decision-' + code]] || 'Not recorded' }
        })
      }

      await prisma.pcdAppeal.update({
        where: { id: task.pcdAppeal.id },
        data: {
          dcpDecisionTestApplied: testLabels[draft['decision-test-applied']] || draft['decision-test-applied'],
          dcpDecisionReasoning: draft['decision-reasoning'],
          dcpDecisionByUserId: currentUser ? currentUser.id : null,
          dcpDecisionAt: new Date()
        }
      })
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
  // link) — undoes the write from the decision check route above, same
  // idea as "Reset Redact and Edit" further down this file. Also restores
  // the assigned/unassigned demo mix across BOTH tables (see
  // resetAppealAssignmentMix), since reassigning a task in one test
  // session mutates the same shared, global data every later session
  // reads — this is the one button facilitators have to put it back
  // between participants without redeploying.
  router.post('/cases/:caseId/pcd-appeal/reset', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const task = await getRawTaskWithAppealForCase(caseId)

    if (task && task.pcdAppeal) {
      await prisma.pcdAppealCharge.updateMany({
        where: { pcdAppealId: task.pcdAppeal.id },
        data: { decisionOutcome: null }
      })
      await prisma.pcdAppeal.update({
        where: { id: task.pcdAppeal.id },
        data: {
          dcpDecisionTestApplied: null,
          dcpDecisionReasoning: null,
          dcpDecisionByUserId: null,
          dcpDecisionAt: null
        }
      })
    }

    await resetAppealAssignmentMix()

    delete req.session.data.pcdAppealDecisionDraft
    res.redirect(req.body.returnTo || `/cases/${caseId}/details#overview`)
  })

  // Same assignment-mix reset as above, but not scoped to a single case's
  // page — the mix spans 10 cases (2, 3, 4, 5, 6, 7, 8, 14, 2001, 2002),
  // and the two tables that show it (/tasks?v=v2) have no _case at all, so
  // the per-case button above (footer.njk, gated to _case.id 2001/2002)
  // is invisible from everywhere a facilitator would actually notice
  // drifted assignments. This unconditional route/button is reachable from
  // any page, matching "Reset material notes/status" and "Reset no victim
  // demo" just above it in the footer.
  router.post('/pcd-appeal/reset-assignments', async (req, res) => {
    await resetAppealAssignmentMix()
    res.redirect(req.body.returnTo || '/tasks?v=v2')
  })

}