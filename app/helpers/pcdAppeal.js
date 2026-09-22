const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { addTimeLimitDates } = require('./timeLimit')
const { getTaskSeverity } = require('./taskState')

// Real-data replacement for the now-deleted app/data/pcd-appeal-cases.js and
// app/data/priority-charging-task-list.json, and the two PCD-appeal rows
// that used to live in app/data/pcd-task-list.json (t1-t6 there are
// unrelated task types and stay mocked). Reshapes real
// Task/Case/Defendant/Charge/PcdAppeal data into the exact object shapes
// the existing templates already read, so no template changes were needed
// beyond the 5 placeholder rows and date formatting on the appeal-cascade
// pages (pcd-appeal.njk, history-panel.njk, decision.html).

// Real task type names (confirmed against a real CMS TaskTypes export) —
// "PCD Appeal (Red/Green)" was our own invented naming, corrected here.
const TASK_LIST_APPEAL_NAME = 'Review PCD Appeal'
const PRIORITY_CHARGING_APPEAL_NAME = 'Priority PCD Review'

const TASK_INCLUDE = {
  case: {
    include: {
      defendants: { include: { charges: true } },
      prosecutors: { include: { user: true } },
      paralegalOfficers: { include: { user: true } },
      hearings: { orderBy: { startDate: 'asc' }, take: 1 }
    }
  },
  assignedToUser: true,
  assignedToTeam: { include: { unit: true } },
  notes: true,
  pcdAppeal: {
    include: {
      charges: { include: { charge: true } },
      originalDecisionByUser: true,
      dcpDecisionByUser: true
    }
  }
}

// The two table templates render *Display fields as plain text (no date
// filter) — matching the legacy JSON rows' pre-formatted style ("6 Jul
// 2020", "12 Sep 2026, 10:00pm") so real and legacy rows look consistent
// side by side, and so neither table template needs to change.
function formatShortDate(date) {
  if (!date) return null
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(date))
}

function formatShortDateTime(date) {
  if (!date) return null
  const datePart = formatShortDate(date)
  const timePart = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(date)).toLowerCase().replace(' ', '')
  return `${datePart}, ${timePart}`
}

function formatDefendantName(defendant) {
  return `${defendant.lastName.toUpperCase()}, ${defendant.firstName}`
}

function formatOwnerInitials(task) {
  if (task.assignedToUser) {
    const { firstName, lastName } = task.assignedToUser
    return ((firstName[0] || '') + (lastName[0] || '')).toUpperCase()
  }
  if (task.assignedToTeam) {
    return task.assignedToTeam.name.slice(0, 2).toUpperCase()
  }
  return 'Unassigned' // matches the real CMS's literal ownerInitials value for an unassigned task
}

function getMonitoringCodes(task) {
  const codes = ['PCD Appeal']
  if (task.isUrgent) codes.push('Urgent')
  if (task.case.custodyTimeLimit && new Date(task.case.custodyTimeLimit) <= new Date()) {
    codes.push('CTL: EXP')
  }
  return codes
}

function getSlaCountdownStatus(slaEndsAt) {
  if (!slaEndsAt) return null
  return new Date(slaEndsAt) <= new Date() ? 'Expired' : 'Due'
}

// "Time limit" column (Task list table only) — soonest of custody/statutory/
// PACE, or null if none apply. Both current PCD-appeal rows (t7/t8) show
// null today, so this only changes behaviour once a case actually has one.
function getTimeLimitLabel(_case) {
  const dates = [_case.custodyTimeLimit, _case.statutoryTimeLimit, _case.paceTimeLimit].filter(Boolean)
  if (!dates.length) return null
  return 'Time limit'
}

function getProsecutorName(_case) {
  const prosecutor = _case.prosecutors[0]
  if (!prosecutor) return '-'
  return `${prosecutor.user.lastName}, ${prosecutor.user.firstName}`
}

function getParalegalOfficerName(_case) {
  const paralegal = _case.paralegalOfficers[0]
  if (!paralegal) return '-'
  return `${paralegal.user.lastName}, ${paralegal.user.firstName}`
}

// A PCD appeal is always about one defendant — the lead (first) defendant
// on the case — and its appealed charges belong only to that defendant.
// Tables and the appeal cascade both show just this one name, never
// "+N more"/"and N more" for the case's other defendants.
function getLeadDefendant(task) {
  return task.case.defendants[0]
}

// Fields common to both tables' rows.
function mapTaskCommon(task) {
  addTimeLimitDates(task.case)
  const leadDefendant = getLeadDefendant(task)
  const defendants = [formatDefendantName(leadDefendant)]
  const totalCharges = leadDefendant.charges.length

  return {
    id: task.id,
    caseId: task.caseId,
    overviewCaseId: task.caseId,
    locked: false,
    previouslyUrgent: task.pcdAppeal ? task.pcdAppeal.previouslyUrgent : false,
    urgent: task.isUrgent,
    urn: task.case.reference,
    defendants,
    task: task.name,
    owner: formatOwnerInitials(task),
    dueDateDisplay: formatShortDate(task.dueDate),
    dueDateSort: task.dueDate.toISOString(),
    notesCount: task.notes.length,
    saved: false,
    severityBucket: mapSeverityToBucket(getTaskSeverity(task)),
    detail: {
      prosecutor: getProsecutorName(task.case),
      paralegalOfficer: getParalegalOfficerName(task.case),
      officerInCharge: '-',
      counsel: '-',
      defendantsLinkText: defendants[0],
      totalChargesText: `${totalCharges} charge${totalCharges !== 1 ? 's' : ''} or count${totalCharges !== 1 ? 's' : ''}`,
      monitoringCodes: getMonitoringCodes(task),
      chargeSummaryCount: totalCharges
    }
  }
}

function mapTaskToTaskListRow(task) {
  const hearing = task.case.hearings[0]
  return {
    ...mapTaskCommon(task),
    timeLimit: getTimeLimitLabel(task.case),
    type: 'PCD Appeal',
    hearingDisplay: hearing ? formatShortDate(hearing.startDate) : null,
    hearingSort: hearing ? hearing.startDate.toISOString() : ''
  }
}

function mapTaskToPriorityChargingRow(task) {
  const slaEndsAt = task.pcdAppeal ? task.pcdAppeal.slaEndsAt : null
  const paceClockEndsAt = task.case.paceTimeLimit
  return {
    ...mapTaskCommon(task),
    slaEndsDisplay: formatShortDateTime(slaEndsAt),
    slaEndsSort: slaEndsAt ? slaEndsAt.toISOString() : '',
    paceClockEndsDisplay: formatShortDateTime(paceClockEndsAt),
    paceClockEndsSort: paceClockEndsAt ? paceClockEndsAt.toISOString() : '',
    countdownStatus: getSlaCountdownStatus(slaEndsAt)
  }
}

async function getAppealTaskListRows() {
  const tasks = await prisma.task.findMany({
    where: { name: TASK_LIST_APPEAL_NAME, completedDate: null },
    include: TASK_INCLUDE,
    orderBy: { id: 'asc' }
  })
  return tasks.map(mapTaskToTaskListRow)
}

async function getPriorityChargingRows() {
  const tasks = await prisma.task.findMany({
    where: { name: PRIORITY_CHARGING_APPEAL_NAME, completedDate: null },
    include: TASK_INCLUDE,
    orderBy: { id: 'asc' }
  })
  return tasks.map(mapTaskToPriorityChargingRow)
}

// Maps getTaskSeverity's real vocabulary onto the PCD demo tables' own
// severity-bucket vocabulary (pcdSeverityCounts / the quick-filter counters
// in task-list-table.njk / priority-charging-table.njk).
function mapSeverityToBucket(severity) {
  const map = {
    'Not due yet': 'Due',
    'Due soon': 'Due Soon',
    'Overdue': 'Overdue',
    'Critically overdue': 'Escalated'
  }
  return map[severity] || null
}

// Raw Task (+ its PcdAppeal, with real row ids) for a case — used both by
// getPcdAppealForCase below and by the DCP-decision write routes in
// case--details.js, which need real PcdAppeal/PcdAppealCharge ids to update.
async function getRawTaskWithAppealForCase(caseId) {
  return prisma.task.findFirst({
    where: {
      caseId,
      name: { in: [TASK_LIST_APPEAL_NAME, PRIORITY_CHARGING_APPEAL_NAME] }
    },
    include: TASK_INCLUDE
  })
}

// Reshapes a Task + its PcdAppeal into the object shape the case-overview
// card, History tab card, and /pcd-appeal/decision page already read
// (pcdAppeal.urn, pcdAppeal.appeal.groundsNarrative, etc.) — this is what
// used to live in app/data/pcd-appeal-cases.js.
async function getPcdAppealForCase(caseId) {
  const task = await getRawTaskWithAppealForCase(caseId)
  if (!task || !task.pcdAppeal) return { pcdAppeal: null, taskId: null }

  addTimeLimitDates(task.case)
  const appeal = task.pcdAppeal

  const charges = appeal.charges.map(pac => ({
    code: pac.charge ? pac.charge.chargeCode : pac.chargeCode,
    description: pac.charge ? pac.charge.description : pac.chargeDescription,
    appealed: pac.appealed
  }))

  const pcdAppeal = {
    caseId: task.caseId,
    urn: task.case.reference,
    taskType: task.name,
    suspects: [`${getLeadDefendant(task).firstName} ${getLeadDefendant(task).lastName}`],
    stl: task.case.statutoryTimeLimit ? { expiryDisplay: task.case.statutoryTimeLimit } : null,
    originalDecision: {
      // Snapshot of who made the original decision — deliberately not the
      // case's *current* prosecutor (task.detail.prosecutor below), since
      // the case may have been reassigned since the original decision.
      prosecutor: appeal.originalDecisionByUser ? `${appeal.originalDecisionByUser.lastName}, ${appeal.originalDecisionByUser.firstName}` : '-',
      decision: appeal.originalDecisionOutcome,
      decisionDateDisplay: appeal.originalDecisionAt,
      test: appeal.originalDecisionTest,
      reasoning: appeal.originalDecisionReasoning,
      charges
    },
    appeal: {
      appealingOfficer: {
        name: appeal.appealingOfficerName,
        rank: appeal.appealingOfficerRank,
        number: appeal.appealingOfficerNumber
      },
      groundsNarrative: appeal.groundsNarrative,
      receivedDateDisplay: appeal.receivedAt
    },
    dcpDecision: appeal.dcpDecisionAt ? {
      testApplied: appeal.dcpDecisionTestApplied,
      reasoning: appeal.dcpDecisionReasoning,
      decidedBy: appeal.dcpDecisionByUser ? `${appeal.dcpDecisionByUser.firstName} ${appeal.dcpDecisionByUser.lastName}` : null,
      decidedDateDisplay: appeal.dcpDecisionAt,
      chargeOutcomes: charges.filter(c => c.appealed).map(c => ({
        code: c.code,
        outcome: appeal.charges.find(pac => (pac.charge ? pac.charge.chargeCode : pac.chargeCode) === c.code).decisionOutcome
      }))
    } : null,
    // Placeholder rows, single-sourced from the DB instead of duplicated
    // literal text in two templates.
    investigationStage: appeal.investigationStage,
    actionPlan: appeal.actionPlan,
    specifiedCharges: appeal.specifiedCharges,
    pcdPrincipalOffenceCategory: appeal.pcdPrincipalOffenceCategory
  }

  return { pcdAppeal, taskId: task.id }
}

// Fetches and reshapes a single real appeal Task by id into the same
// {task, urn, defendants, owner, detail, ...} shape mapTaskCommon produces
// for the two tables — used by task--reassign.js so its templates (which
// expect that shape from the legacy JSON rows) work unchanged for real
// PCD-appeal Task rows too.
async function getTaskForReassign(taskId) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE })
  return task ? mapTaskCommon(task) : null
}

// Case details' generic Tasks card (tasks-panel.njk) — same owner/button
// logic as the two PCD-appeal tables, reshaped into the single-row array
// that card expects (0 rows if this case has no PCD-appeal task at all).
async function getCaseTaskPanelRows(caseId) {
  const task = await getRawTaskWithAppealForCase(caseId)
  if (!task) return []

  const mapped = mapTaskCommon(task)
  return [{
    id: mapped.id,
    caseId: mapped.caseId,
    name: mapped.task,
    dueDate: mapped.dueDateDisplay,
    status: mapped.severityBucket,
    owner: mapped.owner,
    hasWarning: mapped.urgent
  }]
}

module.exports = {
  TASK_LIST_APPEAL_NAME,
  PRIORITY_CHARGING_APPEAL_NAME,
  TASK_INCLUDE,
  formatDefendantName,
  formatOwnerInitials,
  getAppealTaskListRows,
  getPriorityChargingRows,
  getPcdAppealForCase,
  getRawTaskWithAppealForCase,
  getTaskForReassign,
  getCaseTaskPanelRows
}
