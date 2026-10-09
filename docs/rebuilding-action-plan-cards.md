---
title: Rebuilding action plan cards with GOV.UK components
description: We rebuilt the action plan cards using proper GOV.UK components to fix accessibility problems, and found that each card's actions depend on its status, not its category.
---

The action plan lets users see and manage the actions on a case. Each action was shown as a hand-built block. It had a home-made "Further details" expander and a loose group of buttons next to it.

A design review summed it up as a "Frankenstein component" that was poor for accessibility.

This wasn't a research-led piece of work. We started from a design review, a note from research and input from a subject matter expert.

## Why we did this

The old layout had 4 problems:

- it wasn't built on a real component, so it missed the accessibility features GOV.UK components provide, such as semantic structure and consistent keyboard and focus behaviour
- it was designed around a single action, but research suggested action plans can run to more than 20 items
- button labels were inconsistent, and it wasn't clear which buttons applied to the whole action and which applied to a single piece of information
- we didn't know whether different categories of action (police initiated, pre-charge and post-charge) needed different information or actions

An accessibility specialist reviewed the new direction before we built it and confirmed it was sound.

<!-- SCREENSHOT PLACEHOLDER — duplicate as needed -->
![Screenshot described under image](screenshot-name.png)

*Caption: The original action plan card*

Describe the screenshot here. Include the page heading, what each section contains, and what the buttons and links say.
<!-- END PLACEHOLDER -->

## What we changed

### Each action is now a summary card

We rebuilt each action as a [summary card](https://design-system.service.gov.uk/components/summary-list/#summary-cards). The card has a title, actions in its header, and a summary list of details.

We also built a second version using a plain [summary list](https://design-system.service.gov.uk/components/summary-list/), without the card styling. We haven't chosen between them yet, so both versions stay in the prototype.

<!-- SCREENSHOT PLACEHOLDER — duplicate as needed -->
![Screenshot described under image](screenshot-name.png)

*Caption: An action shown as a summary card*

Describe the screenshot here. Include the page heading, what each section contains, and what the buttons and links say.
<!-- END PLACEHOLDER -->

### Clearer rules for card actions and row actions

We separated actions into 2 types.

Card actions apply to the whole action, for example "Complete action" or "Withdraw". They sit in the card header.

Row actions apply to a single piece of information and sit at the end of its row. These are:

- "Change" for the "Required by" date
- "Change" or "Mark as complete" for the chaser task, depending on whether a date has been set
- "Mark as read" for the reason for the last CPS update

The subject matter expert confirmed that the message to mark as read is the reason for the last update. That's why "Mark as read" belongs to that row and not to the whole card.

### Shortening long update messages

The reason for the last CPS update can be very long. We now show only the first few words, followed by a "Show more" button. When the text is opened, the full message is shown with a "Show less" button at the end.

We first tried the [details component](https://design-system.service.gov.uk/components/details/). It couldn't do what the design needed, because its toggle always sits before the content and can't move to the end of the text. Instead, we used a simple button that tells screen readers whether the text is expanded.

The lesson: check what a standard component can and can't do before you commit to it.

<!-- SCREENSHOT PLACEHOLDER — duplicate as needed -->
![Screenshot described under image](screenshot-name.png)

*Caption: The update message shortened and opened*

Describe the screenshot here. Include the page heading, what each section contains, and what the buttons and links say.
<!-- END PLACEHOLDER -->

### Adding a chaser task

The redesign included a note saying users needed to be able to mark a chaser task as complete. We added a "Chaser task" row that works the same way as "Required by":

- if no date is set, the row shows "Change"
- if a date is set, the row shows "Mark as complete"

## What we found

The subject matter expert thought the information shown might depend on the category: police initiated, pre-charge or post-charge.

To test this, we added cards to all 3 sections with a range of statuses. They covered unused and sensitive material, forensic evidence and CCTV.

Category made no difference. The actions on each card depend only on its status:

| Status | Card actions |
| --- | --- |
| Draft | Edit draft, Delete draft |
| Not sent | Send to police |
| New or In progress | Complete action, Withdraw |
| Completed | Re-open |

This confirmed what the final designs already showed: the same status always gets the same actions, whichever card it's on.

<!-- SCREENSHOT PLACEHOLDER — duplicate as needed -->
![Screenshot described under image](screenshot-name.png)

*Caption: Cards with different statuses showing their actions*

Describe the screenshot here. Include the page heading, what each section contains, and what the buttons and links say.
<!-- END PLACEHOLDER -->

## What we have not resolved yet

- **This is a layout prototype.** None of the actions are connected to real data yet, so we've confirmed how the cards look but not how they behave.
- **Some statuses are untested.** Withdrawn, Abandoned and Re-opened currently show the same actions as New and In progress. That's a reasonable default, but we haven't confirmed it.
- **We haven't chosen between the card and list versions.** Both are still available in the prototype.
- **We haven't done user research on this design.** We'd like to test it with users, especially on action plans with a lot of items.
