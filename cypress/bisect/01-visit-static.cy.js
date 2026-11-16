it('visits a static page on the app origin', () => {
  cy.visit('/static');
  cy.contains('#static', 'static ok');
});
