const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {
  router.get("/cases/:caseId/tasks/:taskId/notes/new", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        defendants: true
      }
    })

    const task = await prisma.task.findUnique({
      where: { id: taskId }
    })

    const description = req.session.data.addTaskNote?.description || ''

    res.render("cases/tasks/notes/new/index", { _case, task, description })
  })

  router.post("/cases/:caseId/tasks/:taskId/notes/new", (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)

    res.redirect(`/cases/${caseId}/tasks/${taskId}/notes/new/check`)
  })

  router.get("/cases/:caseId/tasks/:taskId/notes/new/check", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        defendants: true
      }
    })

    const task = await prisma.task.findUnique({
      where: { id: taskId }
    })

    const description = req.session.data.addTaskNote?.description || ''

    res.render("cases/tasks/notes/new/check", { _case, task, description })
  })

  router.post("/cases/:caseId/tasks/:taskId/notes/new/check", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)
    const description = req.session.data.addTaskNote.description

    // Create the task note
    await prisma.taskNote.create({
      data: {
        description,
        taskId
      }
    })

    delete req.session.data.addTaskNote

    req.flash('success', 'Note added')
    res.redirect(`/cases/${caseId}/tasks/${taskId}`)
  })
}
