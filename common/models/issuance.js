const kue = require('kue')
const app = require('../../server/server')
const uport = require('uport')
const qr = require('qr-image')
const nodemailer = require('nodemailer')
const fs = require('fs')

const server = app.get('server')

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

const DEFAULT_TEMPLATE = (appName, qr, uri) =>
  `<div>Congratulations! ${appName} would like to issue you a certificate.  Scan the QR code with uPort to receive it.<img src="${qr}"></img><a href="${uri}">For mobile, click to open uPort.</a>  Experiencing issues?  Visit out <a href="https://consensysteam.atlassian.net/servicedesk/customer/portal/1">helpdesk</a></div>`

queue.process('credentialRequestEmail', async (job, done) => {
  const issuance = await app.models.Issuance.findById(job.data.issuanceId)
  const claimTemplate = await app.models.ClaimTemplate.findById(
    issuance.claimId
  )
  const appId = await app.models.AppId.findById(issuance.appId)

  const credentials = new uport.Credentials({
    appName: appId.name,
    address: appId.mnid,
    signer: uport.SimpleSigner(appId.privateKey),
  })

  const transport = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: app.get('email').user,
      pass: app.get('email').password,
    },
  })

  const numRecipients = issuance.recipients.length

  function getAttributeValue(recipient, attribute) {
    let value = null
    switch (attribute.type) {
      case 'string':
        value = attribute.value
        break
      case 'dynamic':
        value =
          attribute.value.toLowerCase() === 'email'
            ? recipient.email
            : recipient.data[attribute.value]
        break
      case 'object':
        value = attribute.children.reduce((acc, a) => {
          acc[a.name] = getAttributeValue(recipient, a)
          return acc
        }, {})
        break
      default:
        console.error('unsupported attribute type', attribute.type)
    }
    return value
  }

  async function next(i) {
    const recipient = issuance.recipients[i]
    let status = 'request failed'
    let filename = null

    try {
      // generate claim from schema and recipient data
      const claimBody = claimTemplate.schema.reduce((acc, a) => {
        acc[a.name] = getAttributeValue(recipient, a)
        return acc
      }, {})
      const claim = { [claimTemplate.name]: claimBody }
      console.log('claim', claim)

      // create a pending claim
      const pendingClaim = await app.models.PendingClaim.create({
        issuerAppId: appId.id,
        claim,
        issuanceId: issuance.id,
        recipientEmail: recipient.email,
      })
      console.log('pendingClaim', pendingClaim)

      // create credential request
      const callbackUrl = `${server.host}:${server.backendPort}${
        server.basePath
      }/api/PendingClaims/${pendingClaim.id}/collect`
      const requestToken = await credentials.createRequest({
        callbackUrl,
        notifications: true,
        exp: Math.floor(Date.now() / 1000) + 31557600, // 1 year
      })
      console.log('requestToken', requestToken)

      // encode request in QR image
      const requestUri = `me.uport:me?requestToken=${requestToken}`
      const deepLink = `https://id.uport.me/me?requestToken=${requestToken}&callback_type=post`
      filename = `QR-${issuance.id}-${i}.png`
      const requestQrData = qr.image(requestUri, { type: 'png' })
      await new Promise((resolve, reject) => {
        requestQrData.pipe(fs.createWriteStream(filename)).on('finish', () => {
          return resolve(filename)
        })
      })

      // send email
      const emailOptions = {
        from: 'Ethense',
        to: recipient.email,
        subject: `${issuance.name} Certificate`,
        html: DEFAULT_TEMPLATE(appId.name, `cid:${filename}`, deepLink),
        attachments: [{ filename, path: `${filename}`, cid: filename }],
      }
      console.log(`sending email to ${recipient.email}`, emailOptions)

      const mailInfo = await new Promise((resolve, reject) => {
        transport.sendMail(emailOptions, (error, info) => {
          if (error) return reject(error)
          return resolve(info)
        })
      })
      console.log('mailInfo', mailInfo)
      status = 'requested'
    } catch (error) {
      console.error(`error sending email to ${recipient.email}`)
    }

    if(filename) {
      await new Promise((resolve, reject) => {
        fs.unlink(filename, error => {
          if(error) return reject(error)
          return resolve(true)
        })
      })
    }

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
