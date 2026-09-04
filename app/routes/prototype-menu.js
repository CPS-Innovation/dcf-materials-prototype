const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const sessionDataDefaults = require('../data/session-data-defaults')

// Replaces the old /account/sign-in detour for the front page's "View the
// current prototype" link — that form never actually checked anything (any
// email, or none, got you through to /tasks), it just happened to be where
// req.session.data.user got set, which downstream features (task
// ownership, activity log authorship) depend on. This does the same
// fallback-user assignment silently, then lands straight on a page of
// direct links into each demo journey instead of the generic task list.
const FALLBACK_EMAIL = 'reporting.admin@cps.gov.uk'

module.exports = router => {
  router.get('/prototype-menu', async (req, res) => {
    req.session.data = Object.assign({}, sessionDataDefaults)

    // The old /tasks?v=v2 link this page replaces was the only place that
    // ever set this — without it, every page using the generic v1/v2
    // template resolution in routes.js defaults to the old 'v1' designs.
    // Safe to force here: routes.js's render override now falls back to
    // the other version's folder before giving up, so nothing 500s even
    // on the handful of pages that were only ever built for one version.
    req.session.version = 'v2'
    req.version = 'v2'

    try {
      req.session.data.user = await prisma.user.findUnique({
        where: { email: FALLBACK_EMAIL },
        include: { units: { include: { unit: true } } }
      })
    } catch (e) {
      // DB not available (e.g. review app) — prototype-only fallback, same
      // last resort /account/sign-in's POST handler uses.
      req.session.data.user = {
        id: 0,
        name: 'Prototype user',
        email: 'prototype@example.com',
        units: []
      }
    }

    res.render('prototype-menu/index')
  })
}
