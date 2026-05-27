// app/routes/case--charges-discontinue.js
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

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

  function resolveCharge (_case, chargeId) {
    const id        = parseInt(chargeId, 10)
    const charge    = _case.defendants.flatMap(d => d.charges).find(c => c.id === id)
    const defendant = _case.defendants.find(d => d.charges.some(c => c.id === id))
    return { charge, defendant }
  }

  function resolveFromSession (_case, req) {
    const chargeId = req.session.data.discontinueCharge?.chargeId
    return chargeId
      ? resolveCharge(_case, chargeId)
      : { charge: null, defendant: null }
  }

  // ── index ─────────────────────────────────────────────────────────

  router.get('/cases/:caseId/charges/discontinue/index', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.chargeId) {
      req.session.data.discontinueCharge = { chargeId: req.query.chargeId }
    }

    if (req.query.returnUrl) {
      req.session.data.discontinueCharge = {
        ...req.session.data.discontinueCharge,
        returnUrl: req.query.returnUrl
      }
    }

    const { charge, defendant } = resolveFromSession(_case, req)

    return res.render('v2/cases/charges/discontinue/index', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/discontinue/index', (req, res) => {
    const returnUrl = req.session.data.discontinueCharge?.returnUrl || null
    req.session.data.discontinueCharge = {
      ...req.session.data.discontinueCharge,
      reasonForDiscontinue: req.body.reasonForDiscontinue,
      returnUrl: null
    }
    res.redirect(returnUrl || `/cases/${req.params.caseId}/charges/discontinue/check`)
  })

  // ── check ─────────────────────────────────────────────────────────

  router.get('/cases/:caseId/charges/discontinue/check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveFromSession(_case, req)
    const { reasonForDiscontinue } = req.session.data.discontinueCharge || {}

    return res.render('v2/cases/charges/discontinue/check', {
      _case,
      charge,
      defendant,
      reasonForDiscontinue
    })
  })

  router.post('/cases/:caseId/charges/discontinue/check', async (req, res) => {
    const caseId   = req.params.caseId
    const chargeId = parseInt(req.session.data.discontinueCharge?.chargeId, 10)

    if (chargeId) {
      const _case = await getCaseWithCharges(caseId)
      const { charge, defendant } = resolveCharge(_case, chargeId)

      // Store discontinued state in session only (resets on Clear Data, never writes to DB)
      const discontinuedIds = req.session.data.discontinuedChargeIds || []
      if (!discontinuedIds.includes(chargeId)) {
        discontinuedIds.push(chargeId)
      }
      req.session.data.discontinuedChargeIds = discontinuedIds

      req.session.data.successBanner = {
        chargeCode:    charge.chargeCode,
        chargeId:      chargeId,
        defendantName: `${defendant.firstName} ${defendant.lastName}`
      }
    }

    req.session.save(() => res.redirect(`/cases/${caseId}/details#defendants`))
  })

  // ── victim-letter ─────────────────────────────────────────────────

  router.get('/cases/:caseId/charges/discontinue/victim-letter', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveFromSession(_case, req)
    const successBanner = req.session.data.discontinuedBanner
      ? { titleText: 'Charge discontinued' }
      : null
    delete req.session.data.discontinuedBanner

    return res.render('v2/cases/charges/discontinue/victim-letter', {
      _case,
      charge,
      defendant,
      successBanner
    })
  })

  router.post('/cases/:caseId/charges/discontinue/victim-letter', (req, res) => {
    req.session.data.discontinueCharge = {
      ...req.session.data.discontinueCharge,
      victimLetter: req.body.victimLetter
    }
    if (req.body.victimLetter === 'Yes') {
      return res.redirect(`/cases/${req.params.caseId}/charges/discontinue/cms`)
    }
    res.redirect(`/cases/${req.params.caseId}/charges/discontinue/set-reminder`)
  })

  // ── cms (mimic only — no POST) ────────────────────────────────────

  router.get('/cases/:caseId/charges/discontinue/cms', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.chargeId) {
      req.session.data.discontinueCharge = {
        ...req.session.data.discontinueCharge,
        chargeId: req.query.chargeId
      }
    }

    const { charge, defendant } = resolveFromSession(_case, req)

    return res.render('v2/cases/charges/discontinue/cms', { _case, charge, defendant })
  })

  // ── set-reminder ──────────────────────────────────────────────────

  router.get('/cases/:caseId/charges/discontinue/set-reminder', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveFromSession(_case, req)

    return res.render('v2/cases/charges/discontinue/set-reminder', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/discontinue/set-reminder', (req, res) => {
    req.session.data.discontinueCharge = {
      ...req.session.data.discontinueCharge,
      setReminder: req.body.setReminder
    }
    if (req.body.setReminder === 'Yes') {
      return res.redirect(`/cases/${req.params.caseId}/charges/discontinue/set-reminder-details`)
    }
    res.redirect(`/cases/${req.params.caseId}/details#defendants`)
  })

  // ── set-reminder-details ──────────────────────────────────────────

  router.get('/cases/:caseId/charges/discontinue/set-reminder-details', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.chargeId) {
      req.session.data.discontinueCharge = {
        ...req.session.data.discontinueCharge,
        chargeId: req.query.chargeId
      }
    }

    if (req.query.returnUrl) {
      req.session.data.discontinueCharge = {
        ...req.session.data.discontinueCharge,
        returnUrl: req.query.returnUrl
      }
    }

    const { charge, defendant } = resolveFromSession(_case, req)

    if (req.query.chargeId && charge) {
      req.session.data.setReminderTitle = `Prepare INTIMIDATED victim letter for discontinued charge ${charge.chargeCode} on case ${_case.reference}`
    }

    const reasonForDiscontinue = req.session.data.discontinueCharge?.reasonForDiscontinue || ''

    return res.render('v2/cases/charges/discontinue/set-reminder-details', {
      _case,
      charge,
      defendant,
      reasonForDiscontinue,
      data: req.session.data
    })
  })

  router.post('/cases/:caseId/charges/discontinue/set-reminder-details', (req, res) => {
    const returnUrl = req.session.data.discontinueCharge?.returnUrl || null
    req.session.data.discontinueCharge = {
      ...req.session.data.discontinueCharge,
      setReminderTitle: req.body.setReminderTitle,
      returnUrl: null
    }
    res.redirect(returnUrl || `/cases/${req.params.caseId}/charges/discontinue/set-reminder-details-check`)
  })

  // ── set-reminder-details-check ────────────────────────────────────

  router.get('/cases/:caseId/charges/discontinue/set-reminder-details-check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveFromSession(_case, req)
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const raw = req.session.data.setReminderDate || ''
    const [dd, mm, yyyy] = raw.split('/')
    const day = parseInt(dd, 10), month = parseInt(mm, 10) - 1
    const setReminderDate = (yyyy && !isNaN(day) && !isNaN(month) && month >= 0 && month <= 11)
      ? `${day} ${MONTHS[month]} ${yyyy}`
      : ''
    const setReminderTitle = req.session.data.discontinueCharge?.setReminderTitle || ''

    return res.render('v2/cases/charges/discontinue/set-reminder-details-check', {
      _case,
      charge,
      defendant,
      setReminderDate,
      setReminderTitle
    })
  })

  router.post('/cases/:caseId/charges/discontinue/set-reminder-details-check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge } = resolveFromSession(_case, req)

    const title = req.session.data.discontinueCharge?.setReminderTitle || 'Reminder'
    const now = new Date()
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const dueDate = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`

    const reminderTasks = req.session.data.reminderTasks || []
    reminderTasks.unshift({ name: title, dueDate, status: 'New', owner: 'Jimmy Bobbins', hasWarning: false })
    req.session.data.reminderTasks = reminderTasks

    const victimName = charge?.victim
      ? `${charge.victim.firstName} ${charge.victim.lastName}`
      : null
    req.session.data.successBanner = {
      text: `Victim letter reminder set${victimName ? ` for ${victimName}` : ''}`
    }

    req.session.save(() => res.redirect(`/cases/${req.params.caseId}/details#defendants`))
  })

}
