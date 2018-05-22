module.exports = function(Appid) {
  Appid.issue = (id, email, schema, cb) => {
    console.log(id, email, schema)
    cb(null, true)
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
        type: 'object',
        required: true,
      },
    ],
    returns: { arg: 'success', type: 'boolean' },
  })
}
