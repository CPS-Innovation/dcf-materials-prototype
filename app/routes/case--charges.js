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

// Annotates each victim with isPure.
// Primary: victim is pure if their name doesn't appear in the witness list.
// Fallback A (multi-victim, all pure): make first victim pure, rest non-pure.
// Fallback B (single victim or all pure after A): inject the first witness as a
//   synthetic non-pure option (id prefixed "w-") so both flows are always demoable.
function annotateVictims (victims, witnesses) {
  const witnessNames = new Set((witnesses || []).map(w => `${w.firstName} ${w.lastName}`))
  let annotated = victims.map(v => ({
    ...v,
    isPure: !witnessNames.has(`${v.firstName} ${v.lastName}`)
  }))

  const hasNonPure = () => annotated.some(v => !v.isPure)

  if (!hasNonPure() && annotated.length > 1) {
    annotated = annotated.map((v, i) => ({ ...v, isPure: i === 0 }))
  }

  if (!hasNonPure() && (witnesses || []).length > 0) {
    const w = witnesses[0]
    annotated.push({ id: `w-${w.id}`, firstName: w.firstName, lastName: w.lastName, isPure: false })
  }

  return annotated
}

// Resolves a submitted/selected victimId to a victim + isPure flag, whether
// it's an existing case victim or one just "imported" via the CMS Classic
// interstitial (not yet on _case.victims — that's the point: it isn't known
// to Manage Cases until this step confirms it).
async function resolveSelectedVictim (victimId, _case, victims) {
  if (!victimId || victimId === 'none') return null

  const known = victims.find(v => String(v.id) === String(victimId))
  if (known) return known

  const raw = await prisma.victim.findUnique({ where: { id: parseInt(victimId, 10) } })
  if (!raw) return null

  const witnessNames = new Set((_case.witnesses || []).map(w => `${w.firstName} ${w.lastName}`))
  return { ...raw, isPure: !witnessNames.has(`${raw.firstName} ${raw.lastName}`) }
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
            charges: { include: { victim: true } },
            defenceLawyer: true
          }
        },
        location: true,
        victims: { orderBy: { id: 'asc' } },
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
  // NEW FLOW — /cases/:caseId/charges/edit/check
  // Shared renderer for both entry points below.
  async function renderCheckPage (req, res) {
    const caseId = req.params.caseId
    const _case = await getCaseWithCharges(caseId)
    if (!_case) return res.status(404).render('not-found')

    const editCharge = req.session.data.editCharge || {}
    const chargeId = editCharge.chargeId || req.params.chargeId

    const { charge, defendant } = chargeId
      ? resolveCharge(_case, chargeId)
      : { charge: {}, defendant: {} }

    const chargeIndex = defendant && defendant.charges
      ? defendant.charges.findIndex(c => c.id === parseInt(chargeId, 10))
      : -1
    const victims = _case.victims || []
    const positionVictim = victims.length && chargeIndex >= 0
      ? victims[chargeIndex % victims.length]
      : null

    return res.render('v2/cases/charges/edit/check', {
      _case,
      charge,
      defendant,
      editCharge,
      positionVictim,
      witnesses: _case.witnesses,
      base: `/cases/${caseId}/charges/${charge.id}/edit`,
      checkUrl: `/cases/${caseId}/charges/edit/check`
    })
  }

  // Fresh entry point (no chargeId in path) — e.g. linked from the tasks list.
  // Always starts fresh, preventing stale session state leaking from a
  // previously abandoned edit into this new one.
  // victimId is optional — lets a link pre-set the victim display (e.g. "none")
  // without going through the select-victim step first.
  router.get('/cases/:caseId/charges/edit/check', async (req, res) => {
    if (req.query.chargeId) {
      req.session.data.editCharge = {
        chargeId: req.query.chargeId,
        ...(req.query.victimId && { victimId: req.query.victimId })
      }
    }
    return renderCheckPage(req, res)
  })

  // Mid-flow return (chargeId already in the path) — e.g. redirected here from
  // victim-status after selecting/confirming a victim. Session already reflects
  // the in-progress edit, so this does NOT reset it.
  router.get('/cases/:caseId/charges/:chargeId/edit/check', async (req, res) => {
    return renderCheckPage(req, res)
  })

  router.post('/cases/:caseId/charges/edit/check', async (req, res) => {
    const caseId     = parseInt(req.params.caseId, 10)
    const editCharge = req.session.data.editCharge || {}
    const chargeId   = parseInt(editCharge.chargeId, 10)

    if (chargeId) {
      // govukDateInput with namePrefix="offenceDate" posts three separate keys
      // (offenceDate-day/-month/-year) that the kit stores at top-level session.data.
      // req.body.offenceDate is therefore undefined; reconstruct the date from those keys.
      const d = req.session.data
      let newOffenceDate = null
      if (d['dateType'] === 'singleDate') {
        const y = d['offenceDate-year']
        const m = String(d['offenceDate-month'] || '').padStart(2, '0')
        const day = String(d['offenceDate-day'] || '').padStart(2, '0')
        if (y && m && day) newOffenceDate = new Date(`${y}-${m}-${day}`)
      }

      await prisma.charge.update({
        where: { id: chargeId },
        data: {
          ...(newOffenceDate         && { offenceDate: newOffenceDate }),
          ...(editCharge.particulars && { particulars: editCharge.particulars }),
          ...(editCharge.victimId && editCharge.victimId !== 'none' && { victimId: parseInt(editCharge.victimId, 10) }),
          ...(editCharge.victimId === 'none' && { victimId: null })
        }
      })

      const _case = await getCaseWithCharges(caseId)
      const { charge, defendant } = resolveCharge(_case, chargeId)
      if (charge && defendant) {
        req.session.data.successBanner = {
          text: `Details of charge ${charge.chargeCode} for ${defendant.firstName} ${defendant.lastName} updated`
        }
      }
    }

    delete req.session.data.editCharge

    req.session.save(() => res.redirect(`/cases/${caseId}/details#defendants`))
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

    let victimName = ''
    if (editCharge.victimId === 'none') {
      victimName = ''
    } else if (editCharge.victimName) {
      victimName = editCharge.victimName
    } else if (charge.victim) {
      victimName = `${charge.victim.firstName} ${charge.victim.lastName}`
    } else {
      const caseVictims = _case.victims || []
      const chargeIndex = (defendant.charges || []).findIndex(c => c.id === charge.id)
      const posVictim = caseVictims.length ? caseVictims[Math.max(chargeIndex, 0) % caseVictims.length] : null
      if (posVictim) victimName = `${posVictim.firstName} ${posVictim.lastName}`
    }

    return res.render('v2/cases/charges/edit/particulars', { _case, charge, defendant, victimName })
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

    return res.redirect(`/cases/${req.params.caseId}/charges/edit/check`)
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

    return res.redirect(`/cases/${req.params.caseId}/charges/edit/check`)
  })



  // ------------------------------------------------------------------
  // VICTIM INTERSTITIAL — no victim on the charge, so it has to be added in
  // CMS Classic first. Triggered from check.html's Victim "Edit" link only
  // when there's currently no victim on the charge.
  // GET  /cases/:caseId/charges/:chargeId/edit/victim-interstitial
  router.get('/cases/:caseId/charges/:chargeId/edit/victim-interstitial', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    return res.render('v2/cases/charges/edit/victim-interstitial', { _case, charge, defendant })
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

    const victims = annotateVictims(_case.victims || [], _case.witnesses || [])

    // Simulated "import from CMS Classic" — a single victim was just added
    // there, so skip the radio list and show a playback + confirm step
    // instead. See app/views/v2/cases/charges/edit/victim-interstitial.html.
    const importedVictim = req.query.importedVictimId
      ? await resolveSelectedVictim(req.query.importedVictimId, _case, victims)
      : null

    return res.render('v2/cases/charges/edit/select-victim', {
      _case,
      charge,
      defendant,
      victims,
      importedVictim
    })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/select-victim', async (req, res) => {
    const { caseId, chargeId } = req.params
    const victimId = req.body.victimId
    const _case = await getCaseWithCharges(caseId)
    const victims = annotateVictims(_case ? (_case.victims || []) : [], _case ? (_case.witnesses || []) : [])

    let victimName = null
    let isPureVictim = false
    const victim = await resolveSelectedVictim(victimId, _case, victims)
    if (victim) {
      victimName = `${victim.firstName} ${victim.lastName}`
      isPureVictim = victim.isPure
    }

    const updatedCharge = { ...req.session.data.editCharge, victimId, victimName }
    if (victimId === 'none' || isPureVictim) delete updatedCharge.victimIsVI
    req.session.data.editCharge = updatedCharge

    if (victimId !== 'none') {
      if (!isPureVictim) {
        // returnUrl stays in session — victim-status POST will honour it
        return res.redirect(`/cases/${caseId}/charges/${chargeId}/edit/victim-status`)
      }
      // Pure victim (not also a witness) — particulars is the next step;
      // returnUrl stays in session for particulars' own POST to honour.
      return res.redirect(`/cases/${caseId}/charges/${chargeId}/edit/particulars`)
    }

    const returnUrl = req.session.data.editCharge.returnUrl
    if (returnUrl) {
      delete req.session.data.editCharge.returnUrl
      return res.redirect(returnUrl)
    }
    return res.redirect(`/cases/${caseId}/charges/${chargeId}/edit/check`)
  })


  // ------------------------------------------------------------------
  // VICTIM STATUS (V&I — only shown for non-pure victims)
  // GET  /cases/:caseId/charges/:chargeId/edit/victim-status
  // POST →  check (returnUrl) | particulars
  router.get('/cases/:caseId/charges/:chargeId/edit/victim-status', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')
    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')
    const editCharge = req.session.data.editCharge || {}
    return res.render('v2/cases/charges/edit/status', { _case, charge, defendant, editCharge })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/victim-status', (req, res) => {
    const victimIsVI = [].concat(req.body.victimIsVI || []).filter(v => v !== '_unchecked')
    req.session.data.editCharge = { ...req.session.data.editCharge, victimIsVI }
    const returnUrl = req.session.data.editCharge.returnUrl
    if (returnUrl) {
      delete req.session.data.editCharge.returnUrl
      return res.redirect(returnUrl)
    }
    // Next step in the flow — particulars' own POST honours returnUrl afterwards.
    return res.redirect(`/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/particulars`)
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
    return res.redirect(`/cases/${req.params.caseId}/charges/edit/check`)
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

    const editCharge = req.session.data.editCharge || {}
    let victimName = ''
    if (editCharge.victimId === 'none') {
      victimName = ''
    } else if (editCharge.victimName) {
      victimName = editCharge.victimName
    } else if (charge.victim) {
      victimName = `${charge.victim.firstName} ${charge.victim.lastName}`
    } else {
      const caseVictims = _case.victims || []
      const chargeIndex = (defendant.charges || []).findIndex(c => c.id === charge.id)
      const posVictim = caseVictims.length ? caseVictims[Math.max(chargeIndex, 0) % caseVictims.length] : null
      if (posVictim) victimName = `${posVictim.firstName} ${posVictim.lastName}`
    }

    return res.render('v2/cases/charges/edit/particulars', { _case, charge, defendant, victimName })
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

    return res.redirect(`/cases/${req.params.caseId}/charges/edit/check`)
  })


  // ------------------------------------------------------------------
  // NO VICTIM DEMO — reset (testing only)
  // Completing the CMS-import demo journey (Save details on check.html)
  // writes victimId/particulars to the DB for real, so without a reset the
  // "no victim" starting state only works once. Resolved by reference/
  // chargeCode rather than a hardcoded id so it survives reseeds.
  router.post('/no-victim-demo/reset', async (req, res) => {
    const demoCase = await prisma.case.findFirst({
      where: { reference: '99AA000002/1' },
      include: { defendants: { include: { charges: true } } }
    })

    const demoCharge = demoCase && demoCase.defendants[0] &&
      demoCase.defendants[0].charges.find(c => c.chargeCode === 'T01')

    if (demoCharge) {
      await prisma.charge.update({
        where: { id: demoCharge.id },
        data: {
          victimId: null,
          offenceDate: new Date('2026-01-10'),
          particulars: 'On 10 January 2026, dishonestly appropriated property belonging to another with the intention of permanently depriving them of it.'
        }
      })
    }

    delete req.session.data.editCharge

    const returnTo = req.body.returnTo || '/tasks'
    req.session.save(() => res.redirect(returnTo))
  })

}