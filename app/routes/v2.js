// app/routes/v2.js

module.exports = router => {
  router.get('/v2', (req, res) => {
    return res.render('v2/index')
  })
}