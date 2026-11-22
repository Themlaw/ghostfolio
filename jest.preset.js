const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  transformIgnorePatterns: [
    'node_modules/(?!(envalid|jose|lodash-es|oauth4webapi|openid-client)/)'
  ]
};
