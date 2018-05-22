const app = require('../../server/server')

const uport = require('uport')

const getValues = parent => attr => {
  switch (attr.type) {
    case 'string':
      parent[attr.name] = attr.value
      return
    case 'object':
      parent[attr.name] = {}
      attr.children.forEach(getValues(parent[attr.name]))
      return
    default:
      console.error('bad type', attr)
      return
  }
}

module.exports = function(Pendingclaim) {
  Pendingclaim.collect = async (id, data, cb) => {
    try {
      // find the claim
      console.log(id)
      const pendingClaim = await app.models.PendingClaim.findById(id)
      console.log(pendingClaim.id)
      // get the appId from the claim
      const appId = await app.models.AppId.findOne({
        id: pendingClaim.issuerAppId,
      })
      // set up uport
      const credentials = new uport.Credentials({
        appName: appId.name,
        address: appId.mnid,
        signer: uport.SimpleSigner(appId.privateKey),
      })
      console.log(credentials)
      // get their mnid from response
      console.log(data)
      const identity = await credentials.receive(data.access_token)
      console.log(identity)
      // get the claim data from schema
      const claim = {
        title: {},
      }
      pendingClaim.schema.forEach(getValues(claim.title))
      console.log(claim)
      const attestation = await credentials.attest({
        sub: identity.address,
        claim,
      })
      const attestationUri = `me.uport:add?attestations=${attestation}`
      await credentials.push(identity.pushToken, identity.publicEncKey, {
        url: attestationUri,
      })
      cb(null, true)
    } catch (error) {
      cb(error, null)
    }
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
