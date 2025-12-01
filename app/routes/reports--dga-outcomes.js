const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {

  // View the DGA outcomes page for a specific case
  router.get('/reports/:caseId/dga-outcomes', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    
    // console.log('DGA Outcomes route hit! Case ID:', caseId)

    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        dga: {
          include: {
            failureReasons: true
          }
        }
      }
    })

    // console.log('Case data found:', caseData ? 'Yes' : 'No')
    // console.log('Has DGA:', caseData?.dga ? 'Yes' : 'No')
    // console.log('Failure reasons:', caseData?.dga?.failureReasons?.length || 0)

    if (!caseData || !caseData.dga) {
      // console.log('Redirecting to reports - no case or DGA found')
      return res.redirect('/reports')
    }

    // console.log('Rendering dga-outcomes view')
    res.render('reports/dga-outcomes', {
      case: caseData,
      successHeading: req.query.success === 'true' ? 'Outcome recorded' : null
    })
  })

  // Step 1: Select outcome
  router.get('/reports/:caseId/dga-outcomes/:failureReasonId/dga-select-outcome', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)

    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        dga: {
          include: {
            failureReasons: {
              where: { id: failureReasonId }
            }
          }
        }
      }
    })

    if (!caseData || !caseData.dga || !caseData.dga.failureReasons[0]) {
      return res.redirect('/reports')
    }

    const failureReason = caseData.dga.failureReasons[0]

    res.render('reports/dga-select-outcome', {
      case: caseData,
      failureReason: failureReason,
      selectedOutcome: req.session.data[`outcome_${failureReasonId}`]
    })
  })

  router.post('/reports/:caseId/dga-outcomes/:failureReasonId/dga-select-outcome', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)
    const outcome = req.body.outcome

    // Store in session
    _.set(req, `session.data.outcome_${failureReasonId}`, outcome)

    // If "Not disputed", skip to check answers
    if (outcome === 'Not disputed') {
      _.set(req, `session.data.details_${failureReasonId}`, null)
      _.set(req, `session.data.methods_${failureReasonId}`, null)
      return res.redirect(`/reports/${caseId}/dga-outcomes/${failureReasonId}/dga-check-answers`)
    }

    // Otherwise go to details page
    res.redirect(`/reports/${caseId}/dga-outcomes/${failureReasonId}/dga-add-details`)
  })

  // Step 2a: Add details (only if disputed)
  router.get('/reports/:caseId/dga-outcomes/:failureReasonId/dga-add-details', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)

    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        dga: {
          include: {
            failureReasons: {
              where: { id: failureReasonId }
            }
          }
        }
      }
    })

    if (!caseData || !caseData.dga || !caseData.dga.failureReasons[0]) {
      return res.redirect('/reports')
    }

    const failureReason = caseData.dga.failureReasons[0]

    res.render('reports/dga-add-details', {
      case: caseData,
      failureReason: failureReason,
      details: req.session.data[`details_${failureReasonId}`]
    })
  })

  router.post('/reports/:caseId/dga-outcomes/:failureReasonId/dga-add-details', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)
    const details = req.body.details

    _.set(req, `session.data.details_${failureReasonId}`, details)

    res.redirect(`/reports/${caseId}/dga-outcomes/${failureReasonId}/dga-select-methods`)
  })

  // Step 2b: Select methods (only if disputed)
  router.get('/reports/:caseId/dga-outcomes/:failureReasonId/dga-select-methods', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)

    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        dga: {
          include: {
            failureReasons: {
              where: { id: failureReasonId }
            }
          }
        }
      }
    })

    if (!caseData || !caseData.dga || !caseData.dga.failureReasons[0]) {
      return res.redirect('/reports')
    }

    const failureReason = caseData.dga.failureReasons[0]

    res.render('reports/dga-select-methods', {
      case: caseData,
      failureReason: failureReason,
      selectedMethods: req.session.data[`methods_${failureReasonId}`] || []
    })
  })

  router.post('/reports/:caseId/dga-outcomes/:failureReasonId/dga-select-methods', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)
    let methods = req.body.methods

    // Ensure methods is always an array
    if (!methods) {
      methods = []
    } else if (!Array.isArray(methods)) {
      methods = [methods]
    }

    // Filter out the _unchecked value added by GOV.UK Frontend
    methods = methods.filter(method => method !== '_unchecked')

    _.set(req, `session.data.methods_${failureReasonId}`, methods)

    res.redirect(`/reports/${caseId}/dga-outcomes/${failureReasonId}/dga-check-answers`)
  })

  // Step 3: Check answers
  router.get('/reports/:caseId/dga-outcomes/:failureReasonId/dga-check-answers', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)

    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        dga: {
          include: {
            failureReasons: {
              where: { id: failureReasonId }
            }
          }
        }
      }
    })

    if (!caseData || !caseData.dga || !caseData.dga.failureReasons[0]) {
      return res.redirect('/reports')
    }

    const failureReason = caseData.dga.failureReasons[0]
    const outcome = req.session.data[`outcome_${failureReasonId}`]
    const details = req.session.data[`details_${failureReasonId}`]
    const methods = req.session.data[`methods_${failureReasonId}`] || []

    res.render('reports/dga-check-answers', {
      case: caseData,
      failureReason: failureReason,
      outcome: outcome,
      details: details,
      methods: methods
    })
  })

  router.post('/reports/:caseId/dga-outcomes/:failureReasonId/dga-check-answers', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const failureReasonId = parseInt(req.params.failureReasonId)

    const outcome = req.session.data[`outcome_${failureReasonId}`]
    const details = req.session.data[`details_${failureReasonId}`]
    const methods = req.session.data[`methods_${failureReasonId}`]

    // Update the failure reason with the outcome, details, and methods
    await prisma.dGAFailureReason.update({
      where: { id: failureReasonId },
      data: { 
        outcome: outcome,
        details: details,
        methods: methods ? methods.join(', ') : null
      }
    })

    // Check if all failure reasons now have outcomes
    const caseData = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        dga: {
          include: {
            failureReasons: true
          }
        }
      }
    })

    if (caseData?.dga?.failureReasons) {
      const totalReasons = caseData.dga.failureReasons.length
      const completedReasons = caseData.dga.failureReasons.filter(fr => fr.outcome !== null).length

      let reportStatus = null
      if (completedReasons === totalReasons && totalReasons > 0) {
        reportStatus = 'Completed'
      } else if (completedReasons > 0) {
        reportStatus = 'In progress'
      }

      // Update the case reportStatus
      await prisma.case.update({
        where: { id: caseId },
        data: { reportStatus }
      })
    }

    // Clear session data for this failure reason
    _.set(req, `session.data.outcome_${failureReasonId}`, null)
    _.set(req, `session.data.details_${failureReasonId}`, null)
    _.set(req, `session.data.methods_${failureReasonId}`, null)

    res.redirect(`/reports/${caseId}/dga-outcomes?success=true`)
  })

}