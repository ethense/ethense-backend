const app = require('../../server/server')
const server = app.get('server')

const crypto = require('crypto')
const uport = require('uport')
const qr = require('qr-image')
const nodemailer = require('nodemailer')
const fs = require('fs')

const DEFAULT_TEMPLATE = (appName, qr, uri) =>
  `<div>Congratulations! ${appName} would like to issue you a certificate.  Scan the QR code with uPort to receive it.<img src="${qr}"></img><a href="${uri}">For mobile, click to open uPort</a></div>`

module.exports = function(Appid) {
  Appid.issue = async (id, email, schema, cb) => {
    try {
      // create the pending claim
      const pendingClaim = await app.models.PendingClaim.create({
        issuerAppId: id,
        schema,
      })
      console.log('appid', id)
      console.log('pendingId', pendingClaim.id)
      // use the id to create a callback URL
      const callbackUrl = `${server.host}:${server.backendPort}${
        server.basePath
      }/api/PendingClaims/${pendingClaim.id}/collect`
      // console.log(callbackUrl)
      // create a uport credential request with the callback
      const appId = await app.models.AppId.findById(id)
      // console.log(appId.name)
      const credentials = new uport.Credentials({
        appName: appId.name,
        address: appId.mnid,
        signer: uport.SimpleSigner(appId.privateKey),
      })
      // console.log(credentials)
      const requestToken = await credentials.createRequest({
        callbackUrl,
        notifications: true,
        // expire in 1 year
        exp: Math.floor(Date.now() / 1000) + 31557600,
      })
      console.log(requestToken)
      const requestUri = `me.uport:me?requestToken=${requestToken}`
      const deepLink = `https://id.uport.me/me?requestToken=${requestToken}&callback_type=post`
      // create image
      const filename = `QR-${crypto.randomBytes(8).toString('hex')}.png`
      const requestQrData = qr.image(requestUri, { type: 'png' })
      await new Promise((resolve, reject) => {
        requestQrData.pipe(fs.createWriteStream(filename)).on('finish', () => {
          return resolve(filename)
        })
      })
      // send email
      const transport = nodemailer.createTransport({
        service: 'Gmail',
        auth: { user: app.get('email').user, pass: app.get('email').password },
      })
      const emailOptions = {
        from: 'Ethense',
        to: email,
        subject: `${appId.name} Certificate`,
        html: DEFAULT_TEMPLATE(appId.name, `cid:${filename}`, deepLink),
        attachments: [{ filename, path: `${filename}`, cid: filename }],
      }
      const mailInfo = await new Promise((resolve, reject) => {
        transport.sendMail(emailOptions, (error, info) => {
          if (error) return reject(error)
          return resolve(info)
        })
      })
      console.log(mailInfo)
      // delete image
      await new Promise((resolve, reject) => {
        fs.unlink(filename, error => {
          if (error) return reject(error)
          return resolve(true)
        })
      })
      cb(null, true)
    } catch (error) {
      cb(error, null)
    }
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
