export function idpOrigin() {
  const app = new URL(Cypress.config('baseUrl'));
  return `${app.protocol}//127.0.0.1:4000`;
}

export function signIn() {
  cy.intercept({ method: 'GET', url: '**/chunk-*.js*' }, { log: false });
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
}

export function validateSession() {
  cy.getAllSessionStorage({ log: false }).then(allStorage => {
    const appStorage = allStorage[Cypress.config('baseUrl').replace(/\/$/, '')] || {};
    const raw = appStorage['oidc.user'];
    if (!raw) {
      throw new Error('access_token missing from session storage');
    }
    cy.request({ url: '/api/profile', headers: { Authorization: `Bearer ${JSON.parse(raw).access_token}` }, failOnStatusCode: false })
      .its('status')
      .should('eq', 200);
  });
}
