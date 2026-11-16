import { signIn } from './helpers';

it('signs in through the cross-origin IdP without cy.session', () => {
  signIn();
});
