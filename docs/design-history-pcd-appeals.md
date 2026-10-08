# Design history: PCD police appeals

**Status:** living document — edit as the work continues.
**Last updated:** October 2026.
**Covers:** moving PCD (pre-charge decision) appeal handling from an email-only process into a task-based CMS flow — research, prototype decisions, and open questions.

This document exists so anyone picking up this work later — a new designer, a developer, a stakeholder — can follow how we got here without having to ask around. It includes the work that's still unresolved, not just what shipped.

---

## 1. The problem, in one paragraph

PCD appeals — a police officer challenging a charging decision — currently arrive by email into a shared inbox or a Teams channel, with no formal task list, reminders, or tracking. Appeals can go unactioned without anyone noticing. Some have a hard 14-day statutory deadline; others are effectively immediate, because someone is waiting in custody. We ran research with 9 participants (4 Charging Managers, 5 DCPs) to understand the current process, then prototyped a task-based alternative inside the existing case management system.

## 2. User needs

Drawn directly from the research, not assumed:

- **Don't let an appeal go unactioned.** The single most repeated theme. *"It's reliant on the DCP to pick it up and review the case... it doesn't appear in a task list, it doesn't appear in a reminder or any other format."* (DCP)
- **Reflect real urgency, not a flat SLA.** For custody cases, urgency isn't a countdown, it's immediate: *"appeals aren't just urgent, they're immediately urgent because someone is waiting in custody."* (DCP)
- **Spend time on judgment, not plumbing.** Charging Managers described manual CMS workarounds — forwarding emails to fix a missing URN, emailing proof of assignment into CMS "to prove we sent it to the lawyer" — that exist purely to compensate for the tooling, not the job itself.
- **State the rules, don't make people guess them.** Task-completion logic is currently folklore, not something the system tells you (e.g. uncertainty over whether a task can only be "completed" by carrying out a full review).
- **Carry context across a handoff.** For urgent cases, the original reporting officer has often gone off shift by the time of review, and the reviewer has no easy way to reach whoever picked it up.
- **Let the tool match how the job actually varies.** Charging Managers (routine, 14-day window), CPSD (higher volume, inconsistent appeal quality), and custody-clock appeals are three genuinely different operating patterns, not one process with three names.

## 3. Business needs

- **A defensible audit trail against a statutory deadline.** The 14-day window is a legal obligation; an email inbox is not an auditable record of when it was received, triaged, or assigned.
- **Visibility into quality and training gaps.** *"No trend analysis or reporting on appeals — missing opportunity to identify quality issues or training needs upstream."* Currently impossible while appeals live in individual inboxes.
- **Even workload distribution**, instead of the current manual redistribution when one Charging Manager or DCP is overloaded in a given week.
- **A hard risk floor for custody-clock cases** — a missed urgent appeal is a liberty-of-the-subject failure, not a missed KPI.
- **Reduce the recurring cost of CMS integration gaps** at national scale, not just per-instance.

### Where user and business needs conflict

The clearest tension in the research: the business wants clean, trustworthy performance data, but the mechanism that would produce it — requiring a fresh charging decision every time an NFA'd case is reactivated — burdens the user with paperwork for cases where nothing substantively changed. That's a genuine trade-off CPS needs to decide on deliberately. It is **not resolved** by anything in this prototype (see [Open questions](#9-open-questions-and-whats-next)).

## 4. Research summary

Semi-structured interviews with 9 participants: 4 Charging Managers (including CPSD) and 5 DCPs. Full source data and synthesis are kept alongside this document (see [Sources](#8-sources)).

Headline risks the research raised, in the participants' own terms:

1. **Task completion logic** doesn't fit appeals that are rejected outright rather than substantively reviewed.
2. **Behavioural shift / habit formation** — staff who've worked email-only for years, in some cases many years, aren't in the habit of checking a task list. Reinforcement, not just a new screen, will be needed.
3. **Performance data tension** — see above.
4. **Role-based controls** are undefined — who can reject an appeal, and once lodged, can one be refused at all.
5. **Adoption value is context-dependent** — high-volume, contentious areas (like CPSD) stand to benefit far more than specialised units with already-proactive police communication.

A separate finding, specific to urgent/custody-clock appeals (not CPSD-specific — see the [persona caveat](#8-sources)): these appeals are rare but self-contained and always get a full re-examination, so triage-and-reject behaviour doesn't apply to them the way it does to routine appeals.

Usability testing of the existing click-through prototype (separate from the interviews above) found:

- 8 of 9 participants clicked through the URN rather than using the inline "show" dropdown to see appeal detail — and the two routes didn't show the same level of detail.
- The assign-to-individual/assign-to-team journey screens tested well, with no issues raised by any participant.
- CPSD doesn't currently formally assign tasks at all; they drop the appeal into a central Teams channel for a DCP to pick up.

## 5. Design decisions

Each entry: what we proposed, why, what we considered instead, and what changed as a result.

### 5.1 Case overview: summary card → accordion

**Proposed:** replace the "Review PCD Appeal" summary card on the case overview page with a GOV.UK accordion, with three sections — Review PCD Appeal, Previous charging details, Previous review details — matching the full depth of content already shown on the standalone decision page.

**Why this, not something else:** this is a direct response to the URN-vs-dropdown finding above. Rather than trimming the inline task-list dropdown to match the card, we brought the case-overview side up to the same depth as the standalone decision page, so both routes into an appeal now show equivalent information. An accordion fit the GOV.UK Design System's own stated use case — long, groupable content a user may want to scan rather than read in full.

**Alternative considered and rejected:** nesting the accordion inside the existing `govuk-summary-card` wrapper, so the visual card shell stayed. Rejected — an accordion is its own component with its own header/border conventions; nesting it inside another card's chrome would have doubled up visual framing for no benefit. The accordion now occupies the card's old position directly.

**What we learned building it:** the case overview's three-column layout (`contacts-box` / `tasks-box` / `monitoring-box`) relied on a CSS Grid row-span trick to make two unrelated columns line up, on the assumption that the `contacts-box` column would always be roughly as tall as the other two combined. Opening an accordion section breaks that assumption — the box grows, and the row-span coupling visibly shifted the unrelated `monitoring-box` underneath it. Fixed by making the two columns genuinely independent (a wrapping flex column for the right-hand boxes) rather than sharing grid tracks. Worth noting as a general lesson: components that change height at runtime (accordions, "show more" toggles) will surface layout assumptions that a static mock-up never would.

**Follow-on iteration:** added an `<h3>` heading ("PCD appeal") above the accordion for accessibility, since the accordion's own section headings (GOV.UK default: `h2`) had nothing to nest under — fixed by giving the accordion `headingLevel: 4`. Then, based on the same "appeals can go under the radar" research theme, moved the Priority tag out of the (collapsed, invisible-until-opened) first accordion section and placed it next to that heading instead, and surfaced the statutory time limit as its own line beneath it — both now visible without expanding anything.

### 5.2 Case overview Tasks card: closing a self-identified gap

**Proposed:** add a working "Start task" link to assigned real PCD tasks on the case overview's Tasks summary card, and remove the (illogical) "Start task" link that was showing on already-`Done` placeholder tasks.

**Why:** the team had already flagged this as a gap during design review ("add start task"). The route already existed and was already used for the same purpose elsewhere (the main task list's expand panel), so this was a case of finishing wiring that already had a destination, not inventing new behaviour.

**What changed as a result:** no design change — this was a direct fix once traced through the code. Worth recording anyway, per the general design history guidance to include the small fixes, not just the headline decisions.

### 5.3 Bridging the gap to the real appeals review journey

**Context:** the full "appeals case review" journey (reviewing the charging decision itself) is owned by a different team and isn't built in this prototype yet. Today, the only connection to it from our journey was a single paragraph link reading "Go to Case review and review the decision" — easy to miss, and silent about why you'd want to.

**Proposed:** two things, together. First, replace the plain link with a single clear message: the case has been reactivated, and the task can only be completed by carrying out an appeals case review. Second, turn "Go to Case review" into a proper button, labelled "Continue to review case", moved to the bottom of the page after all the supporting detail rather than sitting above it.

**Alternatives considered — and kept, not rejected:** rather than picking one component for the message, we built both as swappable partials:

- a GOV.UK notification banner, placed at the top of the page (the Design System's own convention for where notification banners belong), or
- GOV.UK inset text, placed immediately before the button at the bottom instead — deliberately breaking from that convention, so the message sits next to the action it explains.

Only one is included live at a time; the other is commented out in the same file, so either can be reviewed without rebuilding it. This matches a pattern already used elsewhere in this prototype for presenting two live alternatives side by side rather than deleting exploratory work.

**Status:** neither has been user-tested yet — see [Open questions](#9-open-questions-and-whats-next).

### 5.4 Reassign flow: adding "to me"

**Proposed:** a third option on the reassign screen — "To me" — alongside "To someone else" (renamed from "To an individual") and "To a team".

**First iteration, then revised:** "To me" originally routed into the same individual-search screen as "To someone else", on the reasoning that it was the cheapest way to plug in a third option without new screens. On reflection, this was wrong: the system already knows who the signed-in user is, so making them search for their own name added a pointless step. Revised to skip search entirely — selecting "To me" populates the reassignment directly from the current session user and goes straight to the check-your-answers page.

**A related fix, found while making this change:** the "Change" link on the check page previously routed back into whichever specific sub-screen the original choice had used (individual search, or team search), decided purely by which field was filled in. This had a pre-existing gap even before "To me" existed — someone who'd chosen "to a team" but wanted to switch to an individual had no way back to that choice without abandoning the flow. Adding "To me" made it worse, since "me" has no search screen of its own to return to. Fixed by routing "Change" back to the type-selection screen itself in all cases, and pre-selecting whichever option was chosen previously, so "Change" now reads as "reconsider this choice" rather than "start over."

### 5.5 Content and terminology accuracy

Separately from the research above, a reference mock-up of a later design iteration (owned by another team) surfaced two places where this prototype's placeholder terminology didn't match real CMS vocabulary:

- "Unassigned" → **"MCgen"**, the real CMS literal value shown for an unassigned task's owner.
- "Escalated" → **"To do"**, the equivalent real-world label for that severity bucket.

Both were traced to a single shared source function each (`formatOwnerInitials`, `mapSeverityToBucket`) and fixed there, so the change applied consistently everywhere those values appear.

## 6. Checking the design against the to-be process

In October 2026 we received a rough draft of the to-be process as two swimlane diagrams: **PCD Appeals – Area** (OD and DCP lanes, red and non-red cases) and **PCD Appeals CPSD – Red Case Only** (Charging Manager and DCP lanes). It's a draft, not a final process, but it's the first time we could check the prototype against the intended operating model rather than against research alone.

### 6.1 The process, in brief

**Intake (OD / Charging Manager):** email received from police → review email → add email to case in CMS → create comm task. Then:

- **Area:** red case? Yes → assign to Duty DCP. No → review DCP capacity and assign.
- **CPSD:** update the shift lead Teams channel with the appeal info.

**Review (DCP):** CPSD only: pick up case and confirm in the Teams channel. Then, for both: email inspector → review evidence, material, appeal and PCD → call with inspector if needed → **appeal upheld?**

- **Upheld:** reactivate case in CMS → complete PCD review → complete charging actions → allocate to lawyer.
- **Not upheld, and not a refusal to ratify or emergency charge:** complete ad hoc review → send outcome email to police via CMS.
- **Refusal to ratify or emergency charge:** a separate sub-process, not yet defined.

All paths then: provide feedback to PCD lawyer → update appeal log.

(The diagrams label the decision "Upload Police Appeal?". We're reading this as "upheld", which fits both outgoing branches; to be confirmed.)

### 6.2 Where the process supports the design

- **The two flows only differ at intake.** From "Email Inspector" onwards the DCP lane is identical for Area and CPSD. That supports one appeal task with different routing at the front, and tempers the claim in section 2 that the three groups are "genuinely different operating patterns": in this process, the difference is in who triages and assigns, not in the review.
- **Assignment maps onto the reassign flow (5.4).** Assign to Duty DCP is "To a team" (the prototype already seeds a duty DCP team). Review DCP capacity and assign is "To someone else". CPSD's "pick up case and confirm in Teams" is "To me", which gives process evidence for a shortcut that open question 8 notes came from us, not the research.
- **"Review evidence, material, appeal and PCD" is what the accordion (5.1) supports:** previous charging details, previous review details and the appeal itself.
- **The upheld path is the journey 5.3 bridges into.**

### 6.3 Where the process and the design disagree

**When the case is reactivated.** In the prototype, the intent is that the case is reactivated when the DCP clicks "Start task", and the 5.3 message ("This case has been reactivated") reflects that. (There's no reactivation logic in the prototype itself; it's carried by the message only.) In the process, reactivation happens later, and only on the upheld path. Reactivating on start means:

1. **Every appeal reactivates the case, including ones that aren't upheld.** That brings back the performance-data tension in section 3. In the process, appeals that aren't upheld go to an ad hoc review without reactivation, which looks like how the process avoids requiring a fresh charging decision when nothing has changed.
2. **The 5.3 message is incomplete.** "This task can only be completed by carrying out an appeals case review" doesn't fit the not-upheld path, which ends in an ad hoc review and an outcome email. This is the same problem as research risk 1 (task completion logic doesn't fit appeals that are rejected rather than reviewed).

There may be a good reason to reactivate on start, for example if the case must be active in CMS for the DCP to see the evidence and material they need to decide. If so, it should be recorded here as a deliberate break from the process. If reactivating on start is confirmed, the message could cover both outcomes, for example: "This case has been reactivated. Complete an appeals case review if the appeal is upheld, or an ad hoc review if it is not." No change has been made yet.

**No reject-at-intake step.** Neither diagram has a decision coming out of "Review email". Either intake rejection (out of time, no real content) happens inside that box, or rejecting an appeal belongs to the DCP. This bears directly on open questions 1 and 2.

### 6.4 What the process doesn't show

- **Time.** No 14-day statutory deadline, reminders, or escalation if an appeal isn't picked up. CPSD's Teams pickup step carries the same "unactioned appeal" risk the research found.
- **Who decides a case is red.** "Red case?" is a judgement by the OD or Charging Manager. We need to know whether the prototype's Priority tag records that decision or should come from data such as custody status.
- **The refusal to ratify / emergency charge sub-process**, which needs defining before that path can be designed.

### 6.5 The offline steps, and how they could be filled

Most of the process still happens outside CMS. Possible future directions, not yet designed:

| Offline step now | Possible future |
|---|---|
| Email from police → review → add to CMS → create comm task (four manual steps) | Structured police submission, or email matched to the case by URN, creating the task automatically. Removes the "plumbing" in user need 3. |
| CPSD Teams channel post and pickup | A duty team queue in the task list, claimed with "To me" in a way everyone can see. Also closes the gap where nobody picks it up, which a Teams channel can't. |
| Review DCP capacity | Open-task counts per DCP shown at the point of assigning (business need: even workload). |
| Email or call the inspector | Police contacts on the task, including the secondary contact in open question 4, plus a quick note of the call outcome. |
| Provide feedback to PCD lawyer | Structured feedback captured when the task is completed and sent to the original lawyer. |
| Update appeal log | Built from task data (dates, outcome, route taken) instead of kept by hand. This is the trend and quality reporting in open question 5. |

## 7. What cannot easily be seen

Per the Design History guidance, states that don't show up in a single screenshot:

- **The bridging message has two live variants** (notification banner vs inset text — see [5.3](#53-bridging-the-gap-to-the-real-appeals-review-journey)). Only one renders at a time; which one is live is a one-line change in `decision.html`.
- **The reassign flow has three distinct paths that converge on one screen.** "To me" skips search entirely and reads from the session user; "to someone else" and "to a team" both go through a search-and-select step. All three arrive at the same check-your-answers page with the same shape of data, so the commit step behaves identically regardless of path.
- **Not every task row is backed by the same data.** Most PCD-appeal task rows are real database records; a handful of older demo rows in the main task list are still static placeholder JSON with no real case behind them. They look identical in the UI, but behave differently under the hood (e.g. what "Start task" and "Reassign" actually write to).
- **"Previous review details" is illustrative, not live.** The content shown there is plausible example text extrapolated from published CPS guidance, not a real data source — flagged in the template itself, but not obvious from the rendered page alone.

## 8. Sources

- User research: 9 participants (P1, P3, P4, P6 — Charging Managers, including one CPSD-specific (P4); P2, P5, P7, P8, P9 — DCPs, including one RASSO-specific (P8)). Structured notes and raw quotes held alongside the research data export.
- Usability testing of the earlier click-through prototype: findings summarised in section 4 above.
- User research report: "PCD Appeals DCF – User research insights" (slide deck, completed October 2026). Source for the next steps in section 10; slide numbers are given where a step comes from a specific slide.
- To-be process: draft swimlane diagrams "PCD Appeals – Area" and "PCD Appeals CPSD – Red Case Only", received October 2026. Compared against the prototype in section 6.
- Reference mock-up: a later-iteration design of the forward "appeals case review" flow, owned by a separate team — used to check terminology and get a general sense of the shape of the journey this prototype currently stops short of, not as a source of UX findings.
- A fuller synthesis of the research against tangible next steps (this document's section 2–4 content, plus a longer prioritised list) exists as a separate working document; ask the author for the current copy if it isn't linked here yet.

**A caveat worth repeating:** no participant in the research is tagged as specifically working urgent/custody-clock appeals *and* CPSD. The "urgent appeals behave differently" finding (section 4) and the "CPSD is high-volume with inconsistent detail" finding come from two different participants. Treat conclusions that combine the two as a reasonable synthesis, not a direct finding, until validated with someone who actually does both.

## 9. Open questions and what's next

In rough priority order, based on how load-bearing each gap is:

1. **No reject-at-intake path exists.** Charging Managers' actual job includes rejecting appeals administratively (out of time, no real content) without a full review — nothing in this prototype supports that yet. This is the single biggest gap between the research and the prototype. Deliberately out of scope for this iteration.
2. **Role-based controls are undefined.** Who can reject or reassign, and whether an appeal can be refused once lodged, is unresolved in the research itself, not just in this prototype.
3. **The reactivation / performance-data tension (section 3) is unresolved** and is a product decision, not a design one. Needs deciding before building anything that depends on it.
4. **No secondary police contact field**, despite a direct participant request for one, doubly evidenced by the custody-clock officer-handoff problem (section 2).
5. **No trend or quality reporting** — raised independently by two participants, not built.
6. **Habit-formation risk (section 4, finding 2) has no mitigation yet.** The bridging message in 5.3 reduces confusion at one specific point, but doesn't address the underlying risk that staff won't form the habit of checking a task list at all.
7. **The two bridging-message variants (5.3) haven't been tested with real users.** Pick a direction once they have been, rather than leaving both live indefinitely.
8. **The "To me" reassign shortcut (5.4) was our own extension, not a direct research finding.** Worth validating that it's actually used, and that skipping search for a self-assignment doesn't surprise anyone.
9. **When should the case be reactivated?** The prototype intends reactivation on "Start task"; the to-be process reactivates only once an appeal is upheld (6.3). Confirm with the process owner whether reactivating on start is intended, or a CMS constraint (e.g. needing an active case to view material). If an appeal isn't upheld, does the case get deactivated again, and does that affect performance data?
10. **The 5.3 message doesn't cover the not-upheld path.** Once question 9 is answered, update the message so it covers both the appeals case review and the ad hoc review outcomes.
11. **To confirm on the to-be process (6.1, 6.4):** that "Upload Police Appeal?" means "upheld"; whether appeals can be rejected at intake, and by whom; who decides a case is red; what the refusal to ratify / emergency charge sub-process involves; and what form the appeal log takes and who uses it.

## 10. Next steps

The user research report (October 2026) concluded that the prototype journey "tested well overall", with further work needed on how tasks are introduced and on awareness of case reactivation. These next steps come from that report. Where a step overlaps with an open question in section 9, we say so rather than repeat it.

### 10.1 Changes we can make to the prototype now

Each of these is small, directly evidenced, and doesn't depend on an unresolved decision.

1. **Make the way into an appeal obvious from the task list.** Participants tried checkboxes and URNs before finding the right control, and asked whether "Show" should say "action" instead (P6, slide 14). The "Show" toggle is still in `task-list-table.njk` and `priority-charging-table.njk`. Try an action label such as "Review appeal", and make actions look different from information.
2. **Show when the original decision was sent.** Charging Managers check an appeal is in time before assigning it: *"On this page I'd like to see when the decision was sent so I can check its in time."* (P1, slide 15). Show it next to the statutory time limit added in 5.1.
3. **Put the officer's contact details on the appeal overview.** *"If it was a really urgent appeal, I'd ring them."* (P4, slide 15). This is the first part of open question 4; the secondary contact can follow.
4. **Keep appeal reasoning free-form, but keep its paragraph breaks.** Participants didn't want a structured form (*"anything more prescriptive might prevent the police from telling us the real reasons"*, P8), but found long unbroken text hard to read (P7, slides 15 and 17). Check that line breaks in the police submission survive into the page.
5. **Change "Specified charges" to "Proposed charges".** For a refusal to charge, nothing has been charged (P6, slide 17). The label appears in `pcd-appeal-accordion.njk`, `start-appeal-banner.njk`, `start-appeal-inset-text.njk` and `history-panel.njk`. Check whether "Specified charges" is still right in the history panel, which also shows cases that were charged.
6. **Link to statements and exhibits from the appeal page.** DCPs want the police objections, the original lawyer's review and the evidence in front of them together (P7, slides 17 and 18).

### 10.2 Things to test

7. **Test the "Continue to review case" button (5.3).** Two participants couldn't find the old link into case review (P2, P6, slide 17), which is what 5.3 responds to. We haven't checked that the button fixes it. Test it alongside open question 7 (banner or inset text).
8. **Test the reactivation message with DCPs.** The research found DCPs risk treating the appeal as a standalone task without realising a new charging decision must be logged (slide 18). That supports the message in 5.3, but its wording depends on open questions 9 and 10.

### 10.3 Records to update in this document

9. **"To me" is now backed by research.** Open question 8 says the shortcut was our own extension. The report found CPSD DCPs need to "assign to myself" from a shared pool rather than wait to be assigned (slide 16). Update 5.4 and open question 8 to say so. What's left to check is whether everyone else can see who has picked an appeal up, which a Teams channel does today.
10. **Check assignment wording for CPSD.** "Assign to a DCP" assumes someone assigns appeals to individuals, which isn't how CPSD works (slide 14). The reassign options in 5.4 already cover a team pool; check that other labels on the way in don't assume one model.

### 10.4 Decisions needed before we can design

11. **Rejecting an appeal at intake.** Participants asked for a way to reject an appeal straight away if it's out of time or comes from someone below inspector level (P6, slides 17 and 19). They also asked how to request more information without reactivating the case. This is open questions 1 and 2: who can reject, on what grounds, and does a rejection still need a formal response to police?
12. **Which response timeframe we design to.** The report refers to a 14-day window for police to appeal (slide 2) and to "10-day response timeframes" for CPS (slide 19). Confirm both before showing deadlines on the task.
13. **Routing outside office hours.** Appeals arriving after 5pm or late on a Friday lead to disputes over whether the area or CPSD should handle them (P4, P5, slide 13). Agree routing and escalation rules so a red appeal can't sit unassigned overnight.

### 10.5 Beyond this prototype

These came up in the research but need work outside this prototype, or outside this team.

14. **Notifications and mobile access for DCPs.** DCPs move between custody suites and courts: *"I'm not necessarily always stuck at my computer."* (P5, slides 10 and 12). Notifications are the most direct answer to the habit-forming risk in open question 6. At CPSD's volume of 15 to 20 appeals a week (slide 13), they'll need to avoid notification fatigue.
15. **Messages back to police.** Charging teams currently email acknowledgements by hand (P1, slide 19). Acknowledgement and outcome messages could be sent from the task, which also replaces the "Send outcome email via CMS" step in 6.5.
16. **A system-generated appeals log.** Each area keeps its own spreadsheet (slides 6 and 19). A log built from task data (received, assigned, completed, outcome) would replace it and give the reporting in open question 5. The report treats this as out of scope for the current journey.
17. **Police submitting appeals directly.** In the future (DCF) journey, police will submit appeals from their own system rather than by email (slide 7). That removes the four manual intake steps in 6.5, and is the point at which inspector-level authorisation and in-time checks could happen automatically.
