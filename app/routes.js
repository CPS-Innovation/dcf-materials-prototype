// app/routes.js

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()

const fs = require('fs')
const path = require('path')
const exec = require('child_process').exec

const checkSignedIn = require('./middleware/checkSignedIn')

const flash = require('connect-flash')
router.use(flash())

/**
 * Globals for templates
 */
router.all('*', (req, res, next) => {
  res.locals.referrer = req.query.referrer
  res.locals.path = req.path
  res.locals.protocol = req.protocol
  res.locals.hostname = req.hostname
  res.locals.query = req.query
  res.locals.flash = req.flash('success')[0]
  next()
})

/**
 * Version middleware (MUST be before routes that render templates)
 */
router.use((req, res, next) => {
  const version = req.query.v || req.session.version || 'v1'
  req.version = version
  res.locals.version = version
  next()
})

/**
 * Render override:
 * - routes can keep doing res.render('tasks/index')
 * - we try v1/ or v2/ first based on req.version
 * - fall back to the original view if the versioned one doesn't exist
 *
 * IMPORTANT:
 * - The homepage chooser at app/views/index.html should NOT be versioned.
 */
router.use((req, res, next) => {
  const originalRender = res.render.bind(res)

  res.render = (view, locals = {}, cb) => {
    // ✅ Don't version these global templates
    if (view === 'index') {
      return originalRender(view, locals, cb)
    }

    // If already explicit (versioned or shared), don't interfere
    if (
      typeof view === 'string' &&
      (view.startsWith('v1/') || view.startsWith('v2/') || view.startsWith('_shared/'))
    ) {
      return originalRender(view, locals, cb)
    }

    const versionedView = `${req.version}/${view}`

    return originalRender(versionedView, locals, (err, html) => {
      // If versioned template missing, fall back to original
      if (err && /template not found/i.test(err.message)) {
        return originalRender(view, locals, cb)
      }

      // Normal render behaviour
      if (cb) return cb(err, html)
      if (err) return res.status(500).send(err.message)
      return res.send(html)
    })
  }

  next()
})

/**
 * Version switcher (stores v1/v2 in session)
 * Redirects into the chosen version start page.
 */
///// version switcher updated to redirect to sign-in page instead of version-specific homepage, as the latter may not exist in both versions
// router.get('/set-version', (req, res) => {
//   req.session.version = req.query.v || 'v1'
//   return res.redirect(req.session.version === 'v2' ? '/v2' : '/v1')
// })

router.get('/set-version', (req, res) => {
  req.session.version = req.query.v || 'v1'
  return res.redirect('/account/sign-in')
})

/**
 * ✅ Explicit homepage so app/views/index.html definitely renders
 * (Keep this BEFORE checkSignedIn)
 */
router.get('/', (req, res) => {
  return res.render('index')
})

/**
 * Clear data (kept)
 */
router.get('/clear-data', function (req, res) {
  delete req.session.data
  const redirectUrl = req.query.returnUrl || '/'

  // Determine the absolute path to the database folder
  const dataFolder = path.join(__dirname, '../data')

  try {
    // Ensure the folder exists
    if (!fs.existsSync(dataFolder)) {
      fs.mkdirSync(dataFolder, { recursive: true })
      console.log(`Created folder: ${dataFolder}`)
    }
  } catch (err) {
    console.error('Error creating data folder:', err)
    return res.status(500).json({ error: 'Failed to prepare database folder' })
  }

  // Run Prisma push and seed
  exec('npx prisma db push --force-reset', (resetError, resetStdout, resetStderr) => {
    if (resetError) {
      console.error('Error resetting DB:', resetError)
      console.error(resetStderr)
      return res.status(500).json({ error: 'Failed to reset database' })
    }
    console.log('DB reset output:', resetStdout)

    exec('npx prisma db seed', (seedError, seedStdout, seedStderr) => {
      if (seedError) {
        console.error('Error seeding DB:', seedError)
        console.error(seedStderr)
        return res.status(500).json({ error: 'Failed to seed database' })
      }
      console.log('DB seeded successfully:', seedStdout)
      return res.redirect(redirectUrl)
    })
  })
})

/**
 * Your existing route mounts
 */
require('./routes/v1')(router)
require('./routes/v2')(router)

require('./routes/static')(router)
require('./routes/account')(router)

/**
 * From here down requires sign-in
 */
router.use(checkSignedIn)

require('./routes/overview')(router)
require('./routes/activity')(router)

require('./routes/reports')(router)
require('./routes/reports--dga-outcomes')(router)
require('./routes/tasks')(router)
require('./routes/directions')(router)
require('./routes/cases')(router)
require('./routes/cases--add-prosecutor')(router)
require('./routes/cases--add-paralegal-officer')(router)
require('./routes/case--overview')(router)
require('./routes/case--details')(router)
require('./routes/case--dga')(router)
require('./routes/case--dga--new')(router)
require('./routes/case--notes')(router)
require('./routes/case--activity')(router)
require('./routes/case--tasks')(router)
require('./routes/case--directions')(router)
require('./routes/case--task')(router)
require('./routes/case--task--notes')(router)
// Global tasks list (not case-specific)
require('./routes/case--tasks-list--old')(router)
require('./routes/case--direction')(router)
require('./routes/case--direction--complete')(router)
require('./routes/case--documents')(router)
require('./routes/case--details')(router)
// ✅ Put this BEFORE case--disclosure / case--disclosure-bulk
require('./routes/case--disclosure-assess-as-unused')(router)
require('./routes/case--disclosure')(router)
require('./routes/case--disclosure-bulk')(router)
/// indictmant-v2 must be registered in your main routes.js before case--indictment.js — otherwise Express will match the v1 handler first and the v2 override never fires.
require('./routes/case--indictment-v2')(router)
require('./routes/case--indictment')(router)
require('./routes/case--material')(router)
require('./routes/case--material-actions')(router)
require('./routes/case--witnesses')(router)
require('./routes/case--witness')(router)
require('./routes/case--defendants')(router)
require('./routes/case--witness--mark-as-attending-court')(router)
require('./routes/case--witness--mark-as-not-attending-court')(router)
require('./routes/case--witness-statement--mark-as-section9')(router)
require('./routes/case--witness-statement--unmark-as-section9')(router)

require('./routes/prosecutors')(router)
require('./routes/prosecutors--add-specialist-area')(router)
require('./routes/paralegal-officers')(router)

module.exports = router