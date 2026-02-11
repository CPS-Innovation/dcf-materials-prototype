// app/routes/case--indictment.js
// Aggregator: mounts indictment route modules
module.exports = router => {
  require('./indictment/root')(router)
  require('./indictment/counts')(router)
  require('./indictment/assign')(router)
}
