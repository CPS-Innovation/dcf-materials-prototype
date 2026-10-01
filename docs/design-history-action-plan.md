# Design history: Action plan

**Status:** living document — edit as the work continues.
**Last updated:** October 2026.
**Covers:** rebuilding the "Action plan" tray's action cards from an ad hoc, accessibility-poor layout into proper GOV.UK components, and extending it from one section to three.

This document exists so anyone picking up this work later can follow how we got here without having to ask around. It includes the work that's still unresolved, not just what shipped.

**A note on how this differs from the PCD appeals design history:** this was not a research-led piece of work. It started as a technical and accessibility debt fix to an existing component, informed by a design review, a secondhand research note, and one subject-matter-expert consultation — not a dedicated research study. Read it in that spirit.

---

## 1. The problem, in one paragraph

The existing "Action plan" tray rendered each action as a hand-built block: an ad hoc expand/collapse ("Further details") sitting next to a loose button group, built without using a proper GOV.UK component underneath. A design review flagged it directly: *"Frankenstein component and not proper use — poor for accessibility."* Separately, it was built for one action only; there was no established pattern for what should happen once there were many actions, of different kinds, in the same tray.

## 2. Why this mattered

- **Accessibility.** The original layout wasn't built on a real component, so it didn't inherit any of the accessibility behaviour a `govuk-summary-card`/`govuk-summary-list` gets for free (semantic structure, consistent focus and keyboard behaviour). An accessibility specialist reviewed the redesign direction before implementation began and confirmed it was sound.
- **Scale.** A secondhand research note carried into the redesign: *"I heard in research that action plans can be 20+ docs long, this would make this list REALLY long."* This is why actions are laid out as discrete cards rather than one long undifferentiated list — the design needed to hold up at volume, not just for a single example action.
- **Clarity between what an action does and what a row does.** The original design's breakdown labelled buttons inconsistently and did not consider "row level" or "card level" actions. Untangling this was necessary before the component could be rebuilt properly — see [3.2](#32-row-level-vs-card-level-actions).
- **Whether content depends on category.** A subject-matter-expert note, made directly against the early redesign, raised an open question: *"Yes, so there can be multiple cards, that will need the same options/information. I think it depends on whether it is under the police initiated category or the pre/post charge category, as to what is shown as well."* This was treated as a hypothesis to test during implementation, not a settled requirement — see [3.5](#35-does-the-category-change-what-shows-no-only-status-does).

## 3. Design decisions

### 3.1 From ad hoc expand/collapse to a real component

**Proposed:** rebuild each action as a GOV.UK summary card (title, header actions, summary list rows), replacing the hand-built "Further details" disclosure and loose button group.

**Why:** this directly answers the "Frankenstein component" finding — a summary card is a real, accessible, well-understood GOV.UK component, not an assembled one-off.

**Alternative built alongside, not instead:** a second variant was also built using a plain summary list with no card chrome (heading + inline action links, wrapped in a `<section>` for semantic grouping) — matching the "also did an equivalent summary list version" option explored in the original redesign. Both variants are kept as swappable partials (`action-plan-card.njk` / `action-plan-list.njk`), toggled by commenting one include in and the other out in `action-plan-modal.njk`, rather than picking one and deleting the other. This is a pattern used throughout this prototype for live alternatives that haven't been definitively chosen yet.

**Deliberate difference kept between the two variants:** the card variant's header actions (Complete action/Withdraw) are bold and sized to match the rest of its text; the list variant's header actions are left at their default styling. This was a conscious choice, not an oversight — the two variants are allowed to look different where it doesn't affect the underlying content or behaviour.

### 3.2 Row-level vs. card-level actions

The original breakdown labelled some buttons "row level" and others "card level" without a consistent rule. Resolved as:

- **Card-level** (header, applies to the whole action): Complete action, Withdraw — and later, status-dependent equivalents (see [3.5](#35-does-the-category-change-what-shows-no-only-status-does)).
- **Row-level** (tied to one specific piece of information): Change (on "Required by"), Change/Mark as complete (on "Chaser task", depending on whether a date is set), Mark as read (on "Reason for CPS last update").

This mapping came directly from a subject-matter-expert clarification during the redesign: *"The message to be marked as read is in the Reason for last CPS update"* — confirming "Mark as read" belongs to that specific row, not the card as a whole.

### 3.3 "Reason for CPS last update": handling long text

**The problem, stated plainly at design stage:** *"Changed this because reason text can be very long."* The original redesign's answer was a simple disclosure — "Show reason" revealing the full text with "Mark as read" underneath.

**What we built, and why it changed more than once:**

1. First pass matched the design directly: a GOV.UK `govukDetails` component as the row's value, with "Mark as read" inside the disclosed content.
2. Refined through several rounds of spacing and sizing fixes (16px text, kept bold where GOV.UK's own font mixin would otherwise have reset it to regular weight, tightened the gap between the heading and the list).
3. Asked for a truncated teaser ("first 3 words… Show more") rather than a plain "Show more" label with no preview — implemented by keeping the teaser outside the details content and setting the (otherwise block-level) details element to `display: inline`, so the toggle could sit on the same line as the teaser text.
4. Asked for the toggle to read "Show less" once open, and for it to trail the *end* of the full text when expanded, not sit before it. **This is where the native `<details>`/`<summary>` component stopped being able to do what was being asked** — a `<summary>` always renders before its disclosed content, in either state; there's no way to make it trail the text instead. This was flagged explicitly rather than worked around with something fragile.
5. Rebuilt using a real toggle instead: an existing component in this codebase, `App.TextExpander` (originally built for a different "show more" design-reference page, truncating by character count), was extended with a word-count mode and changed to render a real `<button>` with `aria-expanded` instead of a bare link. This gave the exact behaviour asked for — "first 3 words… Show more" collapsed, full text with "Show less" trailing it when expanded — without needing a `<details>` at all.
6. A real bug was caught and fixed while wiring this up: the page this renders on overrides the base layout's script-loading block without calling `super()`, which silently dropped the script defining `App.TextExpander` in the first place. Found by checking the actual script tags in a rendered response, not assumed.
7. Finally, "Mark as read" was moved out of the expandable content and into the row's own action column (matching [3.2](#32-row-level-vs-card-level-actions)'s row-level/card-level split properly), where it inherits 16px sizing for free rather than needing its own override.

**Lesson worth keeping:** a design that specifies an exact interaction (toggle label trailing the content, not preceding it) can look like a simple content component at first glance and turn out to need a real, bespoke interactive control instead. Worth checking what a native component can and can't do before committing to it, rather than discovering the limit midway through styling it.

### 3.4 Adding the Chaser task row

Traced directly to a note on the original redesign: *"Need to add capability to 'Mark Chaser task as complete'."* Implemented as its own row (Chaser task / date / action), with the row action switching between **Change** (if no date is set yet) and **Mark as complete** (once one is) — the same pattern already used for "Required by".

### 3.5 Does the category change what shows? No — only status does.

The subject-matter-expert note in section 2 raised a real question: do Police initiated, Triage and pre-charge, and Post-charge cards need different information or actions because of *what* they are? Three new card types were added to test this directly — Unused and sensitive material, Forensic evidence, and CCTV material, alongside three additional Post-charge cards — each given a different `status` value matching the ones in an existing "status tag states" reference diagram (Draft, Not sent, New, In progress, Completed).

**Finding:** category made no difference. Status did, entirely. Once every card across all three sections was checked against its status, the pattern held with no exceptions:

| Status | Card actions |
|---|---|
| Draft | Edit draft, Delete draft |
| Not sent | Send to police |
| New / In progress | Complete action, Withdraw |
| Completed | Re-open |

This matches what the "final designs" in the original redesign already showed implicitly — the same action (e.g. Re-open) appears against the same status regardless of which card it's on. Implementing it confirmed, rather than discovered, what the design had already settled on; the open question from section 2 can be marked resolved.

**Left as the explicit fallback, not yet tested against real cards:** Withdrawn, Abandoned, Re-opened, and Re-opened-with-ETA all fall back to the same treatment as New/In progress (Complete action, Withdraw), since no card has used those statuses yet. This is a reasonable default, not a confirmed one — see [Open questions](#4-open-questions-and-whats-next).

## 4. Open questions and what's next

1. **This is a structural prototype, not a wired-up one.** Unlike the PCD appeals work, no action here is backed by a real route, data model, or persistence — every action link is a placeholder. Treat everything above as confirmed *presentation* logic, not confirmed *behaviour*.
2. **Withdrawn / Abandoned / Re-opened statuses are untested.** They inherit the New/In progress action set by default, but no real card has exercised that path yet.
3. **The status-driven action logic is duplicated, not shared**, between `action-plan-card.njk` and `action-plan-list.njk` — consistent with this prototype's general pattern of near-duplicate variant files, but worth knowing if the rule ever needs to change, since it needs changing in both places.
4. **The card/list header-style difference (bold vs. not) was a deliberate choice "for now"**, not a final decision — revisit if the two variants are ever meant to converge.
5. **No decision yet on which of the two layout variants (card vs. list) is the one to keep.** Both are live and swappable; nothing in this work picked a winner.

## 5. Sources

- Design review notes and the final redesign mock-up ("AP Blade redesign"), including: the original "Frankenstein component" accessibility finding, an accessibility specialist's sign-off on the redesign direction, a secondhand research note on action-plan length, and a subject-matter-expert note on category-dependent content.
- A "status tag states" reference diagram, used to derive the status values tested in [3.5](#35-does-the-category-change-what-shows-no-only-status-does).
- No dedicated user research was conducted for this piece of work — see the note at the top of this document.
