const kue = require('kue')

const app = require('../../server/server')
const email = require('../../server/modules/email')
const uportCredentials = require('../../server/modules/uportCredentials')

const redisConf = app.get('redis')
const redisPassword = redisConf.password ? `:${redisConf.password}@` : ''
const redisUrl = `redis://${redisPassword}${redisConf.host}:${
  redisConf.port
}`
console.log(`Redis URL form parts: ${redisUrl}`)
const queue = kue.createQueue({
  redis: {
    url: redisUrl,
  },
})

const DEFAULT_TEMPLATE = (appName, qr, uri) =>
  `<div><p>Congratulations! ${appName} would like to issue you a certificate.
Scan the QR code with uPort and share your identity to receive it.
You can find uPort for <a href="https://itunes.apple.com/us/app/uport-id/id1123434510?mt=8">iOS</a> or <a href="https://play.google.com/store/apps/details?id=com.uportMobile">Android</a> devices.
</p><img src="${qr}"></img><p><a href="${uri}">For mobile, click to open uPort.</a>
Experiencing issues?  Visit our <a href="https://consensysteam.atlassian.net/servicedesk/customer/portal/1">helpdesk</a></p></div>`

const DEFAULT_ATTESTATION_TEMPLATE = (appName, qr, uri) =>
  `<div><p>${appName} has issued you a certificate.
If you did not already receive it via push notification, scan the QR code with uPort to add it to your profile.
You can find uPort for <a href="https://itunes.apple.com/us/app/uport-id/id1123434510?mt=8">iOS</a> or <a href="https://play.google.com/store/apps/details?id=com.uportMobile">Android</a> devices.
</p><img src="${qr}"></img><p><a href="${uri}">For mobile, click to open uPort.</a>
Experiencing issues?  Visit our <a href="https://consensysteam.atlassian.net/servicedesk/customer/portal/1">helpdesk</a></p></div>`

queue.process('credentialRequestEmailBatch', async (job, done) => {
  const issuance = await app.models.Issuance.findById(job.data.issuanceId)
  const claimTemplate = await app.models.ClaimTemplate.findById(
    issuance.claimId
  )
  const appId = await app.models.AppId.findById(issuance.appId)
  const numRecipients = issuance.recipients.length

  async function next(i) {
    const recipient = issuance.recipients[i]
    let status = 'request failed'

    try {
      // generate claim from schema and recipient data
      const claim = claimTemplate.fillDynamicFields(recipient)

      // create a pending claim
      const pendingClaim = await app.models.PendingClaim.create({
        claim,
        issuerAppId: appId.id,
        issuanceId: issuance.id,
        recipientEmail: recipient.email,
      })

      // create credential request
      const requestToken = await uportCredentials.getPendingClaimRequest(
        appId,
        pendingClaim
      )

      // email a QR code containing the credential request
      await email.sendCredentialRequestQR({
        to: recipient.email,
        from: appId.name,
        subject: `${issuance.name} Certificate Pickup`,
        template: DEFAULT_TEMPLATE,
        token: requestToken,
      })
      status = 'requested'
    } catch (error) {
      console.error(`error sending email to ${recipient.email}`, error)
    }

    // update the recipient's status
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
    if (i === numRecipients - 1) done()
    else next(i + 1)
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
      .create('credentialRequestEmailBatch', {
        issuanceId: id,
        instance: issuance,
      })
      .removeOnComplete(true)
      .save()

    const handleDone = id => async result => {
      const issuance = await app.models.Issuance.findById(id)
      await issuance.updateAttributes({ done: true, batchIssuing: false })
      console.log('done issuing batch', result, id)
    }
    job.on('complete', handleDone(id)).on('failed', handleDone(id))
    return issuance
  }
  Issuance.remoteMethod('batchIssue', {
    http: { path: '/:id/batchIssue', verb: 'get' },
    accepts: [{ arg: 'id', type: 'string', required: true }],
    returns: { root: true, type: 'object' },
  })

  Issuance.issue = async (id, recipientEmail, cb) => {
    const issuance = await app.models.Issuance.findById(id)

    const claimTemplate = await app.models.ClaimTemplate.findById(
      issuance.claimId
    )
    const appId = await app.models.AppId.findById(issuance.appId)
    const recipient = issuance.recipients.find(i => i.email === recipientEmail)
    if (!recipient) {
      const error = new Error('recipient does not exist')
      error.status = 400 // Bad request
      throw error
    }

    let status = 'request failed'

    try {
      const claim = claimTemplate.fillDynamicFields(recipient)
      const pendingClaim = await app.models.PendingClaim.create({
        claim,
        issuerAppId: appId.id,
        issuanceId: issuance.id,
        recipientEmail,
      })
      const requestToken = await uportCredentials.getPendingClaimRequest(
        appId,
        pendingClaim
      )
      await email.sendCredentialRequestQR({
        to: recipientEmail,
        from: appId.name,
        subject: `${issuance.name} Certificate Pickup`,
        template: DEFAULT_TEMPLATE,
        token: requestToken,
      })
      status = 'requested'
    } catch (error) {
      console.error(`error sending email to ${recipientEmail}`, error)
    }

    await issuance.updateAttributes({
      recipients: issuance.recipients.map(
        r =>
          r.email === recipientEmail
            ? {
                ...r,
                status,
                lastUpdated: Math.floor(new Date() / 1000),
              }
            : r
      ),
    })

    return issuance
  }
  Issuance.remoteMethod('issue', {
    http: { path: '/:id/issue', verb: 'get' },
    accepts: [
      { arg: 'id', type: 'string', required: true },
      { arg: 'email', type: 'string', required: true },
    ],
    returns: { root: true, type: 'object' },
  })

  Issuance.push = async (id, recipientEmail, cb) => {
    const issuance = await app.models.Issuance.findById(id)
    const appId = await app.models.AppId.findById(issuance.appId)
    const recipient = issuance.recipients.find(i => i.email === recipientEmail)
    if (!recipient) {
      const error = new Error('recipient does not exist')
      error.status = 400 // Bad request
      throw error
    }
    return await uportCredentials.pushAttestation(
      appId,
      recipient.attestationToken,
      recipient
    )
  }
  Issuance.remoteMethod('push', {
    http: { path: '/:id/push', verb: 'get' },
    accepts: [
      { arg: 'id', type: 'string', required: true },
      { arg: 'email', type: 'string', required: true },
    ],
    returns: { root: true, type: 'object' },
  })

  Issuance.email = async (id, recipientEmail, cb) => {
    const issuance = await app.models.Issuance.findById(id)
    const appId = await app.models.AppId.findById(issuance.appId)
    const recipient = issuance.recipients.find(i => i.email === recipientEmail)
    if (!recipient) {
      const error = new Error('recipient does not exist')
      error.status = 400 // Bad request
      throw error
    }
    return await email.sendAttestationQR({
      token: recipient.attestationToken,
      to: recipientEmail,
      from: appId.name,
      subject: `${issuance.name} Certificate Attestation`,
      template: DEFAULT_ATTESTATION_TEMPLATE,
    })
  }
  Issuance.remoteMethod('email', {
    http: { path: '/:id/email', verb: 'get' },
    accepts: [
      { arg: 'id', type: 'string', required: true },
      { arg: 'email', type: 'string', required: true },
    ],
    returns: { root: true, type: 'object' },
  })

  Issuance.testIssue = async (id, req, cb) => {
    const issuance = await app.models.Issuance.findById(id)
    const claimTemplate = await app.models.ClaimTemplate.findById(
      issuance.claimId
    )
    const appId = await app.models.AppId.findById(issuance.appId)
    const recipient = {
      email: req.email,
      data: { ...req.testFields },
    }

    try {
      const claim = claimTemplate.fillDynamicFields(recipient)
      const pendingClaim = await app.models.PendingClaim.create({
        claim,
        issuerAppId: appId.id,
        issuanceId: issuance.id,
        recipientEmail: recipient.email,
        testMode: true,
      })
      const requestToken = await uportCredentials.getPendingClaimRequest(
        appId,
        pendingClaim
      )
      await email.sendCredentialRequestQR({
        to: recipient.email,
        from: appId.name,
        subject: `${issuance.name} Certificate Pickup`,
        template: DEFAULT_TEMPLATE,
        token: requestToken,
      })
    } catch (error) {
      console.error(`error sending email to ${recipient.email}`, error)
    }
    return true
  }
  Issuance.remoteMethod('testIssue', {
    http: { path: '/:id/testIssue', verb: 'post' },
    accepts: [
      { arg: 'id', type: 'string', required: true },
      {
        arg: 'req',
        type: 'object',
        required: true,
        http: { source: 'body' },
      },
    ],
    returns: { arg: 'success', type: 'boolean' },
  })
}
