const kue = require('kue')
const app = require('../../server/server')

const redisConf = app.get('redis')
const redisPassword = redisConf.password ? `:${redisConf.password}@` : ''
const redisDb = redisConf.db ? `/${redisConf.db}` : ''
const redisUrl = `redis://${redisConf.user}${redisPassword}${redisConf.host}:${
  redisConf.port
}${redisDb}`
console.log(`Redis URL: ${redisConf.url}`)
console.log(`Redis URL form parts: ${redisUrl}`)
const queue = kue.createQueue({
  redis: {
    url: redisConf.url ? redisConf.url : redisUrl,
  },
})

queue.process('credentialRequestEmail', async (job, done) => {
  const issuance = await app.models.Issuance.findById(job.data.issuanceId)

  const numRecipients = issuance.recipients.length

  async function next(i) {
    const recipient = issuance.recipients[i]
    const status = Math.random() < 0.1 ? 'request failed' : 'requested'
    if (recipient.email) {
      console.log(`sending email to ${recipient.email}`)
      job.log(`sending email to ${recipient.email}`)
      await issuance.updateAttributes({
        recipients: issuance.recipients.map(
          (r, j) =>
            j === i
              ? {
                  ...r,
                  status,
                  lastUpdated: Math.floor(new Date() / 1000),
                }
              : r
        ),
      })
      job.log('email sent')
    } else {
      console.error('recipient missing email', recipient)
    }
    setTimeout(async () => {
      if (i === numRecipients - 1) done()
      else next(i + 1)
    }, 1000)
  }

  next(0)
})

module.exports = function(Issuance) {
  Issuance.batchIssue = async (id, cb) => {
    const issuance = await app.models.Issuance.findById(id)
    if (issuance.batchIssuing) {
      const error = new Error('already executing batch issuance')
      error.status = 409 // Conflict
      throw error
    }
    await issuance.updateAttributes({ batchIssuing: true })

    const job = queue
      .create('credentialRequestEmail', {
        issuanceId: id,
        instance: issuance,
      })
      .removeOnComplete(true)
      .save()

    const handleDone = id => async result => {
      console.log('done', result, id)
      const issuance = await app.models.Issuance.findById(id)
      issuance.updateAttributes({ done: true, batchIssuing: false })
    }
    job.on('complete', handleDone(id)).on('failed', handleDone(id))
    return issuance
  }
  Issuance.remoteMethod('batchIssue', {
    http: { path: '/:id/batchIssue', verb: 'get' },
    accepts: [{ arg: 'id', type: 'string', required: true }],
    returns: { arg: 'root', type: 'object' },
  })
}
