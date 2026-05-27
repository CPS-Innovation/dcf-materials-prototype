const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const chargeLibrary = require('../data/charge-library.json')

module.exports = router => {

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

  function resolveDefendant (_case, defendantId) {
    return _case.defendants.find(d => d.id === parseInt(defendantId, 10)) || null
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

  function buildDatePrefill (sessionData, dateType) {
    if (dateType === 'singleDate' && sessionData['offenceDate-day']) {
      const d = sessionData['offenceDate-day']
      const m = String(sessionData['offenceDate-month']).padStart(2, '0')
      const y = sessionData['offenceDate-year']
      return `${d}/${m}/${y}`
    }
    if (dateType === 'multipleDates' && sessionData['offenceDateFrom-day']) {
      const d = sessionData['offenceDateFrom-day']
      const m = String(sessionData['offenceDateFrom-month']).padStart(2, '0')
      const y = sessionData['offenceDateFrom-year']
      return `${d}/${m}/${y}`
    }
    return ''
  }

  function filterChargeLibrary (query) {
    const q = (query || '').toLowerCase().trim()
    if (!q) return []
    return chargeLibrary.filter(c =>
      c.chargeCode.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      (c.keywords || []).some(k => k.toLowerCase().includes(q)) ||
      (c.statute.act + ' ' + c.statute.section).toLowerCase().includes(q)
    )
  }


  // ------------------------------------------------------------------
  // SEARCH CHARGES
  // GET  /cases/:caseId/charges/add/search-charges
  // POST /cases/:caseId/charges/add/search-charges  →  date-type
  router.get('/cases/:caseId/charges/add/search-charges', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.defendantId) {
      req.session.data.newCharge = { defendantId: req.query.defendantId }
    }

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null
    const precedentResults = filterChargeLibrary(req.query.precedentSearchKeywords)

    return res.render('v2/cases/charges/add/search-charges', {
      _case,
      defendant,
      newCharge,
      precedentSearchKeywords: req.query.precedentSearchKeywords || '',
      precedentResults
    })
  })

  router.post('/cases/:caseId/charges/add/search-charges', (req, res) => {
    const selected = chargeLibrary.find(c => c.chargeCode === req.body.selectedChargeCode)
    if (selected) {
      req.session.data.newCharge = {
        ...req.session.data.newCharge,
        chargeCode: selected.chargeCode,
        chargeDescription: selected.label,
        chargeStatute: `${selected.statute.act}, ${selected.statute.section}`
      }
    }
    return res.redirect(`/cases/${req.params.caseId}/charges/add/date-type`)
  })


  // ------------------------------------------------------------------
  // DATE TYPE
  // GET  /cases/:caseId/charges/add/date-type
  // POST /cases/:caseId/charges/add/date-type  →  single-date | multiple-date
  router.get('/cases/:caseId/charges/add/date-type', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.returnUrl) {
      req.session.data.newCharge = { ...req.session.data.newCharge, returnUrl: req.query.returnUrl }
    }

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/date-type', { _case, defendant, newCharge })
  })

  router.post('/cases/:caseId/charges/add/date-type', (req, res) => {
    req.session.data.newCharge = { ...req.session.data.newCharge, dateType: req.body.dateType }
    const base = `/cases/${req.params.caseId}/charges/add`
    if (req.body.dateType === 'singleDate') return res.redirect(`${base}/single-date`)
    return res.redirect(`${base}/multiple-date`)
  })


  // ------------------------------------------------------------------
  // SINGLE DATE
  // GET  /cases/:caseId/charges/add/single-date
  // POST /cases/:caseId/charges/add/single-date  →  address
  router.get('/cases/:caseId/charges/add/single-date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/single-date', { _case, defendant, newCharge })
  })

  router.post('/cases/:caseId/charges/add/single-date', (req, res) => {
    const returnUrl = req.session.data.newCharge?.returnUrl
    if (returnUrl) {
      delete req.session.data.newCharge.returnUrl
      return res.redirect(returnUrl)
    }
    return res.redirect(`/cases/${req.params.caseId}/charges/add/do-you-want-to-add-address`)
  })


  // ------------------------------------------------------------------
  // MULTIPLE DATE
  // GET  /cases/:caseId/charges/add/multiple-date
  // POST /cases/:caseId/charges/add/multiple-date  →  address
  router.get('/cases/:caseId/charges/add/multiple-date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/multiple-date', { _case, defendant, newCharge })
  })

  router.post('/cases/:caseId/charges/add/multiple-date', (req, res) => {
    const returnUrl = req.session.data.newCharge?.returnUrl
    if (returnUrl) {
      delete req.session.data.newCharge.returnUrl
      return res.redirect(returnUrl)
    }
    return res.redirect(`/cases/${req.params.caseId}/charges/add/do-you-want-to-add-address`)
  })


  // ------------------------------------------------------------------
  // DO YOU WANT TO ADD ADDRESS?
  // GET  /cases/:caseId/charges/add/do-you-want-to-add-address
  // POST /cases/:caseId/charges/add/do-you-want-to-add-address  →  address | select-victim
  router.get('/cases/:caseId/charges/add/do-you-want-to-add-address', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/do-you-want-to-add-address', { _case, defendant, newCharge })
  })

  router.post('/cases/:caseId/charges/add/do-you-want-to-add-address', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/add`
    if (req.body.addOffenceAddress === 'Yes') {
      return res.redirect(`${base}/address`)
    }
    req.session.data.newCharge = { ...req.session.data.newCharge, offenceAddress: null }
    return res.redirect(`${base}/select-victim`)
  })


  // ------------------------------------------------------------------
  // ADDRESS (optional)
  // GET  /cases/:caseId/charges/add/address
  // POST /cases/:caseId/charges/add/address  →  select-victim
  router.get('/cases/:caseId/charges/add/address', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.returnUrl) {
      req.session.data.newCharge = { ...req.session.data.newCharge, returnUrl: req.query.returnUrl }
    }

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/address', { _case, defendant, newCharge })
  })

  router.post('/cases/:caseId/charges/add/address', (req, res) => {
    const addr = req.body.offenceAddress || {}
    req.session.data.newCharge = {
      ...req.session.data.newCharge,
      offenceAddress: {
        line1:    addr.line1    || '',
        line2:    addr.line2    || '',
        town:     addr.town     || '',
        postcode: addr.postcode || ''
      }
    }

    const returnUrl = req.session.data.newCharge.returnUrl
    if (returnUrl) {
      delete req.session.data.newCharge.returnUrl
      return res.redirect(returnUrl)
    }
    return res.redirect(`/cases/${req.params.caseId}/charges/add/select-victim`)
  })


  // ------------------------------------------------------------------
  // SELECT VICTIM
  // GET  /cases/:caseId/charges/add/select-victim
  // POST /cases/:caseId/charges/add/select-victim  →  victim-status | particulars
  router.get('/cases/:caseId/charges/add/select-victim', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.returnUrl) {
      req.session.data.newCharge = { ...req.session.data.newCharge, returnUrl: req.query.returnUrl }
    }

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null
    const victims = annotateVictims(_case.victims || [], _case.witnesses || [])

    return res.render('v2/cases/charges/add/select-victim', { _case, defendant, newCharge, victims })
  })

  router.post('/cases/:caseId/charges/add/select-victim', async (req, res) => {
    const caseId = req.params.caseId
    const victimId = req.body.victimId
    const _case = await getCaseWithCharges(caseId)
    const victims = annotateVictims(_case ? (_case.victims || []) : [], _case ? (_case.witnesses || []) : [])

    let victimName = ''
    let isPureVictim = false

    if (victimId !== 'none') {
      const victim = victims.find(v => String(v.id) === String(victimId))
      if (victim) {
        victimName = `${victim.firstName} ${victim.lastName}`
        isPureVictim = victim.isPure
      }
    }

    const updatedCharge = { ...req.session.data.newCharge, victimId, victimName }

    // Clear stale V&I status whenever the victim changes to pure or none
    if (victimId === 'none' || isPureVictim) {
      delete updatedCharge.victimIsVI
    }

    req.session.data.newCharge = updatedCharge

    if (victimId !== 'none' && !isPureVictim) {
      // returnUrl stays in session — victim-status POST will honour it
      return res.redirect(`/cases/${caseId}/charges/add/victim-status`)
    }

    const returnUrl = req.session.data.newCharge.returnUrl
    if (returnUrl) {
      delete req.session.data.newCharge.returnUrl
      return res.redirect(returnUrl)
    }
    return res.redirect(`/cases/${caseId}/charges/add/do-you-want-to-add-particulars`)
  })


  // ------------------------------------------------------------------
  // VICTIM STATUS (V&I question — only shown for pure victims)
  // GET  /cases/:caseId/charges/add/victim-status
  // POST /cases/:caseId/charges/add/victim-status  →  particulars
  router.get('/cases/:caseId/charges/add/victim-status', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/status', { _case, defendant, newCharge })
  })

  router.post('/cases/:caseId/charges/add/victim-status', (req, res) => {
    const victimIsVI = [].concat(req.body.victimIsVI || []).filter(v => v !== '_unchecked')
    req.session.data.newCharge = { ...req.session.data.newCharge, victimIsVI }
    const returnUrl = req.session.data.newCharge.returnUrl
    if (returnUrl) {
      delete req.session.data.newCharge.returnUrl
      return res.redirect(returnUrl)
    }
    return res.redirect(`/cases/${req.params.caseId}/charges/add/do-you-want-to-add-particulars`)
  })


  // ------------------------------------------------------------------
  // DO YOU WANT TO ADD PARTICULARS?
  // GET  /cases/:caseId/charges/add/do-you-want-to-add-particulars
  // POST /cases/:caseId/charges/add/do-you-want-to-add-particulars  →  particulars | check
  router.get('/cases/:caseId/charges/add/do-you-want-to-add-particulars', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/do-you-want-to-add-particulars', { _case, defendant, newCharge })
  })

  router.post('/cases/:caseId/charges/add/do-you-want-to-add-particulars', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/add`
    if (req.body.addOffenceParticulars === 'Yes') {
      return res.redirect(`${base}/particulars`)
    }
    req.session.data.newCharge = { ...req.session.data.newCharge, particulars: null }
    return res.redirect(`${base}/check`)
  })


  // ------------------------------------------------------------------
  // PARTICULARS (optional)
  // GET  /cases/:caseId/charges/add/particulars
  // POST /cases/:caseId/charges/add/particulars  →  check
  router.get('/cases/:caseId/charges/add/particulars', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.returnUrl) {
      req.session.data.newCharge = { ...req.session.data.newCharge, returnUrl: req.query.returnUrl }
    }

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null
    const chargeEntry = chargeLibrary.find(c => c.chargeCode === newCharge.chargeCode)
    const particularsStarter = chargeEntry?.templates?.particularsStarter || ''

    const datePrefill = buildDatePrefill(req.session.data, newCharge.dateType)

    return res.render('v2/cases/charges/add/particulars', {
      _case, defendant, newCharge, particularsStarter, datePrefill
    })
  })

  router.post('/cases/:caseId/charges/add/particulars', (req, res) => {
    req.session.data.newCharge = { ...req.session.data.newCharge, particulars: req.body.particulars }

    const returnUrl = req.session.data.newCharge.returnUrl
    if (returnUrl) {
      delete req.session.data.newCharge.returnUrl
      return res.redirect(returnUrl)
    }
    return res.redirect(`/cases/${req.params.caseId}/charges/add/check`)
  })


  // ------------------------------------------------------------------
  // CHECK
  // GET  /cases/:caseId/charges/add/check
  // POST /cases/:caseId/charges/add/check  →  create charge → details#defendants
  router.get('/cases/:caseId/charges/add/check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const newCharge = req.session.data.newCharge || {}
    const defendant = newCharge.defendantId ? resolveDefendant(_case, newCharge.defendantId) : null

    return res.render('v2/cases/charges/add/check', {
      _case,
      defendant,
      newCharge,
      checkUrl: `/cases/${req.params.caseId}/charges/add/check`
    })
  })

  router.post('/cases/:caseId/charges/add/check', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const newCharge = req.session.data.newCharge || {}
    const d = req.session.data

    let offenceDate = new Date()
    if (d['dateType'] === 'singleDate' && d['offenceDate-year'] && d['offenceDate-month'] && d['offenceDate-day']) {
      const y   = d['offenceDate-year']
      const m   = String(d['offenceDate-month']).padStart(2, '0')
      const day = String(d['offenceDate-day']).padStart(2, '0')
      offenceDate = new Date(`${y}-${m}-${day}`)
    } else if (d['dateType'] === 'multipleDates' && d['offenceDateFrom-year']) {
      const y   = d['offenceDateFrom-year']
      const m   = String(d['offenceDateFrom-month']).padStart(2, '0')
      const day = String(d['offenceDateFrom-day']).padStart(2, '0')
      offenceDate = new Date(`${y}-${m}-${day}`)
    }

    const chargeEntry = chargeLibrary.find(c => c.chargeCode === newCharge.chargeCode)
    const particulars = newCharge.particulars || chargeEntry?.templates?.particularsStarter || ''

    const charge = await prisma.charge.create({
      data: {
        chargeCode:  newCharge.chargeCode  || '',
        description: newCharge.chargeDescription || '',
        status:      'Pending add',
        offenceDate,
        particulars,
        defendantId: parseInt(newCharge.defendantId, 10),
        ...(newCharge.victimId && newCharge.victimId !== 'none' && !String(newCharge.victimId).startsWith('w-') && {
          victimId: parseInt(newCharge.victimId, 10)
        })
      }
    })

    const defendant = resolveDefendant(
      await getCaseWithCharges(caseId),
      newCharge.defendantId
    )

    req.session.data.successBanner = {
      text: `Charge ${charge.chargeCode} added for ${defendant ? defendant.firstName + ' ' + defendant.lastName : ''}`
    }

    delete req.session.data.newCharge

    req.session.save(() => res.redirect(`/cases/${caseId}/details#defendants`))
  })
}
