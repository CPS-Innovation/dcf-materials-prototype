// Additive-only script — six more "Review PCD appeal" (Green) tasks, so the
// Task list tab (which now shows Green and Red appeals together) has a more
// realistic spread rather than 2 Green against 8 Red. Same shape as
// seed-pcd-appeal-backfill.js: Task + PcdAppeal + one real PcdAppealCharge
// per case, using each case's own lead defendant/charge.
//
// The rows deliberately vary:
// - due dates: critically overdue, overdue, due soon and not due yet, so
//   every severity counter has something in it (dates are fixed, so this
//   spread was set against early October 2026 and will age)
// - urgency: 2 urgent, 4 not
// - appeal grounds: the three common reasons in the October 2026 user
//   research report — disagreement with the evidential assessment, new
//   evidence since the decision, and victim/public interest factors
// Owners (3 assigned, 3 unassigned) are set by seed-pcd-appeal-demo-mix.js,
// not here, so the footer's testing reset can restore them.
//
// Run once: node prisma/seed-pcd-appeal-green-spread.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { getLeadDefendantWithCharges } = require("./lib/pcdAppealSeedHelpers");

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const rows = [
    {
      caseId: 9, isUrgent: false,
      dueDate: new Date("2026-10-01T17:00:00.000Z"), // critically overdue
      officer: { name: "Alex Morrow", rank: "Inspector", number: "INSP 6104" },
      grounds: "The officer believes the evidence is sufficient to charge. The victim's account is consistent across two statements and is supported by the 999 call recording.\n\nThe officer considers the reviewing lawyer gave too much weight to minor inconsistencies in the suspect's interview.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Insufficient evidence at this stage to provide a realistic prospect of conviction." }
    },
    {
      caseId: 10, isUrgent: true,
      dueDate: new Date("2026-10-07T17:00:00.000Z"), // overdue
      officer: { name: "Priya Nair", rank: "Detective Inspector", number: "DI 6218" },
      grounds: "A further witness has come forward since the charging decision and has given a statement placing the suspect at the scene.\n\nThe officer submits that this new statement addresses the identification gap identified in the original review.",
      decision: { outcome: "Charge refused", test: "Threshold Test", reasoning: "Evidence available at this stage does not meet the Threshold Test." }
    },
    {
      caseId: 11, isUrgent: false,
      dueDate: new Date("2026-10-09T17:00:00.000Z"), // due soon
      officer: { name: "Tom Hadley", rank: "Inspector", number: "INSP 6335" },
      grounds: "The officer submits that the public interest strongly favours prosecution. This is the third reported incident involving the same suspect and victim in six months, and the victim has said they feel unsafe in their home.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Evidential stage met, but prosecution not considered to be in the public interest given the circumstances at the time of review." }
    },
    {
      caseId: 12, isUrgent: false,
      dueDate: new Date("2026-10-10T17:00:00.000Z"), // due soon
      officer: { name: "Leah Okafor", rank: "Inspector", number: "INSP 6442" },
      grounds: "The officer considers this a borderline decision on the evidential test and respectfully disagrees with the lawyer's interpretation of the CCTV footage, which the officer believes clearly shows the suspect's face.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "CCTV footage of insufficient quality to support identification; no other identification evidence available." }
    },
    {
      caseId: 13, isUrgent: true,
      dueDate: new Date("2026-10-20T17:00:00.000Z"), // not due yet
      officer: { name: "Ben Arkwright", rank: "Chief Inspector", number: "CI 6559" },
      grounds: "Forensic results received after the charging decision link the suspect to the recovered items.\n\nThe officer asks that the decision is reviewed in light of the forensic report, which is now attached to the case.",
      decision: { outcome: "Charge refused", test: "Threshold Test", reasoning: "Evidence available at this stage does not meet the Threshold Test; forensic results outstanding." }
    },
    {
      caseId: 15, isUrgent: false,
      dueDate: new Date("2026-10-27T17:00:00.000Z"), // not due yet
      officer: { name: "Grace Whitfield", rank: "Inspector", number: "INSP 6667" },
      grounds: "The officer submits that the impact on the victim, an elderly person living alone, was not fully considered. A Victim Personal Statement has since been taken and describes significant ongoing distress.",
      decision: { outcome: "No charge", test: "Full Code Test", reasoning: "Prosecution not considered to be in the public interest given the low value of the property and the suspect's lack of previous convictions." }
    }
  ];

  for (const row of rows) {
    const taskName = "Review PCD appeal";
    const existingTask = await prisma.task.findFirst({ where: { caseId: row.caseId, name: taskName } });
    if (existingTask) {
      console.log(`Skipping case ${row.caseId} — "${taskName}" task already exists`);
      continue;
    }

    // ±3 days either side of the due date, so "due soon" and "overdue"
    // each cover a few days rather than a few hours
    const reminderDate = new Date(row.dueDate.getTime() - 3 * DAY);
    const escalationDate = new Date(row.dueDate.getTime() + 3 * DAY);
    // Original decision made around 10 days before the due date, so the
    // appeal sits plausibly inside the 14-day window
    const originalDecisionAt = new Date(row.dueDate.getTime() - 10 * DAY);
    const receivedAt = new Date(originalDecisionAt.getTime() + 2 * DAY);

    const task = await prisma.task.create({
      data: {
        name: taskName,
        caseId: row.caseId,
        reminderDate,
        dueDate: row.dueDate,
        escalationDate,
        isUrgent: row.isUrgent
      }
    });

    const leadDefendant = await getLeadDefendantWithCharges(prisma, row.caseId);
    const appealedCharge = leadDefendant && leadDefendant.charges.length ? leadDefendant.charges[0] : null;
    if (!appealedCharge) {
      console.log(`  Note: case ${row.caseId}'s lead defendant has no charges — creating PcdAppeal with no linked charge`);
    }

    await prisma.pcdAppeal.create({
      data: {
        taskId: task.id,
        originalDecisionOutcome: row.decision.outcome,
        originalDecisionAt,
        originalDecisionTest: row.decision.test,
        originalDecisionReasoning: row.decision.reasoning,
        appealingOfficerName: row.officer.name,
        appealingOfficerRank: row.officer.rank,
        appealingOfficerNumber: row.officer.number,
        groundsNarrative: row.grounds,
        receivedAt,
        slaEndsAt: null,
        charges: appealedCharge ? { create: [{ chargeId: appealedCharge.id, appealed: true }] } : undefined
      }
    });

    console.log(`Created "${taskName}" task ${task.id} + PcdAppeal for case ${row.caseId}`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
