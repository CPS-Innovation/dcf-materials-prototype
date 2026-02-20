// app/routes/v1.js

module.exports = router => {
  router.get('/v1', (req, res) => {
    return res.render('v1/index')
  })
}