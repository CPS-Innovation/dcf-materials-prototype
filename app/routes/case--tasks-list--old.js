const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { getTaskSeverity } = require('../helpers/taskState')
const { addTimeLimitDates } = require('../helpers/timeLimit')

module.exports = router => {


router.get('/tasks', async (req, res) => {
  // 👇 pin by REFERENCE (stable across reseeds), not id
  const PINNED_CASE_REFERENCE = '99AA000001/1'

  // 1) Fetch the pinned case with the bits the template reads
  const pinnedCase = await prisma.case.findFirst({
    where: { reference: PINNED_CASE_REFERENCE },
    include: { defendants: true }
  })

  // 2) Build a "fake task" that matches the template’s shape
  const pinnedTask = pinnedCase
    ? {
        id: `pinned-${pinnedCase.id}`,
        name: 'Indictments (pinned)',
        isUrgent: false,
        severity: '',
        dueDate: new Date(), // template expects a dueDate
        case: pinnedCase,
        assignedToUser: null,
        assignedToTeam: null
      }
    : null

  // 3) Pull any other tasks WITHOUT user/session filtering
  const otherTasks = await prisma.task.findMany({
    include: {
      case: { include: { defendants: true } },
      assignedToUser: true,
      assignedToTeam: { include: { unit: true } }
    },
    orderBy: { dueDate: 'asc' },
    take: 25
  })

  // 4) Prepend pinned + dedupe if it’s already in the list
  const tasks = []
  if (pinnedTask) tasks.push(pinnedTask)

  for (const t of otherTasks) {
    if (!pinnedTask || t.case?.id !== pinnedCase?.id) tasks.push(t)
  }

  console.log('Pinned case found?', !!pinnedCase, pinnedCase?.id, pinnedCase?.reference)


  return res.render('tasks/index', { tasks })
})


}
