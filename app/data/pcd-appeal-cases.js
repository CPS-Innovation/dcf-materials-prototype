// Mock PCD appeal content, keyed by real seeded case id (see prisma/data/database.sqlite).
// Static for now — there's no Prisma model for appeal content yet (see brief);
// case 2001/2002 are real, otherwise-unused seeded cases so the rest of the
// case overview page (identity bar, defendants, etc.) renders normally
// alongside this mock panel.
module.exports = {
  2001: {
    caseId: 2001,
    urn: '59R859619/3',
    taskType: 'Priority PCD Appeal (Red)',
    suspects: ['Norman Danvers'],
    custodyStatus: 'In police custody',
    paceClock: {
      expiryDisplay: '10 Sept 2026, 10:00pm',
      status: 'overdue'
    },
    stl: null,
    originalDecision: {
      prosecutor: 'Alcock, Michelle',
      decision: 'No charge',
      decisionDateDisplay: '10 Sept 2026, 4:45pm',
      test: 'Full Code Test',
      reasoning: 'Insufficient evidence at this stage to provide a realistic prospect of conviction on the robbery charge. Identification evidence alone does not meet the evidential stage of the Full Code Test.',
      charges: [
        { code: 'R01', description: 'Robbery, contrary to section 8(1) of the Theft Act 1968', appealed: true },
        { code: 'A02', description: 'Actual bodily harm, contrary to section 47 of the Offences Against the Person Act 1861', appealed: false }
      ]
    },
    appeal: {
      appealingOfficer: { name: 'Rachel Kirby', rank: 'Police Constable', number: 'PC 4471' },
      oic: { name: 'Marcus Wren', rank: 'Detective Constable', number: 'DC 2290' },
      groundsNarrative: 'Officer submits that a corroborating witness statement was not available to the reviewing lawyer at the time of the charging decision, and that it directly supports the identification evidence already held on the robbery charge.',
      evidenceRefs: ['MG11 - Witness B', 'VRI - Suspect interview'],
      receivedDateDisplay: '11 Sept 2026, 9:15am'
    },
    dcpDecision: null
  },
  2002: {
    caseId: 2002,
    urn: '63W314794/6',
    taskType: 'Review PCD Appeal (Green)',
    suspects: ['Peter Murdock'],
    custodyStatus: 'Remanded in custody',
    paceClock: null,
    stl: {
      expiryDisplay: '20 Nov 2026'
    },
    originalDecision: {
      prosecutor: 'Alcock, Michelle',
      decision: 'Charge refused',
      decisionDateDisplay: '8 Sept 2026, 11:20am',
      test: 'Threshold Test',
      reasoning: 'Evidence available at this stage does not meet the Threshold Test for the burglary or criminal damage charges. The theft charge was authorised and is not part of this appeal.',
      charges: [
        { code: 'B11', description: 'Burglary, contrary to section 9(1)(a) of the Theft Act 1968', appealed: true },
        { code: 'C03', description: 'Criminal damage, contrary to section 1(1) of the Criminal Damage Act 1971', appealed: true },
        { code: 'B10', description: 'Theft, contrary to section 1(1) of the Theft Act 1968', appealed: false }
      ]
    },
    appeal: {
      appealingOfficer: { name: 'Aiden Frost', rank: 'Police Constable', number: 'PC 3312' },
      oic: null,
      groundsNarrative: 'Officer submits that a forensic report (fingerprint match at the scene) was not before the reviewing lawyer when the charging decision was made, and satisfies the Threshold Test for both the burglary and criminal damage charges. Officer further submits that the suspect should remain remanded in custody, as there is no real prospect that a court would decline to impose an immediate custodial sentence given the seriousness and pattern of offending — the Bail Act 1976 exception should not apply. The theft charge is not disputed and is excluded from this appeal.',
      evidenceRefs: ['MG7 - Forensic report', 'Scene photographs'],
      receivedDateDisplay: '9 Sept 2026, 1:40pm'
    },
    dcpDecision: null
  }
}
