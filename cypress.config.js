const { defineConfig } = require('cypress');

module.exports = defineConfig({
  chromeWebSecurity: false,
  numTestsKeptInMemory: 1,
  experimentalRunAllSpecs: true,
  defaultCommandTimeout: 30000,
  pageLoadTimeout: 60000,
  viewportWidth: 1920,
  viewportHeight: 1080,
  video: false,
  e2e: {
    baseUrl: 'https://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js'
  }
});
