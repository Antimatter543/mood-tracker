/**
 * The `future-clock` CI workflow (.github/workflows/future-clock.yml) runs the whole suite under
 * libfaketime with the wall clock shifted a year (and three years) ahead, so a test that hardcodes
 * "now" fails long before the day it would go off. A shift that never reached the jest WORKERS
 * would pass vacuously, so the workflow also sets FUTURE_CLOCK_NOT_BEFORE (computed from the REAL
 * clock outside faketime: real now + offset - 1 day) and this test fails unless the worker's clock
 * is past it. In a normal run the variable is unset and the test is skipped.
 */
const notBefore = process.env.FUTURE_CLOCK_NOT_BEFORE;

(notBefore ? describe : describe.skip)('future-clock CI leg', () => {
    it('the test worker sees the shifted wall clock', () => {
        const floor = Date.parse(notBefore ?? '');
        expect(Number.isNaN(floor)).toBe(false);
        // Date.now() on purpose: this test exists to read the REAL (shifted) wall clock.
        const workerNow = Date.now();
        if (workerNow < floor) {
            throw new Error(
                `worker clock ${new Date(workerNow).toISOString()} is before ${notBefore}: ` +
                    'libfaketime did not reach the jest worker'
            );
        }
    });
});
