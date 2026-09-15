const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const pcdTasks = require('../data/pcd-task-list.json')
const priorityChargingTasks = require('../data/priority-charging-task-list.json')

// Reassign task — see reassign-task-redesign-brief.md. Tasks here are the
// static PCD demo rows (pcd-task-list.json / priority-charging-task-list.json),
// not real Prisma Task rows, so the commit step mutates the in-memory mock
// record (same pattern as pcdAppealCases) rather than doing a real
// task.update() — see the note in the POST /confirm handler.
//
// Search (People/Teams) IS real Prisma data — User.role, Team + Team.unit,
// and open-task counts via the real Task model's assignedToUserId/
// assignedToTeamId relations all exist for real, so that part of the
// journey isn't mocked.

function findTaskById(taskId) {
  const task = pcdTasks.find(t => t.id === taskId) || priorityChargingTasks.find(t => t.id === taskId)
  return task || null
}

async function getTaskUnitId(task) {
  const caseId = task.caseId || task.overviewCaseId
  if (!caseId) return null
  const _case = await prisma.case.findUnique({ where: { id: caseId }, select: { unitId: true } })
  return _case ? _case.unitId : null
}

module.exports = router => {

  // ── Step 1: choose recipient type ──────────────────────────────────

  router.get('/tasks/:taskId/reassign', (req, res) => {
    const task = findTaskById(req.params.taskId)
    if (!task) return res.status(404).render('not-found')

    const error = req.session.data.reassignError
    delete req.session.data.reassignError

    res.render('tasks/reassign/index', { task, taskId: req.params.taskId, error })
  })

  router.post('/tasks/:taskId/reassign', (req, res) => {
    const taskId = req.params.taskId
    const task = findTaskById(taskId)
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
    const task = findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const allUsers = await prisma.user.findMany({ select: { role: true } })
    const roleItems = _.uniq(allUsers.map(u => u.role)).sort().map(role => ({ value: role, text: role }))

    const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } })
    const unitItems = units.map(u => ({ value: String(u.id), text: u.name }))

    search = search || _.get(req, 'session.data.reassign.search', {})
    const defaultUnitId = search.unit || String(await getTaskUnitId(task) || '')

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
    const task = findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } })
    const unitItems = units.map(u => ({ value: String(u.id), text: u.name }))

    search = search || _.get(req, 'session.data.reassign.teamSearch', {})
    const defaultUnitId = search.unit || String(await getTaskUnitId(task) || '')

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

  router.get('/tasks/:taskId/reassign/check', (req, res) => {
    const taskId = req.params.taskId
    const task = findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const draft = req.session.data.reassign || {}
    if (!draft.selectedPerson && !draft.selectedTeam) {
      return res.redirect(`/tasks/${taskId}/reassign`)
    }

    res.render('tasks/reassign/check', { task, taskId, draft })
  })

  // Commits by mutating the mock task record's owner field in place —
  // these are static JSON rows, not real Task rows, so there's no real
  // task.update() to run here (see file header note).
  router.post('/tasks/:taskId/reassign/check', (req, res) => {
    const taskId = req.params.taskId
    const task = findTaskById(taskId)
    if (!task) return res.status(404).render('not-found')

    const draft = req.session.data.reassign || {}
    let newOwnerInitials = null
    let newOwnerDisplayName = null

    if (draft.selectedPerson) {
      const parts = draft.selectedPerson.name.split(' ')
      newOwnerInitials = ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase()
      newOwnerDisplayName = draft.selectedPerson.name
    } else if (draft.selectedTeam) {
      newOwnerInitials = draft.selectedTeam.name
      newOwnerDisplayName = draft.selectedTeam.name
    }

    if (newOwnerInitials) task.owner = newOwnerInitials

    delete req.session.data.reassign

    _.set(req, 'session.data.successBanner', {
      titleText: 'Task reassigned',
      text: `Task reassigned to ${newOwnerDisplayName}.`
    })

    res.redirect('/tasks?v=v2')
  })

}
