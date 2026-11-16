import { idpOrigin } from './helpers';

it('visits the IdP sign-in page directly', () => {
  cy.visit(`${idpOrigin()}/Account/Login?ReturnUrl=%2Fconnect%2Fauthorize`);
  cy.get('#Username').should('be.visible');
});
