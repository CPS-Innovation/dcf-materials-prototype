const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const checkSignedIn = require('../middleware/checkSignedIn')
const sessionDataDefaults = require('../data/session-data-defaults')

module.exports = router => {

  router.get('/account', checkSignedIn, (req, res) => {
    res.render("account/index", { 
      user: req.session.data.user
    })
  })

router.post('/account/sign-in', async (req, res) => {
  const email = _.get(req.body, 'signIn.emailAddress')

  // Reset session defaults each sign-in
  req.session.data = Object.assign({}, sessionDataDefaults)

  // Use a known seeded user as a safe fallback so /tasks "My tasks" filtering works
  const FALLBACK_EMAIL = 'reporting.admin@cps.gov.uk'

  try {
    if (email) {
      // Try to sign in as the email entered
      req.session.data.user = await prisma.user.findUnique({
        where: { email },
        include: { units: { include: { unit: true } } }
      })
    } else {
      // No email entered: just take the first available user
      req.session.data.user = await prisma.user.findFirst({
        include: { units: { include: { unit: true } } }
      })
    }

    // If an email was entered but no user exists, fall back to a seeded user
    if (!req.session.data.user) {
      req.session.data.user = await prisma.user.findUnique({
        where: { email: FALLBACK_EMAIL },
        include: { units: { include: { unit: true } } }
      })
    }
  } catch (e) {
    // DB not available (e.g. review app): fall back to a seeded user if possible
    try {
      req.session.data.user = await prisma.user.findUnique({
        where: { email: FALLBACK_EMAIL },
        include: { units: { include: { unit: true } } }
      })
    } catch (e2) {
      // Absolute last resort: prototype-only user (note: /tasks may show empty if it filters by user id)
      req.session.data.user = {
        id: 0,
        name: 'Prototype user',
        email: email || 'prototype@example.com',
        units: []
      }
    }
  }

  return res.redirect('/tasks')
})



  router.get('/account/sign-out', (req, res) => {
    req.session.data.user = null
    res.redirect('/signed-out')
  })

  router.get('/signed-out', (req, res) => {
    res.render('account/signed-out')
  })

  router.get('/account/sign-in', (req, res) => {
    res.render('account/sign-in')
  })

}