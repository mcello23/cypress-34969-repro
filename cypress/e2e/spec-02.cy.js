describe('spec 02', () => {
  for (let i = 1; i <= 3; i++) {
    it(`opens the app ${i}`, () => {
      cy.visit('/');
      cy.get('body[data-ready="1"]').should('exist');
      cy.contains('#status', /Ready|Hello/);
    });
  }
});
