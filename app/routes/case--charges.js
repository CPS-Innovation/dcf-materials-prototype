const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// ------------------------------------------------------------------
// Mock victim pool — mirrors defendants.njk until Charge model has
// real victimId / victimName fields in schema.prisma.
// Replace with _case.victims once the relation exists.
const mockVictimPool = [
  { id: '1', name: 'Frank Carter',   status: 'Intimidated' },
  { id: '2', name: 'Barry Jones',    status: 'Vulnerable'  },
  { id: '3', name: 'Ellie Campbell', status: 'Intimidated' },
  { id: '4', name: 'Sunita Patel',   status: 'Vulnerable'  }
]

// ------------------------------------------------------------------
// Formats a victim name from "LAST, First" (DB format) to "First Last".
// Safe to call on already-formatted strings or null values.
// Remove once the Charge model stores names in a structured format.
function formatVictimName (raw) {
  if (!raw) return null
  if (!raw.includes(',')) return raw
  const [last, first] = raw.split(', ')
  return `${first} ${last[0]}${last.slice(1).toLowerCase()}`
}

module.exports = router => {

  // ------------------------------------------------------------------
  // Shared helper — fetches case with defendants + charges.
  // Used by every step in the edit flow.
  async function getCaseWithCharges (caseId) {
    return prisma.case.findUnique({
      where: { id: parseInt(caseId, 10) },
      include: {
        defendants: {
          include: {
            charges: true,
            defenceLawyer: true
          }
        },
        location: true,
        victims: true,
        witnesses: true
      }
    })
  }

  // Resolves the specific charge and its owning defendant from a loaded case.
  function resolveCharge (_case, chargeId) {
    const id        = parseInt(chargeId, 10)
    const charge    = _case.defendants.flatMap(d => d.charges).find(c => c.id === id)
    const defendant = _case.defendants.find(d => d.charges.some(c => c.id === id))
    return { charge, defendant }
  }


  // ------------------------------------------------------------------
  // NEW FLOW ENTRY — /cases/:caseId/charges/edit/check
  // Starting point for the new proposed charge edit flow (no chargeId in path).
  router.get('/cases/:caseId/charges/edit/check', async (req, res) => {
    const caseId = req.params.caseId
    const _case = await getCaseWithCharges(caseId)
    if (!_case) return res.status(404).render('not-found')

    // Persist chargeId in session so downstream pages (particulars etc.) can resolve it
    if (req.query.chargeId) {
      req.session.data.editCharge = { ...req.session.data.editCharge, chargeId: req.query.chargeId }
    }

    const editCharge = req.session.data.editCharge || {}

    const { charge, defendant } = editCharge.chargeId
      ? resolveCharge(_case, editCharge.chargeId)
      : { charge: {}, defendant: {} }

    return res.render('v2/cases/charges/edit/check', {
      _case,
      charge,
      defendant,
      editCharge,
      witnesses: _case.witnesses,
      base: `/cases/${caseId}/charges/edit`
    })
  })

  // ------------------------------------------------------------------
  // NEW FLOW — PARTICULARS  /cases/:caseId/charges/edit/particulars
  router.get('/cases/:caseId/charges/edit/particulars', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const editCharge = req.session.data.editCharge || {}
    const { charge, defendant } = editCharge.chargeId
      ? resolveCharge(_case, editCharge.chargeId)
      : { charge: {}, defendant: {} }

    if (req.query.returnUrl) {
      req.session.data.editCharge = { ...editCharge, returnUrl: req.query.returnUrl }
    }

    return res.render('v2/cases/charges/edit/particulars', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/edit/particulars', (req, res) => {
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      particulars: req.body.particulars
    }

    const returnUrl = req.session.data.editCharge?.returnUrl
    if (returnUrl) {
      delete req.session.data.editCharge.returnUrl
      return res.redirect(returnUrl)
    }

    return res.redirect(`/cases/${req.params.caseId}/charges/edit/check`)
  })


  // ------------------------------------------------------------------
  // STEP 1 — DATE
  // GET  /cases/:caseId/charges/:chargeId/edit/date
  // POST /cases/:caseId/charges/:chargeId/edit/date  →  victim
  router.get('/cases/:caseId/charges/:chargeId/edit/date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    // Seed session with current charge data on first visit
    if (!req.session.data.editCharge) {
      req.session.data.editCharge = {
        offenceDate: charge.offenceDate
      }
    }

    return res.render('v2/cases/charges/edit/date', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/date', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit`
    if (req.body.correctDate === 'Yes') {
      return res.redirect(`${base}/date-type`)
    }
    return res.redirect(`${base}/victim`)
  })


  // ------------------------------------------------------------------
  // STEP 1b — DATE TYPE
  // GET  /cases/:caseId/charges/:chargeId/edit/date-type
  // POST /cases/:caseId/charges/:chargeId/edit/date-type  →  single-date | multiple-date
  router.get('/cases/:caseId/charges/:chargeId/edit/date-type', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')
    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    // Capture returnUrl from query string and persist in session
    if (req.query.returnUrl) {
      req.session.data.editCharge = {
        ...req.session.data.editCharge,
        returnUrl: req.query.returnUrl
      }
    }

    return res.render('v2/cases/charges/edit/date-type', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/date-type', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit`
    req.session.data.editCharge = { ...req.session.data.editCharge, dateType: req.body.dateType }

    // returnUrl is already in session from the date-type GET — no need to thread it
    // through the query string. It will survive naturally to single/multiple-date POST.
    if (req.body.dateType === 'singleDate') return res.redirect(`${base}/single-date`)
    return res.redirect(`${base}/multiple-date`)
  })


  // ------------------------------------------------------------------
  // STEP 1c — SINGLE DATE
  // GET  /cases/:caseId/charges/:chargeId/edit/single-date
  // POST /cases/:caseId/charges/:chargeId/edit/single-date  →  check (returnUrl) | victim
  router.get('/cases/:caseId/charges/:chargeId/edit/single-date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')
    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    return res.render('v2/cases/charges/edit/single-date', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/single-date', (req, res) => {
    req.session.data.editCharge = { ...req.session.data.editCharge, offenceDate: req.body.offenceDate }

    const returnUrl = req.session.data.editCharge?.returnUrl
    if (returnUrl) {
      delete req.session.data.editCharge.returnUrl
      return res.redirect(returnUrl)
    }

    return res.redirect(`/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/victim`)
  })


  // ------------------------------------------------------------------
  // STEP 1d — MULTIPLE DATES
  // GET  /cases/:caseId/charges/:chargeId/edit/multiple-date
  // POST /cases/:caseId/charges/:chargeId/edit/multiple-date  →  check (returnUrl) | victim
  router.get('/cases/:caseId/charges/:chargeId/edit/multiple-date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')
    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    return res.render('v2/cases/charges/edit/multiple-date', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/multiple-date', (req, res) => {
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      offenceDateFrom: req.body.offenceDateFrom,
      offenceDateTo:   req.body.offenceDateTo
    }

    const returnUrl = req.session.data.editCharge?.returnUrl
    if (returnUrl) {
      delete req.session.data.editCharge.returnUrl
      return res.redirect(returnUrl)
    }

    return res.redirect(`/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/victim`)
  })


  // ------------------------------------------------------------------
  // STEP 2 — VICTIM (confirm current victim)
  // GET  /cases/:caseId/charges/:chargeId/edit/victim
  // POST →  summary (Yes) | select-victim (No)
  router.get('/cases/:caseId/charges/:chargeId/edit/victim', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    // Pull current victim name from session (set when Edit is clicked from
    // defendants.njk via ?victimName=) or fall back to first mock victim.
    // Replace with a real DB lookup once Charge has a victimId field.
    const currentVictimName = formatVictimName(
      req.session.data.editCharge?.victimName
      || req.query.victimName
      || mockVictimPool[0].name
    )

    // Persist into session so it survives across steps
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      victimName: currentVictimName
    }

    return res.render('v2/cases/charges/edit/victim', {
      _case,
      charge,
      defendant,
      currentVictimName
    })
  })

  // FIXED
  router.post('/cases/:caseId/charges/:chargeId/edit/victim', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit`
    if (req.body.hasVictim === 'Yes') {
      return res.redirect(`${base}/select-victim`)         // ✅ Yes = change victim
    }
    return res.redirect(`${base}/summary`)     // ✅ No = keep victim
  })


  // ------------------------------------------------------------------
  // STEP 2b — SELECT VICTIM
  // GET  /cases/:caseId/charges/:chargeId/edit/select-victim
  // POST →  check (returnUrl) | summary
  router.get('/cases/:caseId/charges/:chargeId/edit/select-victim', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    // Capture returnUrl from query string and persist in session
    if (req.query.returnUrl) {
      req.session.data.editCharge = {
        ...req.session.data.editCharge,
        returnUrl: req.query.returnUrl
      }
    }

    // Exclude the current victim so they don't appear as a selectable option
    const currentVictimName = req.session.data.editCharge?.victimName || null
    const availableVictims  = mockVictimPool.filter(v => v.name !== currentVictimName)

    return res.render('v2/cases/charges/edit/select-victim', {
      _case,
      charge,
      defendant,
      victims: availableVictims
    })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/select-victim', (req, res) => {
    const selectedVictim = mockVictimPool.find(v => v.id === req.body.victimId) || null
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      victimId:   req.body.victimId,
      victimName: selectedVictim ? formatVictimName(selectedVictim.name) : null
    }

    const returnUrl = req.session.data.editCharge?.returnUrl
    if (returnUrl) {
      delete req.session.data.editCharge.returnUrl
      return res.redirect(returnUrl)
    }

    return res.redirect(`/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/summary`)
  })


  // ------------------------------------------------------------------
  // STEP 3 — SUMMARY (charge particulars)
  // GET  /cases/:caseId/charges/:chargeId/edit/summary
  // POST /cases/:caseId/charges/:chargeId/edit/summary  →  check
  router.get('/cases/:caseId/charges/:chargeId/edit/summary', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    return res.render('v2/cases/charges/edit/summary', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/summary', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit`
    if (req.body.chargeParticularsCorrect === 'Yes') {
      return res.redirect(`${base}/particulars`)
    }
    return res.redirect(`${base}/check`)
  })


  // ------------------------------------------------------------------
  // STEP 3b — PARTICULARS (edit the text)
  // GET  /cases/:caseId/charges/:chargeId/edit/particulars
  // POST /cases/:caseId/charges/:chargeId/edit/particulars  →  check (returnUrl) | check
  router.get('/cases/:caseId/charges/:chargeId/edit/particulars', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    // Capture returnUrl from query string and persist in session
    if (req.query.returnUrl) {
      req.session.data.editCharge = {
        ...req.session.data.editCharge,
        returnUrl: req.query.returnUrl
      }
    }

    return res.render('v2/cases/charges/edit/particulars', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/particulars', (req, res) => {
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      particulars: req.body.particulars
    }

    const returnUrl = req.session.data.editCharge?.returnUrl
    if (returnUrl) {
      delete req.session.data.editCharge.returnUrl
      return res.redirect(returnUrl)
    }

    return res.redirect(
      `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/check`
    )
  })


  // ------------------------------------------------------------------
  // STEP 4 — CHECK ANSWERS
  // GET  /cases/:caseId/charges/:chargeId/edit/check
  // POST /cases/:caseId/charges/:chargeId/edit/check  →  saves + back to charges index
  router.get('/cases/:caseId/charges/:chargeId/edit/check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    const editCharge = req.session.data.editCharge || {}

    return res.render('v2/cases/charges/edit/check', {
      _case,
      charge,
      defendant,
      editCharge,
      witnesses: _case.witnesses
    })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/check', async (req, res) => {
    const chargeId   = parseInt(req.params.chargeId, 10)
    const editCharge = req.session.data.editCharge || {}

    // Persist changes back to the database
    await prisma.charge.update({
      where: { id: chargeId },
      data: {
        offenceDate: editCharge.offenceDate ? new Date(editCharge.offenceDate) : undefined,
        particulars: editCharge.particulars || undefined
        // victimName / victimStatus: add here once fields exist on the Charge model
      }
    })

    // Clear the edit session data
    delete req.session.data.editCharge

    return res.redirect(`/cases/${req.params.caseId}/defendants?success=charge-updated`)
  })

}