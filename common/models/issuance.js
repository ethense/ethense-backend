const app = require('../../server/server')

module.exports = function(Issuance) {
  Issuance.batchIssue = async (id, cb) => {
    const issuance = await app.models.Issuance.findById(id)
    if(issuance.batchIssuing) {
      const error = new Error('already executing batch issuance')
      error.status = 409 // Conflict
      throw error
    }
    await issuance.updateAttributes({ batchIssuing: true })
    return issuance
  }
  Issuance.remoteMethod('batchIssue', {
    http: { path: '/:id/batchIssue', verb: 'get' },
    accepts: [{ arg: 'id', type: 'string', required: true }],
    returns: { arg: 'issuance', type: 'object' },
  })
}
