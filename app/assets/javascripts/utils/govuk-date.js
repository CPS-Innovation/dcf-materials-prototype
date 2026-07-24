// GOV.UK date/time formatting, for use in client-side JS (Nunjucks pages should
// use the govukDate / govukDateTime filters in app/filters.js instead).
(function () {
  function parseDate (value) {
    if (!value) return null
    var d
    if (typeof value === 'string' && value.includes('/')) {
      var pieces = value.split(' ')
      var dateParts = pieces[0].split('/').map(Number)
      var timeParts = (pieces[1] || '').split(':').map(Number)
      d = new Date(
        dateParts[2], dateParts[1] - 1, dateParts[0],
        timeParts[0] || 0, timeParts[1] || 0, timeParts[2] || 0
      )
    } else {
      d = (value instanceof Date) ? value : new Date(value)
    }
    return isNaN(d.getTime()) ? null : d
  }

  function govukDate (value) {
    var d = parseDate(value)
    if (!d) return ''
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(d)
  }

  function govukDateTime (value) {
    var d = parseDate(value)
    if (!d) return ''

    var datePart = govukDate(d)

    var hours = d.getHours()
    var mins = d.getMinutes()
    if (hours === 0 && mins === 0) return datePart

    var timePart = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d)

    return datePart + ' at ' + timePart
  }

  window.DCFDateFormat = {
    govukDate: govukDate,
    govukDateTime: govukDateTime
  }
})()
