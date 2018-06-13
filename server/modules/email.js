const app = require('../server')
const nodemailer = require('nodemailer')
const qr = require('qr-image')
const fs = require('fs')

const transport = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: app.get('email').user,
    pass: app.get('email').password,
  },
})

const send = options => {
  return new Promise((resolve, reject) => {
    transport.sendMail(options, (error, info) => {
      if (error) return reject(error)
      return resolve(info)
    })
  })
}

const sendCredentialRequestQR = ({ token, to, from, subject, template }) =>
  sendQR({
    token,
    to,
    from,
    subject,
    template,
    uri: `me.uport:me?requestToken=${token}`,
    deepLink: `https://id.uport.me/me?requestToken=${token}&callback_type=post`,
  })

const sendAttestationQR = ({ token, to, from, subject, template }) =>
  sendQR({
    token,
    to,
    from,
    subject,
    template,
    uri: `me.uport:add?attestations=${token}`,
    deepLink: `https://id.uport.me/add?attestations=${token}`,
  })

const sendQR = async ({
  token,
  to,
  from,
  subject,
  template,
  uri,
  deepLink,
}) => {
  const filename = `QR-${token.split('.')[1].substring(0, 10)}_${
    to.split('@')[0]
  }.png`
  const qrData = qr.image(uri, { type: 'png' })
  await new Promise((resolve, reject) => {
    qrData.pipe(fs.createWriteStream(filename)).on('finish', () => {
      return resolve(filename)
    })
  })

  const emailOptions = {
    from,
    to,
    subject,
    html: template(from, `cid:${filename}`, deepLink),
    attachments: [{ filename, path: filename, cid: filename }],
  }
  const mailInfo = await send(emailOptions)

  await new Promise((resolve, reject) => {
    fs.unlink(filename, error => {
      if (error) return reject(error)
      return resolve(true)
    })
  })

  return mailInfo
}

module.exports = {
  sendCredentialRequestQR,
  sendAttestationQR,
}
