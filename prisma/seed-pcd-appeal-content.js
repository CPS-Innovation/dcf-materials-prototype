// Additive-only script — adds the PcdAppeal + PcdAppealCharge rows for the
// two Task rows that already exist (seed-pcd-appeal-tasks.js): case 2001
// ("Priority PCD Review") and case 2002 ("Review PCD Appeal"). Carries over
// today's app/data/pcd-appeal-cases.js narrative text verbatim so these two
// already-working demo cards keep their exact content, just from a real
// table now instead of a static mock.
//
// Run once: node prisma/seed-pcd-appeal-content.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const appeals = [
    {
      caseId: 2001,
      taskName: "Priority PCD Review",
      originalDecisionByUserId: 54, // David Frost — case 2001's real assigned prosecutor
      originalDecisionOutcome: "No charge",
      originalDecisionAt: new Date("2026-09-10T16:45:00.000Z"),
      originalDecisionTest: "Full Code Test",
      originalDecisionReasoning: "Insufficient evidence at this stage to provide a realistic prospect of conviction on the robbery charge. Identification evidence alone does not meet the evidential stage of the Full Code Test.",
      appealingOfficerName: "Rachel Kirby",
      appealingOfficerRank: "Police Constable",
      appealingOfficerNumber: "PC 4471",
      groundsNarrative: "Officer submits that a corroborating witness statement was not available to the reviewing lawyer at the time of the charging decision, and that it directly supports the identification evidence already held on the robbery charge.",
      receivedAt: new Date("2026-09-11T09:15:00.000Z"),
      slaEndsAt: new Date("2026-09-10T22:00:00.000Z"), // matches the seeded Task's dueDate — already past, "Expired"
      charges: [
        { chargeId: 48, appealed: true },  // R01 Robbery — real charge on case 2001
        { chargeId: 82, appealed: false }  // A02 ABH — real charge on case 2001
      ]
    },
    {
      caseId: 2002,
      taskName: "Review PCD Appeal",
      originalDecisionByUserId: 31, // Diana Taylor — case 2002's real assigned prosecutor
      originalDecisionOutcome: "Charge refused",
      originalDecisionAt: new Date("2026-09-08T11:20:00.000Z"),
      originalDecisionTest: "Threshold Test",
      originalDecisionReasoning: "Evidence available at this stage does not meet the Threshold Test for the burglary or criminal damage charges. The theft charge was authorised and is not part of this appeal.",
      appealingOfficerName: "Aiden Frost",
      appealingOfficerRank: "Police Constable",
      appealingOfficerNumber: "PC 3312",
      groundsNarrative: "Officer submits that a forensic report (fingerprint match at the scene) was not before the reviewing lawyer when the charging decision was made, and satisfies the Threshold Test for both the burglary and criminal damage charges. Officer further submits that the suspect should remain remanded in custody, as there is no real prospect that a court would decline to impose an immediate custodial sentence given the seriousness and pattern of offending — the Bail Act 1976 exception should not apply. The theft charge is not disputed and is excluded from this appeal.",
      receivedAt: new Date("2026-09-09T13:40:00.000Z"),
      slaEndsAt: null, // Task list (Green) row — SLA ends is a Priority charging column only
      // No real charge on case 2002 matches these — kept as free text per
      // the decision to leave case 2002 unlinked rather than substitute
      // different real charges.
      charges: [
        { chargeCode: "B11", chargeDescription: "Burglary, contrary to section 9(1)(a) of the Theft Act 1968", appealed: true },
        { chargeCode: "C03", chargeDescription: "Criminal damage, contrary to section 1(1) of the Criminal Damage Act 1971", appealed: true },
        { chargeCode: "B10", chargeDescription: "Theft, contrary to section 1(1) of the Theft Act 1968", appealed: false }
      ]
    }
  ]

  for (const appeal of appeals) {
    const task = await prisma.task.findFirst({ where: { caseId: appeal.caseId, name: appeal.taskName } })
    if (!task) {
      console.log(`Skipping case ${appeal.caseId} — no "${appeal.taskName}" task found`)
      continue
    }

    const existing = await prisma.pcdAppeal.findUnique({ where: { taskId: task.id } })
    if (existing) {
      console.log(`Skipping case ${appeal.caseId} — PcdAppeal already exists for task ${task.id}`)
      continue
    }

    const created = await prisma.pcdAppeal.create({
      data: {
        taskId: task.id,
        originalDecisionByUserId: appeal.originalDecisionByUserId,
        originalDecisionOutcome: appeal.originalDecisionOutcome,
        originalDecisionAt: appeal.originalDecisionAt,
        originalDecisionTest: appeal.originalDecisionTest,
        originalDecisionReasoning: appeal.originalDecisionReasoning,
        appealingOfficerName: appeal.appealingOfficerName,
        appealingOfficerRank: appeal.appealingOfficerRank,
        appealingOfficerNumber: appeal.appealingOfficerNumber,
        groundsNarrative: appeal.groundsNarrative,
        receivedAt: appeal.receivedAt,
        slaEndsAt: appeal.slaEndsAt,
        charges: {
          create: appeal.charges.map(c => ({
            chargeId: c.chargeId || null,
            chargeCode: c.chargeCode || null,
            chargeDescription: c.chargeDescription || null,
            appealed: c.appealed
          }))
        }
      }
    })
    console.log(`Created PcdAppeal ${created.id} for case ${appeal.caseId} (task ${task.id})`)
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
