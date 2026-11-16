import { signIn, validateSession } from './helpers';

it('signs in through the cross-origin IdP inside cy.session', () => {
  cy.session(['demo'], signIn, { cacheAcrossSpecs: true, validate: validateSession });
  cy.visit('/');
  cy.get('body[data-ready="1"]').should('exist');
});
