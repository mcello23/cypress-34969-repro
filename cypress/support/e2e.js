function readAccessToken(allStorage) {
  const appStorage = allStorage[Cypress.config('baseUrl').replace(/\/$/, '')] || {};
  const raw = appStorage['oidc.user'];
  if (!raw) {
    throw new Error('access_token missing from session storage');
  }
  return JSON.parse(raw).access_token;
}

function login() {
  cy.session(
    ['demo'],
    () => {
      cy.intercept({ method: 'POST', url: '**/Account/Login*' }).as('preLogin');
      cy.intercept({ method: 'POST', url: '**/Account/SignIn*' }).as('postLogin');
      cy.intercept({ method: 'GET', url: '**/connect/userinfo*' }).as('userInfo');
      cy.visit('/', { retryOnNetworkFailure: true, retryOnStatusCodeFailure: true });
      cy.get('#Username').should('be.visible').type('demo');
      cy.get('form').last().submit();
      cy.wait('@preLogin').its('response.statusCode').should('eq', 200);
      cy.get('#Password').should('be.visible').type('demo', { log: false });
      cy.get('form').last().submit();
      cy.wait('@postLogin').its('response.statusCode').should('eq', 200);
      cy.wait('@userInfo').its('response.statusCode').should('eq', 200);
      cy.get('body[data-ready="1"]').should('exist');
    },
    {
      cacheAcrossSpecs: true,
      validate() {
        cy.getAllSessionStorage({ log: false }).then(allStorage => {
          const token = readAccessToken(allStorage);
          cy.request({ url: '/api/profile', headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false })
            .its('status')
            .should('eq', 200);
        });
      }
    }
  );
}

beforeEach(() => {
  cy.intercept({ method: 'GET', url: '**/chunk-*.js*' }, { log: false });
  login();
});
