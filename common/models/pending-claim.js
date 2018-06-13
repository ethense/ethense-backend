const app = require('../../server/server')
const uportCredentials = require('../../server/modules/uportCredentials')
const email = require('../../server/modules/email')

const DEFAULT_TEMPLATE = (appName, qr, uri) =>
  `<div><p>${appName} has issued you a certificate.
If you did not already receive it via push notification, scan the QR code with uPort to add it to your profile.
You can find uPort for <a href="https://itunes.apple.com/us/app/uport-id/id1123434510?mt=8">iOS</a> or <a href="https://play.google.com/store/apps/details?id=com.uportMobile">Android</a> devices.
</p><img src="${qr}"></img><p><a href="${uri}">For mobile, click to open uPort.</a>
Experiencing issues?  Visit our <a href="https://consensysteam.atlassian.net/servicedesk/customer/portal/1">helpdesk</a></p></div>`

module.exports = function(Pendingclaim) {
  Pendingclaim.collect = async (id, data, cb) => {
    // find the claim and related data models
    const pendingClaim = await app.models.PendingClaim.findById(id)
    const issuance = await app.models.Issuance.findById(pendingClaim.issuanceId)
    const appId = await app.models.AppId.findOne({
      id: pendingClaim.issuerAppId,
    })

    // get recipient mnid from response
    const identity = await uportCredentials.parseCredentialResponse(
      appId,
      data.access_token
    )

    // generate attestation token from recipient and claim data
    const attestationToken = await uportCredentials.getAttestationToken(
      appId,
      identity.address,
      pendingClaim.claim
    )

    // push the attestation
    try {
      await uportCredentials.pushAttestation(appId, attestationToken, identity)
    } catch (error) {
      console.error('Error pushing attestation:', error)
    }

    // email the attestation
    try {
      await email.sendAttestationQR({
        to: pendingClaim.recipientEmail,
        from: appId.name,
        subject: `${issuance.name} Certificate Attestation`,
        template: DEFAULT_TEMPLATE,
        token: attestationToken,
      })
    } catch (error) {
      console.error('Error sending attestation email:', error)
    }

    if (!pendingClaim.testMode) {
      await issuance.updateAttributes({
        recipients: issuance.recipients.map(
          r =>
            r.email === pendingClaim.recipientEmail
              ? {
                  ...r,
                  status: 'collected',
                  lastUpdated: Math.floor(new Date() / 1000),
                  mnid: identity.address,
                  pushToken: identity.pushToken,
                  publicEncKey: identity.publicEncKey,
                  attestationToken,
                }
              : r
        ),
      })
    }
    return true
  }

  Pendingclaim.remoteMethod('collect', {
    http: { path: '/:id/collect', verb: 'post' },
    accepts: [
      { arg: 'id', type: 'string', required: true },
      {
        arg: 'data',
        type: 'object',
        required: true,
        http: { source: 'body' },
      },
    ],
    returns: { arg: 'success', type: 'boolean' },
  })
}
