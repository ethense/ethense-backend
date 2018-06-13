module.exports = function(Claimtemplate) {
  Claimtemplate.prototype.fillDynamicFields = function (recipient) {
    function getAttributeValue(attribute) {
      switch(attribute.type) {
        case 'string':
          return attribute.value
        case 'dynamic':
          return attribute.value.toLowerCase() === 'email' ? recipient.email : recipient.data[attribute.value]
        case 'object':
          return attribute.children.reduce((value, child) => {
            value[child.name] = getAttributeValue(child)
            return value
          }, {})
        default:
          console.error('invalid attribute type', attribute.type)
          return null
      }
    }

    return {
      [this.name]: this.schema.reduce((claim, attribute) => {
        claim[attribute.name] = getAttributeValue(attribute)
        return claim
      }, {})
    }
  }
};
