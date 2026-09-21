// Additive-only script — for the PCD-appeal rows that don't have a real Task
// yet (priority-charging-task-list.json's pc2-pc8, pcd-task-list.json's t8),
// creates the missing Task + PcdAppeal + a real PcdAppealCharge per case,
// using each case's own real defendants/charges rather than the disconnected
// mock text (same fix already applied to the caseId assignments themselves).
//
// Run once: node prisma/seed-pcd-appeal-backfill.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { getLeadDefendantWithCharges } = require("./lib/pcdAppealSeedHelpers");

async function main() {
  // appealedChargeId is deliberately not hardcoded here — seed.js generates
  // defendants/charges with random fake data and no fixed RNG seed, so
  // which charge belongs to which case's lead defendant is resolved
  // dynamically per row below, not assumed.
  const rows = [
    // Priority charging (Red) rows — pc2 through pc8
    {
      caseId: 2, taskName: "Priority PCD Review", isUrgent: true, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-22T14:41:00.000Z"), slaEndsAt: new Date("2026-09-18T14:41:00.000Z"),
      officer: { name: "Jordan Blake", rank: "Police Constable", number: "PC 5102" },
      grounds: "Officer submits that new CCTV footage was not available to the reviewing lawyer at the time of the charging decision and supports the identification evidence already held.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Insufficient evidence at this stage to provide a realistic prospect of conviction." }
    },
    {
      caseId: 3, taskName: "Priority PCD Review", isUrgent: false, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-23T14:41:00.000Z"), slaEndsAt: new Date("2026-09-16T14:41:00.000Z"),
      previouslyUrgent: true, // demo row for the "Was urgent" tag
      officer: { name: "Morgan Reid", rank: "Police Constable", number: "PC 5211" },
      grounds: "Officer submits that a witness statement obtained after charge directly supports the theft charge and satisfies the Full Code Test.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Insufficient evidence at this stage to provide a realistic prospect of conviction." }
    },
    {
      caseId: 4, taskName: "Priority PCD Review", isUrgent: false, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-24T16:06:00.000Z"), slaEndsAt: new Date("2026-09-17T16:06:00.000Z"),
      officer: { name: "Sam Ellery", rank: "Detective Constable", number: "DC 5309" },
      grounds: "Officer submits that forensic evidence obtained after charge satisfies the Threshold Test for the burglary charge.",
      decision: { outcome: "Charge refused", test: "Threshold Test", reasoning: "Evidence available at this stage does not meet the Threshold Test." }
    },
    {
      caseId: 5, taskName: "Priority PCD Review", isUrgent: false, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-25T13:38:00.000Z"), slaEndsAt: new Date("2026-09-18T13:38:00.000Z"),
      officer: { name: "Casey Marlowe", rank: "Police Constable", number: "PC 5417" },
      grounds: "Officer submits that a corroborating witness statement was not available to the reviewing lawyer at the time of the charging decision.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Insufficient evidence at this stage to provide a realistic prospect of conviction." }
    },
    {
      caseId: 6, taskName: "Priority PCD Review", isUrgent: true, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-21T12:27:00.000Z"), slaEndsAt: new Date("2026-09-17T12:27:00.000Z"),
      officer: { name: "Riley Fenwick", rank: "Detective Constable", number: "DC 5528" },
      grounds: "Officer submits that identification evidence obtained after charge satisfies the Full Code Test for the robbery charge.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Insufficient evidence at this stage to provide a realistic prospect of conviction." }
    },
    {
      caseId: 7, taskName: "Priority PCD Review", isUrgent: true, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-22T15:53:00.000Z"), slaEndsAt: new Date("2026-09-16T15:53:00.000Z"),
      officer: { name: "Harper Dunn", rank: "Police Constable", number: "PC 5636" },
      grounds: "Officer submits that a forensic report obtained after charge satisfies the Threshold Test for the burglary charge.",
      decision: { outcome: "Charge refused", test: "Threshold Test", reasoning: "Evidence available at this stage does not meet the Threshold Test." }
    },
    {
      caseId: 8, taskName: "Priority PCD Review", isUrgent: false, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-20T09:15:00.000Z"), slaEndsAt: new Date("2026-09-13T09:15:00.000Z"),
      officer: { name: "Quinn Ashby", rank: "Police Constable", number: "PC 5744" },
      grounds: "Officer submits that a corroborating witness statement was not available to the reviewing lawyer at the time of the charging decision.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Insufficient evidence at this stage to provide a realistic prospect of conviction." }
    },
    // Task list (Green) row — t8
    {
      caseId: 14, taskName: "Review PCD Appeal", isUrgent: false, assignedToUserId: null, // starts unassigned
      dueDate: new Date("2026-09-15T23:59:59.000Z"), slaEndsAt: null,
      officer: { name: "Drew Callahan", rank: "Police Constable", number: "PC 5852" },
      grounds: "Officer submits that a forensic report obtained after charge satisfies the Threshold Test for the possession with intent to supply charge.",
      decision: { outcome: "Charge refused", test: "Threshold Test", reasoning: "Evidence available at this stage does not meet the Threshold Test." }
    }
  ]

  for (const row of rows) {
    const existingTask = await prisma.task.findFirst({ where: { caseId: row.caseId, name: row.taskName } })
    if (existingTask) {
      console.log(`Skipping case ${row.caseId} — "${row.taskName}" task already exists`)
      continue
    }

    const reminderDate = new Date(row.dueDate.getTime() - 24 * 60 * 60 * 1000)
    const escalationDate = new Date(row.dueDate.getTime() + 24 * 60 * 60 * 1000)

    const task = await prisma.task.create({
      data: {
        name: row.taskName,
        caseId: row.caseId,
        reminderDate,
        dueDate: row.dueDate,
        escalationDate,
        isUrgent: row.isUrgent,
        assignedToUserId: row.assignedToUserId
      }
    })

    const leadDefendant = await getLeadDefendantWithCharges(prisma, row.caseId)
    const appealedCharge = leadDefendant && leadDefendant.charges.length ? leadDefendant.charges[0] : null
    if (!appealedCharge) {
      console.log(`  Note: case ${row.caseId}'s lead defendant has no charges — creating PcdAppeal with no linked charge`)
    }

    await prisma.pcdAppeal.create({
      data: {
        taskId: task.id,
        originalDecisionOutcome: row.decision.outcome,
        originalDecisionAt: reminderDate,
        originalDecisionTest: row.decision.test,
        originalDecisionReasoning: row.decision.reasoning,
        appealingOfficerName: row.officer.name,
        appealingOfficerRank: row.officer.rank,
        appealingOfficerNumber: row.officer.number,
        groundsNarrative: row.grounds,
        receivedAt: reminderDate,
        slaEndsAt: row.slaEndsAt,
        previouslyUrgent: row.previouslyUrgent || false,
        charges: appealedCharge ? { create: [{ chargeId: appealedCharge.id, appealed: true }] } : undefined
      }
    })

    console.log(`Created "${row.taskName}" task ${task.id} + PcdAppeal for case ${row.caseId}`)
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
