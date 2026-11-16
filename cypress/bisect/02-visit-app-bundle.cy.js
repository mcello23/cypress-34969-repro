it('visits the app with its 8 MB bundle and chunks, no login', () => {
  cy.intercept({ method: 'GET', url: '**/chunk-*.js*' }, { log: false });
  cy.visit('/?noauth=1');
  cy.get('body[data-ready="1"]').should('exist');
});
