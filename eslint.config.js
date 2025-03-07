'use strict';

module.exports = require('eslint-config-sukka').sukka({
  js: {
    disableNoConsoleInCLI: ['Build/**'],
    env: {
      customGlobals: {
        'Bun': 'readonly'
      }
    }
  },
  node: true,
  ts: true
}, {
  rules: {
    'sukka/unicorn/prefer-math-trunc': 'off',
    'sukka/unicorn/prefer-number-properties': ['warn', { checkInfinity: false }],
    'n/no-missing-require': 'off'
  }
});
