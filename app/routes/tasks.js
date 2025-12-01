const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const Pagination = require('../helpers/pagination')
const { groupTasks } = require('../helpers/taskGrouping')
const { addTimeLimitDates } = require('../helpers/timeLimit')
const taskNames = require('../data/task-names')

function resetFilters(req) {
  _.set(req, 'session.data.taskListFilters.owner', null)
  _.set(req, 'session.data.taskListFilters.units', null)
  _.set(req, 'session.data.taskListFilters.taskNames', null)
  _.set(req, 'session.data.taskListFilters.severities', null)
  _.set(req, 'session.data.taskListFilters.urgent', null)
  _.set(req, 'session.data.taskListFilters.reminder', null)
  _.set(req, 'session.data.taskListFilters.timeLimitType', null)
}

module.exports = router => {

  router.get('/tasks/shortcut/critically-overdue', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[severities][]=Critically overdue`)
  })

  router.get('/tasks/shortcut/overdue', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[severities][]=Overdue`)
  })

  router.get('/tasks/shortcut/due-soon', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[severities][]=Due soon`)
  })

  router.get('/tasks/shortcut/not-due-yet', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[severities][]=Not due yet`)
  })

  router.get('/tasks/shortcut/urgent', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[urgent][]=Urgent`)
  })

  router.get('/tasks/shortcut/ctl', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[timeLimitType][]=Custody time limit`)
  })

  router.get('/tasks/shortcut/stl', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[timeLimitType][]=Statutory time limit`)
  })

  router.get('/tasks/shortcut/pace', (req, res) => {
    const currentUser = req.session.data.user
    resetFilters(req)
    res.redirect(`/tasks?taskListFilters[owner][]=user-${currentUser.id}&taskListFilters[timeLimitType][]=PACE`)
  })

  router.get("/tasks", async (req, res) => {
    const currentUser = req.session.data.user

    // Get user's unit IDs for filtering
    const userUnitIds = currentUser?.units?.map(uu => uu.unitId) || []

    // Track if this is the first visit (filters object doesn't exist)
    const isFirstVisit = !req.session.data.taskListFilters

    // Ensure taskListFilters object exists
    if (!req.session.data.taskListFilters) {
      req.session.data.taskListFilters = {}
    }

    // Only set default owner to current user on first visit
    // If filters exist but owner is missing, user cleared it intentionally
    if (isFirstVisit) {
      _.set(req.session.data.taskListFilters, 'owner', [`user-${currentUser.id}`])
    }

    let selectedOwnerFilters = _.get(req.session.data.taskListFilters, 'owner', [])
    let selectedUnitFilters = _.get(req.session.data.taskListFilters, 'units', [])
    let selectedTaskNameFilters = _.get(req.session.data.taskListFilters, 'taskNames', [])
    let selectedSeverityFilters = _.get(req.session.data.taskListFilters, 'severities', [])
    let selectedUrgentFilters = _.get(req.session.data.taskListFilters, 'urgent', [])
    let selectedReminderFilters = _.get(req.session.data.taskListFilters, 'reminder', [])
    let selectedTimeLimitTypeFilters = _.get(req.session.data.taskListFilters, 'timeLimitType', [])

    let selectedFilters = { categories: [] }

    let selectedOwnerItems = []
    let selectedUnitItems = []
    let selectedTaskNameItems = []
    let selectedSeverityItems = []
    let selectedUrgentItems = []
    let selectedReminderItems = []
    let selectedTimeLimitTypeItems = []

    // Owner filter display
    if (selectedOwnerFilters?.length) {
      // Parse filters into userIds and teamIds
      const userIds = []
      const teamIds = []

      selectedOwnerFilters.forEach(filter => {
        if (filter.startsWith('user-')) {
          userIds.push(Number(filter.replace('user-', '')))
        } else if (filter.startsWith('team-')) {
          teamIds.push(Number(filter.replace('team-', '')))
        }
      })

      // Fetch users and teams
      let fetchedUsers = []
      let fetchedTeams = []

      if (userIds.length) {
        fetchedUsers = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true }
        })
      }

      if (teamIds.length) {
        fetchedTeams = await prisma.team.findMany({
          where: { id: { in: teamIds } },
          include: { unit: true }
        })
      }

      // Build display items
      selectedOwnerItems = selectedOwnerFilters.map(function(filter) {
        if (filter.startsWith('user-')) {
          const userId = Number(filter.replace('user-', ''))
          const user = fetchedUsers.find(u => u.id === userId)
          let displayText = user ? `${user.firstName} ${user.lastName}` : filter

          if (currentUser && user && user.id === currentUser.id) {
            displayText += " (you)"
          }

          return { text: displayText, href: '/tasks/remove-owner/' + filter }
        } else if (filter.startsWith('team-')) {
          const teamId = Number(filter.replace('team-', ''))
          const team = fetchedTeams.find(t => t.id === teamId)
          const displayText = team ? `${team.name} (${team.unit.name})` : filter

          return { text: displayText, href: '/tasks/remove-owner/' + filter }
        }
      })

      selectedFilters.categories.push({ heading: { text: 'Owner' }, items: selectedOwnerItems })
    }

    // Unit filter display
    if (selectedUnitFilters?.length) {
      const unitIds = selectedUnitFilters.map(Number)

      let fetchedUnits = await prisma.unit.findMany({
        where: { id: { in: unitIds } }
      })

      selectedUnitItems = selectedUnitFilters.map(function(selectedUnit) {
        let unit = fetchedUnits.find(function(u) { return u.id === Number(selectedUnit) })
        return { text: unit ? unit.name : selectedUnit, href: '/tasks/remove-unit/' + selectedUnit }
      })

      selectedFilters.categories.push({ heading: { text: 'Unit' }, items: selectedUnitItems })
    }

    // Task name filter display
    if (selectedTaskNameFilters?.length) {
      selectedTaskNameItems = selectedTaskNameFilters.map(function(taskName) {
        return { text: taskName, href: '/tasks/remove-task-name/' + encodeURIComponent(taskName) }
      })

      selectedFilters.categories.push({
        heading: { text: 'Task' },
        items: selectedTaskNameItems
      })
    }

    // Severity filter display
    if (selectedSeverityFilters?.length) {
      selectedSeverityItems = selectedSeverityFilters.map(function(severity) {
        return { text: severity, href: '/tasks/remove-severity/' + encodeURIComponent(severity) }
      })

      selectedFilters.categories.push({
        heading: { text: 'Due' },
        items: selectedSeverityItems
      })
    }

    // Urgent filter display
    if (selectedUrgentFilters?.length) {
      selectedUrgentItems = selectedUrgentFilters.map(function(urgent) {
        return { text: urgent, href: '/tasks/remove-urgent/' + encodeURIComponent(urgent) }
      })

      selectedFilters.categories.push({
        heading: { text: 'Urgent' },
        items: selectedUrgentItems
      })
    }

    // Reminder filter display
    if (selectedReminderFilters?.length) {
      selectedReminderItems = selectedReminderFilters.map(function(reminder) {
        return { text: reminder, href: '/tasks/remove-reminder/' + encodeURIComponent(reminder) }
      })

      selectedFilters.categories.push({
        heading: { text: 'Reminder' },
        items: selectedReminderItems
      })
    }

    // Time limit type filter display
    if (selectedTimeLimitTypeFilters?.length) {
      selectedTimeLimitTypeItems = selectedTimeLimitTypeFilters.map(function(timeLimitType) {
        return { text: timeLimitType, href: '/tasks/remove-time-limit-type/' + encodeURIComponent(timeLimitType) }
      })

      selectedFilters.categories.push({
        heading: { text: 'Time limit' },
        items: selectedTimeLimitTypeItems
      })
    }

    // Build Prisma where clause
    let where = { AND: [] }

    // MANDATORY: Exclude completed tasks
    where.AND.push({ completedDate: null })

    // MANDATORY: Restrict to tasks in user's units only
    if (userUnitIds.length) {
      where.AND.push({ case: { unitId: { in: userUnitIds } } })
    }

    // Owner filter (users and teams)
    if (selectedOwnerFilters?.length) {
      const userIds = []
      const teamIds = []

      selectedOwnerFilters.forEach(filter => {
        if (filter.startsWith('user-')) {
          userIds.push(Number(filter.replace('user-', '')))
        } else if (filter.startsWith('team-')) {
          teamIds.push(Number(filter.replace('team-', '')))
        }
      })

      const ownerConditions = []
      if (userIds.length) {
        ownerConditions.push({ assignedToUserId: { in: userIds } })
      }
      if (teamIds.length) {
        ownerConditions.push({ assignedToTeamId: { in: teamIds } })
      }

      if (ownerConditions.length) {
        where.AND.push({ OR: ownerConditions })
      }
    }

    if (selectedUnitFilters?.length) {
      const unitIds = selectedUnitFilters.map(Number)
      where.AND.push({ case: { unitId: { in: unitIds } } })
    }

    if (selectedTaskNameFilters?.length) {
      where.AND.push({ name: { in: selectedTaskNameFilters } })
    }

    // Urgent filter
    if (selectedUrgentFilters?.length) {
      const urgentConditions = []
      if (selectedUrgentFilters.includes('Urgent')) {
        urgentConditions.push({ isUrgent: true })
      }
      if (selectedUrgentFilters.includes('Not urgent')) {
        urgentConditions.push({ isUrgent: false })
      }
      if (urgentConditions.length) {
        where.AND.push({ OR: urgentConditions })
      }
    }

    // Reminder filter
    if (selectedReminderFilters?.length) {
      const reminderConditions = []
      if (selectedReminderFilters.includes('Is reminder')) {
        reminderConditions.push({ reminderType: { not: null } })
      }
      if (selectedReminderFilters.includes('Is not reminder')) {
        reminderConditions.push({ reminderType: null })
      }
      if (reminderConditions.length) {
        where.AND.push({ OR: reminderConditions })
      }
    }

    if (where.AND.length === 0) {
      where = {}
    }

    let tasks = await prisma.task.findMany({
      where: where,
      orderBy: [
        { reminderDate: 'asc' },
        { dueDate: 'asc' }
      ],
      include: {
        case: {
          include: {
            defendants: {
              include: {
                charges: true,
                defenceLawyer: true
              }
            },
            unit: true,
            hearings: {
              orderBy: {
                startDate: 'asc'
              },
              take: 1
            }
          }
        },
        assignedToUser: true,
        assignedToTeam: {
          include: {
            unit: true
          }
        },
        notes: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      }
    })

    // Add time limit dates to each task's case
    tasks = tasks.map(task => {
      addTimeLimitDates(task.case)
      return task
    })

    // Filter by time limit type (must be done after calculating time limit dates)
    if (selectedTimeLimitTypeFilters?.length) {
      tasks = tasks.filter(task => {
        return selectedTimeLimitTypeFilters.some(filter => {
          if (filter === 'Custody time limit' && task.case.custodyTimeLimit) return true
          if (filter === 'Statutory time limit' && task.case.statutoryTimeLimit) return true
          if (filter === 'PACE' && task.case.paceTimeLimit) return true
          return false
        })
      })
    }

    let keywords = _.get(req.session.data.taskSearch, 'keywords')

    if(keywords) {
      keywords = keywords.toLowerCase()
      tasks = tasks.filter(task => {
        let taskName = task.name.toLowerCase()
        let caseReference = task.case.reference.toLowerCase()
        let defendantName = (task.case.defendants[0].firstName + ' ' + task.case.defendants[0].lastName).toLowerCase()
        return taskName.indexOf(keywords) > -1 || caseReference.indexOf(keywords) > -1 || defendantName.indexOf(keywords) > -1
      })
    }

    // Fetch users and teams from user's units for the owner filter
    let users = await prisma.user.findMany({
      where: {
        units: {
          some: {
            unitId: { in: userUnitIds }
          }
        }
      }
    })

    let teams = await prisma.team.findMany({
      where: { unitId: { in: userUnitIds } },
      include: { unit: true }
    })

    // Build owner items with prefixed values
    let ownerItems = []

    // Add users with "user-{id}" prefix
    users.forEach(user => {
      if (currentUser && user.id === currentUser.id) {
        ownerItems.push({
          text: `${user.firstName} ${user.lastName} (you)`,
          value: `user-${user.id}`
        })
      } else {
        ownerItems.push({
          text: `${user.firstName} ${user.lastName}`,
          value: `user-${user.id}`
        })
      }
    })

    // Add teams with "team-{id}" prefix and unit label
    teams.forEach(team => {
      ownerItems.push({
        text: `${team.name} (${team.unit.name})`,
        value: `team-${team.id}`
      })
    })

    // Put current user (you) first
    ownerItems.sort((a, b) => {
      if (a.text.includes('(you)')) return -1
      if (b.text.includes('(you)')) return 1
      return 0
    })

    // Fetch only user's units for the filter
    let units = await prisma.unit.findMany({
      where: { id: { in: userUnitIds } }
    })

    let unitItems = units.map(unit => ({
      text: unit.name,
      value: `${unit.id}`
    }))

    let taskNameItems = taskNames.map(taskName => ({
      text: taskName,
      value: taskName
    }))

    // Severity items
    let severityItems = [
      { text: 'Not due yet', value: 'Not due yet' },
      { text: 'Due soon', value: 'Due soon' },
      { text: 'Overdue', value: 'Overdue' },
      { text: 'Critically overdue', value: 'Critically overdue' }
    ]

    // Urgent items
    let urgentItems = [
      { text: 'Urgent', value: 'Urgent' },
      { text: 'Not urgent', value: 'Not urgent' }
    ]

    // Reminder items
    let reminderItems = [
      { text: 'Is reminder', value: 'Is reminder' },
      { text: 'Is not reminder', value: 'Is not reminder' }
    ]

    // Time limit type items
    let timeLimitTypeItems = [
      { text: 'Custody time limit', value: 'Custody time limit' },
      { text: 'Statutory time limit', value: 'Statutory time limit' },
      { text: 'PACE', value: 'PACE' }
    ]

    // Handle sorting
    const sortBy = _.get(req.session.data, 'taskSort', 'Due date')

    // Add grouping metadata to tasks based on sort type
    tasks = groupTasks(tasks, sortBy)

    // Filter by severity (after grouping, since severity is calculated in groupTasks)
    if (selectedSeverityFilters?.length) {
      tasks = tasks.filter(task => {
        return selectedSeverityFilters.includes(task.severity)
      })
    }

    if (sortBy === 'Time limit' || sortBy === 'Custody time limit' || sortBy === 'Statutory time limit' || sortBy === 'PACE') {
      // Sort by specific time limit date
      // Tasks with the matching time limit type come first, then others
      tasks.sort((a, b) => {
        let aDate = null
        let bDate = null

        if (sortBy === 'Custody time limit') {
          aDate = a.case.custodyTimeLimit
          bDate = b.case.custodyTimeLimit
        } else if (sortBy === 'Statutory time limit') {
          aDate = a.case.statutoryTimeLimit
          bDate = b.case.statutoryTimeLimit
        } else if (sortBy === 'PACE') {
          aDate = a.case.paceTimeLimit
          bDate = b.case.paceTimeLimit
        } else {
          // For 'Time limit', find earliest of all three types
          const aDates = [a.case.custodyTimeLimit, a.case.statutoryTimeLimit, a.case.paceTimeLimit].filter(d => d)
          const bDates = [b.case.custodyTimeLimit, b.case.statutoryTimeLimit, b.case.paceTimeLimit].filter(d => d)
          aDate = aDates.length > 0 ? new Date(Math.min(...aDates.map(d => new Date(d)))) : null
          bDate = bDates.length > 0 ? new Date(Math.min(...bDates.map(d => new Date(d)))) : null
        }

        // Tasks with dates come before tasks without
        if (aDate && !bDate) return -1
        if (!aDate && bDate) return 1

        // If both have dates, sort by date
        if (aDate && bDate) {
          return new Date(aDate) - new Date(bDate)
        }

        // If neither has a date, they're equal
        return 0
      })
    } else if (sortBy === 'Hearing date') {
      // Sort by hearing date - cases with hearings first, then cases without
      tasks.sort((a, b) => {
        const aHasHearing = a.case.hearings && a.case.hearings.length > 0
        const bHasHearing = b.case.hearings && b.case.hearings.length > 0

        if (aHasHearing && !bHasHearing) return -1
        if (!aHasHearing && bHasHearing) return 1
        if (aHasHearing && bHasHearing) {
          return new Date(a.case.hearings[0].startDate) - new Date(b.case.hearings[0].startDate)
        }
        return 0
      })
    } else {
      // Default 'Due date' - sort by severity priority (Critically overdue > Overdue > Due soon > Not due yet), then by date
      tasks.sort((a, b) => {
        // First sort by severity sortOrder
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder
        }
        // Then by reminder date
        return new Date(a.reminderDate) - new Date(b.reminderDate)
      })
    }

    let totalTasks = tasks.length
    let pageSize = 25
    let pagination = new Pagination(tasks, req.query.page, pageSize)
    tasks = pagination.getData()

    res.render('tasks/index', {
      tasks,
      pagination,
      totalTasks,
      ownerItems,
      selectedOwnerFilters,
      selectedOwnerItems,
      unitItems,
      selectedUnitFilters,
      selectedUnitItems,
      severityItems,
      selectedSeverityFilters,
      selectedSeverityItems,
      urgentItems,
      selectedUrgentFilters,
      selectedUrgentItems,
      reminderItems,
      selectedReminderFilters,
      selectedReminderItems,
      timeLimitTypeItems,
      selectedTimeLimitTypeFilters,
      selectedTimeLimitTypeItems,
      taskNameItems,
      selectedTaskNameFilters,
      selectedTaskNameItems,
      selectedFilters
    })
  })

  router.get('/tasks/remove-owner/:filter', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.owner', [])
    _.set(req, 'session.data.taskListFilters.owner', _.pull(currentFilters, req.params.filter))
    res.redirect('/tasks')
  })

  router.get('/tasks/remove-unit/:unitId', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.units', [])
    _.set(req, 'session.data.taskListFilters.units', _.pull(currentFilters, req.params.unitId))
    res.redirect('/tasks')
  })

  router.get('/tasks/remove-task-name/:taskName', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.taskNames', [])
    const taskName = decodeURIComponent(req.params.taskName)
    _.set(req, 'session.data.taskListFilters.taskNames', _.pull(currentFilters, taskName))
    res.redirect('/tasks')
  })

  router.get('/tasks/remove-severity/:severity', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.severities', [])
    const severity = decodeURIComponent(req.params.severity)
    _.set(req, 'session.data.taskListFilters.severities', _.pull(currentFilters, severity))
    res.redirect('/tasks')
  })

  router.get('/tasks/add-urgent/:urgent', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.urgent', [])
    const urgent = decodeURIComponent(req.params.urgent)
    if (!currentFilters.includes(urgent)) {
      currentFilters.push(urgent)
    }
    _.set(req, 'session.data.taskListFilters.urgent', currentFilters)
    res.redirect('/tasks')
  })

  router.get('/tasks/remove-urgent/:urgent', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.urgent', [])
    const urgent = decodeURIComponent(req.params.urgent)
    _.set(req, 'session.data.taskListFilters.urgent', _.pull(currentFilters, urgent))
    res.redirect('/tasks')
  })

  router.get('/tasks/remove-reminder/:reminder', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.reminder', [])
    const reminder = decodeURIComponent(req.params.reminder)
    _.set(req, 'session.data.taskListFilters.reminder', _.pull(currentFilters, reminder))
    res.redirect('/tasks')
  })

  router.get('/tasks/remove-time-limit-type/:timeLimitType', (req, res) => {
    const currentFilters = _.get(req, 'session.data.taskListFilters.timeLimitType', [])
    const timeLimitType = decodeURIComponent(req.params.timeLimitType)
    _.set(req, 'session.data.taskListFilters.timeLimitType', _.pull(currentFilters, timeLimitType))
    res.redirect('/tasks')
  })

  router.get('/tasks/clear-filters', (req, res) => {
    resetFilters(req)
    res.redirect('/tasks')
  })

  router.get('/tasks/clear-search', (req, res) => {
    _.set(req, 'session.data.taskSearch.keywords', '')
    res.redirect('/tasks')
  })

}