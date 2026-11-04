// Guards the TZ pin in jest.globalSetup.js. If it silently stops working (as the old
// setupFiles-based pin did on UTC runners), every Brisbane-dependent suite fails in a
// confusing way; this fails first, with a clear message.
describe('timezone pin', () => {
  it('runs the suite at UTC+10 (Australia/Brisbane), not UTC', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-600);
    // Brisbane has no DST: the offset is identical in winter.
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-600);
  });
});
