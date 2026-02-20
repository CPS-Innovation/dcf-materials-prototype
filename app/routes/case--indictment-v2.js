// app/routes/case--indictment-v2.js
// V2 indictment routes.
// Register this in your main routes.js BEFORE case--indictment.js so that
// v2-specific overrides take precedence where needed.
//
// V1 routes (case--indictment.js) continue to work unchanged.

module.exports = router => {
  require('./indictment/v2-root')(router)

  // V2 count overrides — must be required BEFORE case--indictment.js
  // so Express matches these handlers first.
  require('./indictment/v2-counts')(router)
}
