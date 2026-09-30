const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const pcdTasks = require('../data/pcd-task-list.json')
const { getTaskForReassign } = require('../helpers/pcdAppeal')

// Reassign task — see reassign-task-redesign-brief.md. pcdTasks (t1-t6) are
// still static PCD demo rows with no real Task/Case behind them at all, so
// the commit step mutates the in-memory mock record for those. Every
// PCD-appeal row (Task list's t7/t8, all of Priority charging) is now a
// real Prisma Task (see app/helpers/pcdAppeal.js) — findTaskById tells the
// two kinds of id apart by whether it parses as a number, and the commit
// step below does a real task.update() for real ids.
//
// Search (People/Teams) IS real Prisma data — User.role, Team + Team.unit,
// and open-task counts via the real Task model's assignedToUserId/
// assignedToTeamId relations all exist for real, so that part of the
// journey isn't mocked either way.

async function findTaskById(taskId) {
  if (/^\d+$/.test(taskId)) {
    const task = await getTaskForReassign(parseInt(taskId))
    if (task) return task
  }
  return pcdTasks.find(t => t.id === taskId) || null
}

module.exports = router => {

  // ── Step 1: choose recipient type ──────────────────────────────────

  router.get('/tasks/:taskId/reassign', async (req, res) => {
    const task = await findTaskById(req.params.taskId)
    if (!task) return res.status(404).render('not-found')

    const error = req.session.data.reassignError
    delete req.session.data.reassignError

    res.render('tasks/reassign/index', { task, taskId: req.params.taskId, error })
  })

  router.post('/tasks/:taskId/reassign', async (req, res) => {
    const taskId = req.params.taskId
    const task = await findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const recipientType = req.body.recipientType
    if (!recipientType) {
      req.session.data.reassignError = 'Select who you want to reassign this task to'
      return res.redirect(`/tasks/${taskId}/reassign`)
    }

    req.session.data.reassign = { taskId, recipientType }
    res.redirect(recipientType === 'individual'
      ? `/tasks/${taskId}/reassign/individual`
      : `/tasks/${taskId}/reassign/team`)
  })

  // ── Step 2a: search for an individual ──────────────────────────────

  async function renderIndividualSearch(req, res, { search, error } = {}) {
    const taskId = req.params.taskId
    const task = await findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const allUsers = await prisma.user.findMany({ select: { role: true } })
    const roleItems = _.uniq(allUsers.map(u => u.role)).sort().map(role => ({ value: role, text: role }))

    const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } })
    const unitItems = units.map(u => ({ value: String(u.id), text: u.name }))

    search = search || _.get(req, 'session.data.reassign.search', {})
    const defaultUnitId = search.unit || ''

    let results = null
    if (search.searched && !error) {
      const where = { AND: [] }
      if (search.surname) where.AND.push({ lastName: { contains: search.surname } })
      if (search.role) where.AND.push({ role: search.role })
      if (search.unit) where.AND.push({ units: { some: { unitId: parseInt(search.unit) } } })

      const users = await prisma.user.findMany({
        where: where.AND.length ? where : {},
        take: 20,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
      })

      results = users.map(user => ({ id: user.id, name: `${user.firstName} ${user.lastName}`, role: user.role }))
    }

    res.render('tasks/reassign/individual', {
      task, taskId, roleItems, unitItems, search, defaultUnitId, error, results
    })
  }

  router.get('/tasks/:taskId/reassign/individual', async (req, res) => {
    const error = req.session.data.reassignError
    delete req.session.data.reassignError

    await renderIndividualSearch(req, res, { error })
  })

  router.post('/tasks/:taskId/reassign/individual', async (req, res) => {
    const taskId = req.params.taskId
    const search = {
      surname: req.body.surname || '',
      role: req.body.role || '',
      area: req.body.area || '',
      unit: req.body.unit || '',
      searched: true
    }

    if (!search.surname && !search.role) {
      _.set(req, 'session.data.reassign.search', search)
      return renderIndividualSearch(req, res, {
        search, error: 'Enter a surname or select a role to search'
      })
    }

    _.set(req, 'session.data.reassign.search', search)
    await renderIndividualSearch(req, res, { search })
  })

  // ── Step 3a: pick a person ──────────────────────────────────────────

  router.get('/tasks/:taskId/reassign/individual/select/:personId', async (req, res) => {
    const taskId = req.params.taskId
    const personId = parseInt(req.params.personId)
    const user = await prisma.user.findUnique({ where: { id: personId } })
    if (!user) return res.status(404).render('not-found')

    _.set(req, 'session.data.reassign.selectedPerson', {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      role: user.role
    })
    _.set(req, 'session.data.reassign.selectedTeam', null)
    res.redirect(`/tasks/${taskId}/reassign/check`)
  })

  // ── Step 2b/3b: pick a team ──────────────────────────────────────────

  async function renderTeamSearch(req, res, search) {
    const taskId = req.params.taskId
    const task = await findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } })
    const unitItems = units.map(u => ({ value: String(u.id), text: u.name }))

    search = search || _.get(req, 'session.data.reassign.teamSearch', {})
    const defaultUnitId = search.unit || ''

    let results = null
    if (search.searched) {
      const where = {}
      if (search.unit) where.unitId = parseInt(search.unit)

      const teams = await prisma.team.findMany({
        where,
        include: { unit: true },
        take: 20,
        orderBy: { name: 'asc' }
      })

      results = []
      for (const team of teams) {
        const queueSize = await prisma.task.count({ where: { assignedToTeamId: team.id, completedDate: null } })
        results.push({ id: team.id, name: team.name, unitName: team.unit.name, queueSize })
      }
    }

    res.render('tasks/reassign/team', {
      task, taskId, unitItems, search, defaultUnitId, results
    })
  }

  router.get('/tasks/:taskId/reassign/team', async (req, res) => {
    await renderTeamSearch(req, res)
  })

  router.post('/tasks/:taskId/reassign/team', async (req, res) => {
    const search = {
      area: req.body.area || '',
      unit: req.body.unit || '',
      searched: true
    }

    _.set(req, 'session.data.reassign.teamSearch', search)
    await renderTeamSearch(req, res, search)
  })

  router.get('/tasks/:taskId/reassign/team/select/:teamId', async (req, res) => {
    const taskId = req.params.taskId
    const teamId = parseInt(req.params.teamId)
    const team = await prisma.team.findUnique({ where: { id: teamId }, include: { unit: true } })
    if (!team) return res.status(404).render('not-found')

    _.set(req, 'session.data.reassign.selectedTeam', { id: team.id, name: team.name, unitName: team.unit.name })
    _.set(req, 'session.data.reassign.selectedPerson', null)
    res.redirect(`/tasks/${taskId}/reassign/check`)
  })

  // ── Step 4: check answers and commit ────────────────────────────────

  router.get('/tasks/:taskId/reassign/check', async (req, res) => {
    const taskId = req.params.taskId
    const task = await findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const draft = req.session.data.reassign || {}
    if (!draft.selectedPerson && !draft.selectedTeam) {
      return res.redirect(`/tasks/${taskId}/reassign`)
    }

    res.render('tasks/reassign/check', { task, taskId, draft })
  })

  // Real PCD-appeal Task rows (numeric id) get a real task.update(); the
  // remaining static JSON rows (t1-t6, numeric-less ids) still mutate the
  // in-memory mock record — there's no real Task behind those at all.
  router.post('/tasks/:taskId/reassign/check', async (req, res) => {
    const taskId = req.params.taskId
    const task = await findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const draft = req.session.data.reassign || {}
    let newOwnerDisplayName = null
    let successBannerText = null

    if (draft.selectedPerson) {
      newOwnerDisplayName = draft.selectedPerson.name
      successBannerText = `${task.task} assigned to DCP ${draft.selectedPerson.name}.`
    } else if (draft.selectedTeam) {
      newOwnerDisplayName = draft.selectedTeam.name
      successBannerText = `${task.task} assigned to ${draft.selectedTeam.name}.`
    }

    if (/^\d+$/.test(taskId)) {
      await prisma.task.update({
        where: { id: parseInt(taskId) },
        data: {
          assignedToUserId: draft.selectedPerson ? draft.selectedPerson.id : null,
          assignedToTeamId: draft.selectedTeam ? draft.selectedTeam.id : null
        }
      })
    } else if (newOwnerDisplayName) {
      const parts = newOwnerDisplayName.split(' ')
      task.owner = ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase()
    }

    delete req.session.data.reassign

    _.set(req, 'session.data.successBanner', {
      titleText: 'Task reassigned',
      text: successBannerText
    })

    res.redirect('/tasks?v=v2')
  })

}
