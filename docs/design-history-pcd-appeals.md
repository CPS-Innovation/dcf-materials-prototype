# Design history: PCD police appeals

**Status:** living document — edit as the work continues.
**Last updated:** October 2026.
**Covers:** moving PCD (Post-Charge Decision) appeal handling from an email-only process into a task-based CMS flow — research, prototype decisions, and open questions.

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

The clearest tension in the research: the business wants clean, trustworthy performance data, but the mechanism that would produce it — requiring a fresh charging decision every time an NFA'd case is reactivated — burdens the user with paperwork for cases where nothing substantively changed. That's a genuine trade-off CPS needs to decide on deliberately. It is **not resolved** by anything in this prototype (see [Open questions](#6-open-questions-and-whats-next)).

## 4. Research summary

Semi-structured interviews with 9 participants: 4 Charging Managers (including CPSD) and 5 DCPs. Full source data and synthesis are kept alongside this document (see [Sources](#7-sources)).

Headline risks the research raised, in the participants' own terms:

1. **Task completion logic** doesn't fit appeals that are rejected outright rather than substantively reviewed.
2. **Behavioural shift / habit formation** — staff who've worked email-only for years, in some cases many years, aren't in the habit of checking a task list. Reinforcement, not just a new screen, will be needed.
3. **Performance data tension** — see above.
4. **Role-based controls** are undefined — who can reject an appeal, and once lodged, can one be refused at all.
5. **Adoption value is context-dependent** — high-volume, contentious areas (like CPSD) stand to benefit far more than specialised units with already-proactive police communication.

A separate finding, specific to urgent/custody-clock appeals (not CPSD-specific — see the [persona caveat](#7-sources)): these appeals are rare but self-contained and always get a full re-examination, so triage-and-reject behaviour doesn't apply to them the way it does to routine appeals.

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

**Status:** neither has been user-tested yet — see [Open questions](#6-open-questions-and-whats-next).

### 5.4 Reassign flow: adding "to me"

**Proposed:** a third option on the reassign screen — "To me" — alongside "To someone else" (renamed from "To an individual") and "To a team".

**First iteration, then revised:** "To me" originally routed into the same individual-search screen as "To someone else", on the reasoning that it was the cheapest way to plug in a third option without new screens. On reflection, this was wrong: the system already knows who the signed-in user is, so making them search for their own name added a pointless step. Revised to skip search entirely — selecting "To me" populates the reassignment directly from the current session user and goes straight to the check-your-answers page.

**A related fix, found while making this change:** the "Change" link on the check page previously routed back into whichever specific sub-screen the original choice had used (individual search, or team search), decided purely by which field was filled in. This had a pre-existing gap even before "To me" existed — someone who'd chosen "to a team" but wanted to switch to an individual had no way back to that choice without abandoning the flow. Adding "To me" made it worse, since "me" has no search screen of its own to return to. Fixed by routing "Change" back to the type-selection screen itself in all cases, and pre-selecting whichever option was chosen previously, so "Change" now reads as "reconsider this choice" rather than "start over."

### 5.5 Content and terminology accuracy

Separately from the research above, a reference mock-up of a later design iteration (owned by another team) surfaced two places where this prototype's placeholder terminology didn't match real CMS vocabulary:

- "Unassigned" → **"MCgen"**, the real CMS literal value shown for an unassigned task's owner.
- "Escalated" → **"To do"**, the equivalent real-world label for that severity bucket.

Both were traced to a single shared source function each (`formatOwnerInitials`, `mapSeverityToBucket`) and fixed there, so the change applied consistently everywhere those values appear.

## 6. What cannot easily be seen

Per the Design History guidance, states that don't show up in a single screenshot:

- **The bridging message has two live variants** (notification banner vs inset text — see [5.3](#53-bridging-the-gap-to-the-real-appeals-review-journey)). Only one renders at a time; which one is live is a one-line change in `decision.html`.
- **The reassign flow has three distinct paths that converge on one screen.** "To me" skips search entirely and reads from the session user; "to someone else" and "to a team" both go through a search-and-select step. All three arrive at the same check-your-answers page with the same shape of data, so the commit step behaves identically regardless of path.
- **Not every task row is backed by the same data.** Most PCD-appeal task rows are real database records; a handful of older demo rows in the main task list are still static placeholder JSON with no real case behind them. They look identical in the UI, but behave differently under the hood (e.g. what "Start task" and "Reassign" actually write to).
- **"Previous review details" is illustrative, not live.** The content shown there is plausible example text extrapolated from published CPS guidance, not a real data source — flagged in the template itself, but not obvious from the rendered page alone.

## 7. Sources

- User research: 9 participants (P1, P3, P4, P7 — Charging Managers, including one CPSD-specific; P2, P5, P8, P9 — DCPs). Structured notes and raw quotes held alongside the research data export.
- Usability testing of the earlier click-through prototype: findings summarised in section 4 above.
- Reference mock-up: a later-iteration design of the forward "appeals case review" flow, owned by a separate team — used to check terminology and get a general sense of the shape of the journey this prototype currently stops short of, not as a source of UX findings.
- A fuller synthesis of the research against tangible next steps (this document's section 2–4 content, plus a longer prioritised list) exists as a separate working document; ask the author for the current copy if it isn't linked here yet.

**A caveat worth repeating:** no participant in the research is tagged as specifically working urgent/custody-clock appeals *and* CPSD. The "urgent appeals behave differently" finding (section 4) and the "CPSD is high-volume with inconsistent detail" finding come from two different participants. Treat conclusions that combine the two as a reasonable synthesis, not a direct finding, until validated with someone who actually does both.

## 8. Open questions and what's next

In rough priority order, based on how load-bearing each gap is:

1. **No reject-at-intake path exists.** Charging Managers' actual job includes rejecting appeals administratively (out of time, no real content) without a full review — nothing in this prototype supports that yet. This is the single biggest gap between the research and the prototype. Deliberately out of scope for this iteration.
2. **Role-based controls are undefined.** Who can reject or reassign, and whether an appeal can be refused once lodged, is unresolved in the research itself, not just in this prototype.
3. **The reactivation / performance-data tension (section 3) is unresolved** and is a product decision, not a design one. Needs deciding before building anything that depends on it.
4. **No secondary police contact field**, despite a direct participant request for one, doubly evidenced by the custody-clock officer-handoff problem (section 2).
5. **No trend or quality reporting** — raised independently by two participants, not built.
6. **Habit-formation risk (section 4, finding 2) has no mitigation yet.** The bridging message in 5.3 reduces confusion at one specific point, but doesn't address the underlying risk that staff won't form the habit of checking a task list at all.
7. **The two bridging-message variants (5.3) haven't been tested with real users.** Pick a direction once they have been, rather than leaving both live indefinitely.
8. **The "To me" reassign shortcut (5.4) was our own extension, not a direct research finding.** Worth validating that it's actually used, and that skipping search for a self-assignment doesn't surprise anyone.
