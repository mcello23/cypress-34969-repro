const { defineConfig } = require('cypress');
const base = require('./cypress.config');

module.exports = defineConfig({
  ...base,
  e2e: {
    ...base.e2e,
    specPattern: 'cypress/bisect/**/*.cy.js',
    supportFile: false
  }
});
