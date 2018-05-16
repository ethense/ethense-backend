module.exports = function(User) {
  User.exist = cb => {
    User.find({}, (err, resp) => {
      cb(null, resp.length > 0)
    })
  }

  User.remoteMethod('exist', {
    http: { path: '/exist', verb: 'get' },
    returns: { arg: 'usersExist', type: 'boolean' },
  })
}
