var app = require('../../server/server')

module.exports = function(Appid) {
  Appid.issue = (id, email, schema, cb) => {
    console.log(id, email, schema)
    console.log(app.models)
    app.models.PendingClaim.create({
      issuerAppId: id,
      schema,
    })
      .then(result => {
        console.log(result)
        cb(null, true)
      })
      .catch(error => {
        cb(error, null)
      })
  }

  Appid.remoteMethod('issue', {
    http: { path: '/:id/issue', verb: 'post' },
    accepts: [
      { arg: 'id', type: 'string', required: true },
      {
        arg: 'email',
        type: 'string',
        required: true,
      },
      {
        arg: 'schema',
        type: 'array',
        required: true,
      },
    ],
    returns: { arg: 'success', type: 'boolean' },
  })
}
