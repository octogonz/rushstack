// This is a workaround for https://github.com/eslint/eslint/issues/3458
require('decoupled-local-node-rig/profiles/default/includes/eslint/patch/modern-module-resolution');
// This is a workaround for https://github.com/microsoft/rushstack/issues/3021
require('decoupled-local-node-rig/profiles/default/includes/eslint/patch/custom-config-package-names');

module.exports = {
  extends: [
    'decoupled-local-node-rig/profiles/default/includes/eslint/profile/node',
    'decoupled-local-node-rig/profiles/default/includes/eslint/mixins/friendly-locals'
  ],
  parserOptions: { tsconfigRootDir: __dirname },

  rules: {
    // api-extractor-model uses namespaces to represent mixins
    '@typescript-eslint/no-namespace': 'off'
  }
};
