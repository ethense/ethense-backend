const app = require('../server')
const uport = require('uport')

const server = app.get('server')
const credentialsMap = {}

const getCredentials = ({ name, mnid, privateKey }) => {
  let credentials = credentialsMap[mnid]

  if (!credentials) {
    credentials = new uport.Credentials({
      appName: name,
      address: mnid,
      signer: uport.SimpleSigner(privateKey),
    })
    credentialsMap[mnid] = credentials
  }

  return credentials
}

// generate a credential request with callback to trigger the collect endpoint
// for a pending claim
const getPendingClaimRequest = (appId, pendingClaim) => {
  const credentials = getCredentials(appId)
  const callbackUrl = `${server.host}:${server.backendPort}${
    server.basePath
  }/api/PendingClaims/${pendingClaim.id}/collect`

  return credentials.createRequest({
    callbackUrl,
    notifications: true,
    exp: Math.floor(Date.now() / 1000) + 31557600, // 1 year
  })
}

const parseCredentialResponse = (appId, accessToken) => {
  const credentials = getCredentials(appId)
  return credentials.receive(accessToken)
}

const getAttestationToken = (appId, sub, claim) => {
  const credentials = getCredentials(appId)
  return credentials.attest({ sub, claim })
}

const pushAttestation = (appId, token, { pushToken, publicEncKey }) => {
  const credentials = getCredentials(appId)
  const uri = `me.uport:add?attestations=${token}`
  return credentials.push(pushToken, publicEncKey, {
    url: uri,
  })
}

module.exports = {
  getPendingClaimRequest,
  parseCredentialResponse,
  getAttestationToken,
  pushAttestation,
}
