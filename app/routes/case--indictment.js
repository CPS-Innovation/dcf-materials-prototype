// app/routes/case--indictment.js
module.exports = router => {
  require('./indictment/root')(router)
  require('./indictment/counts')(router)
  require('./indictment/assign')(router)
  require('./indictment/multiple')(router)
  require('./indictment/counts-edit')(router)
}
