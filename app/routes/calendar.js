'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// calendar.js
// GOV.UK Prototype Kit – route handler for the case calendar view.
//
// Mount in your app/routes.js:
//   const calendarRoutes = require('./routes/calendar')
//   calendarRoutes(router)
// ─────────────────────────────────────────────────────────────────────────────

// Placeholder events array.
// In production, replace this with data fetched from your JSON API / session.
const PLACEHOLDER_EVENTS = [
  { date: '2025-05-01', type: 'note',      count: 2, label: 'Notes' },
  { date: '2025-05-01', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-01', type: 'hearing',   count: 3, label: 'Hearings' },
  { date: '2025-05-02', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-02', type: 'direction', count: 1, label: 'Direction due' },
  { date: '2025-05-03', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-03', type: 'ctl',       count: 2, label: 'CTL expiry' },
  { date: '2025-05-03', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-06', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-07', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-07', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-07', type: 'ctl',       count: 1, label: 'CTL expiry' },
  { date: '2025-05-08', type: 'direction', count: 1, label: 'Direction due' },
  { date: '2025-05-08', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-09', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-09', type: 'direction', count: 1, label: 'Direction due' },
  { date: '2025-05-09', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-09', type: 'ctl',       count: 1, label: 'CTL expiry' },
  { date: '2025-05-09', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-10', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-10', type: 'ctl',       count: 2, label: 'CTL expiry' },
  { date: '2025-05-10', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-13', type: 'direction', count: 2, label: 'Direction due' },
  { date: '2025-05-13', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-13', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-14', type: 'ctl',       count: 1, label: 'CTL expiry' },
  { date: '2025-05-14', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-15', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-15', type: 'hearing',   count: 2, label: 'Hearings' },
  { date: '2025-05-16', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-16', type: 'direction', count: 1, label: 'Direction due' },
  { date: '2025-05-16', type: 'ctl',       count: 1, label: 'CTL expiry' },
  { date: '2025-05-17', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-20', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-20', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-20', type: 'ctl',       count: 3, label: 'CTL expiry' },
  { date: '2025-05-21', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-22', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-22', type: 'direction', count: 1, label: 'Direction due' },
  { date: '2025-05-22', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-23', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-23', type: 'ctl',       count: 1, label: 'CTL expiry' },
  { date: '2025-05-24', type: 'note',      count: 2, label: 'Notes' },
  { date: '2025-05-24', type: 'ctl',       count: 2, label: 'CTL expiry' },
  { date: '2025-05-24', type: 'hearing',   count: 2, label: 'Hearings' },
  { date: '2025-05-27', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-27', type: 'ctl',       count: 1, label: 'CTL expiry' },
  { date: '2025-05-28', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-28', type: 'hearing',   count: 3, label: 'Hearings' },
  { date: '2025-05-29', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-29', type: 'ctl',       count: 2, label: 'CTL expiry' },
  { date: '2025-05-29', type: 'hearing',   count: 1, label: 'Hearing' },
  { date: '2025-05-30', type: 'note',      count: 1, label: 'Note' },
  { date: '2025-05-30', type: 'direction', count: 1, label: 'Direction due' },
  { date: '2025-05-31', type: 'note',      count: 2, label: 'Notes' },
  { date: '2025-05-31', type: 'task',      count: 1, label: 'Task due' },
  { date: '2025-05-31', type: 'hearing',   count: 1, label: 'Hearing' }
]

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zero-pad a number to 2 digits.
 * @param {number} n
 * @returns {string}
 */
function pad (n) {
  return String(n).padStart(2, '0')
}

/**
 * Format a date as YYYY-MM-DD.
 * @param {number} year
 * @param {number} month  1-based
 * @param {number} day
 * @returns {string}
 */
function toDateStr (year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Return the ISO weekday index (0 = Monday … 6 = Sunday) for the
 * first day of the given month.
 * @param {number} year
 * @param {number} month  1-based
 * @returns {number}
 */
function firstWeekdayOfMonth (year, month) {
  const day = new Date(year, month - 1, 1).getDay() // 0=Sun … 6=Sat
  return (day + 6) % 7 // convert to 0=Mon … 6=Sun
}

/**
 * Return the number of days in a month.
 * @param {number} year
 * @param {number} month  1-based
 * @returns {number}
 */
function daysInMonth (year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * Build the 5-column (Mon–Fri) grid structure for the template.
 * Each week is an array of 5 cell objects:
 *   { date: 'YYYY-MM-DD', dayNumber: n, isToday: bool, events: [] }
 *   or null for empty/weekend cells.
 *
 * @param {number} year
 * @param {number} month      1-based
 * @param {string} today      'YYYY-MM-DD'
 * @param {Array}  events     flat events array
 * @returns {Array<Array>}    array of week rows
 */
function buildGrid (year, month, today, events) {
  const totalDays = daysInMonth(year, month)
  const startOffset = firstWeekdayOfMonth(year, month) // 0=Mon … 4=Fri, 5=Sat, 6=Sun

  // Index events by date string for fast lookup
  const eventsByDate = {}
  for (const ev of events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = []
    eventsByDate[ev.date].push(ev)
  }

  const weeks = []
  let week = []
  let dayNumber = 1

  // Fill leading empty cells (Mon–Fri only; skip if startOffset is Sat/Sun)
  const leadingEmpties = Math.min(startOffset, 5)
  for (let i = 0; i < leadingEmpties; i++) {
    week.push({ date: null })
  }

  // If month starts on Sat (5) or Sun (6), the first Mon–Fri row is all empty
  // and we start day 1 in a fresh week aligned to the correct column.
  // The leading empties above handle Mon–Fri columns; Sat/Sun start means
  // startOffset >= 5, so leadingEmpties = 5, which fills the whole first row.

  for (let d = 1; d <= totalDays; d++) {
    const dateStr = toDateStr(year, month, d)
    const jsDay = new Date(year, month - 1, d).getDay() // 0=Sun … 6=Sat
    const weekdayIdx = (jsDay + 6) % 7 // 0=Mon … 6=Sun

    // Skip Saturday (5) and Sunday (6)
    if (weekdayIdx >= 5) continue

    week.push({
      date: dateStr,
      dayNumber: d,
      isToday: dateStr === today,
      events: eventsByDate[dateStr] || []
    })

    // End of work week (Friday = index 4) — close the row
    if (weekdayIdx === 4) {
      weeks.push(week)
      week = []
    }
  }

  // Close any incomplete final week with trailing empty cells
  if (week.length > 0) {
    while (week.length < 5) week.push({ date: null })
    weeks.push(week)
  }

  return weeks
}

/**
 * Build the agenda list for the mobile view — only days that have events,
 * in day-of-month order.
 *
 * @param {number} year
 * @param {number} month   1-based
 * @param {string} today   'YYYY-MM-DD'
 * @param {Array}  events
 * @returns {Array}
 */
function buildAgenda (year, month, today, events) {
  const totalDays = daysInMonth(year, month)
  const eventsByDate = {}

  for (const ev of events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = []
    eventsByDate[ev.date].push(ev)
  }

  const agenda = []
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = toDateStr(year, month, d)
    const dayEvents = eventsByDate[dateStr]
    if (dayEvents && dayEvents.length) {
      agenda.push({
        date: dateStr,
        dayNumber: d,
        isToday: dateStr === today,
        events: dayEvents
      })
    }
  }

  return agenda
}

/**
 * Derive prev/next month+year values for navigation links.
 * @param {number} month  1-based
 * @param {number} year
 * @returns {{ prevMonth, prevYear, nextMonth, nextYear }}
 */
function adjacentMonths (month, year) {
  const prev = month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year }
  const next = month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year }
  return {
    prevMonth: prev.month,
    prevYear: prev.year,
    nextMonth: next.month,
    nextYear: next.year
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

module.exports = function (router) {
  router.get('/calendar', (req, res) => {
    const now = new Date()
    const todayStr = toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())

    // Accept ?month=&year= query params for navigation; default to current month
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1)
    const year = parseInt(req.query.year, 10) || now.getFullYear()

    // In production, fetch events from your API/session here and pass them in
    const events = PLACEHOLDER_EVENTS

    const { prevMonth, prevYear, nextMonth, nextYear } = adjacentMonths(month, year)

    res.render('calendar', {
      calendarMonthName: `${MONTH_NAMES[month - 1]} ${year}`,
      calendarGrid: buildGrid(year, month, todayStr, events),
      calendarAgenda: buildAgenda(year, month, todayStr, events),
      calendarPrevMonth: prevMonth,
      calendarPrevYear: prevYear,
      calendarNextMonth: nextMonth,
      calendarNextYear: nextYear
    })
  })
}
