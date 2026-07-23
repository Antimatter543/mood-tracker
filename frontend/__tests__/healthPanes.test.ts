/**
 * Exhaustive tests for the pure pane-selection helper that decides which
 * Health Connect metric↔mood panes the swipeable Insights card shows.
 *
 * The whole 2^4 flag space is small, so we enumerate it: every combination must
 * yield exactly the metrics whose flag is true, in the fixed HEALTH_PANE_ORDER,
 * and nothing else.
 */
import {
    availableHealthPanes,
    HEALTH_PANE_ORDER,
    type HealthMetricKey,
    type HealthPaneFlags,
} from '@/components/visualisations/transforms/healthPanes';

const allOff: HealthPaneFlags = {
    hasSleepData: false,
    hasHeartRateData: false,
    hasRestingHrData: false,
    hasHrvData: false,
};

describe('availableHealthPanes', () => {
    it('all flags off → no panes', () => {
        expect(availableHealthPanes(allOff)).toEqual([]);
    });

    it('all flags on → every pane in canonical order', () => {
        expect(
            availableHealthPanes({
                hasSleepData: true,
                hasHeartRateData: true,
                hasRestingHrData: true,
                hasHrvData: true,
            })
        ).toEqual(['sleep', 'heartRate', 'restingHr', 'hrv']);
    });

    it.each<[keyof HealthPaneFlags, HealthMetricKey]>([
        ['hasSleepData', 'sleep'],
        ['hasHeartRateData', 'heartRate'],
        ['hasRestingHrData', 'restingHr'],
        ['hasHrvData', 'hrv'],
    ])('only %s → [%s]', (flag, key) => {
        expect(availableHealthPanes({ ...allOff, [flag]: true })).toEqual([key]);
    });

    it('a subset returns only those metrics, still in canonical order', () => {
        // Sleep + HRV (skipping the two heart-rate metrics in the middle).
        expect(
            availableHealthPanes({ ...allOff, hasSleepData: true, hasHrvData: true })
        ).toEqual(['sleep', 'hrv']);
        // The two heart-rate metrics only.
        expect(
            availableHealthPanes({
                ...allOff,
                hasHeartRateData: true,
                hasRestingHrData: true,
            })
        ).toEqual(['heartRate', 'restingHr']);
    });

    it('ordering follows HEALTH_PANE_ORDER, never flag-set order', () => {
        // Enabling the LAST metric first then an earlier one must still order
        // the earlier one first (the helper reads the canonical order).
        expect(
            availableHealthPanes({ ...allOff, hasHrvData: true, hasHeartRateData: true })
        ).toEqual(['heartRate', 'hrv']);
    });

    it('exhaustive: every 2^4 combination matches its true flags in canonical order', () => {
        const flagKeys: (keyof HealthPaneFlags)[] = [
            'hasSleepData',
            'hasHeartRateData',
            'hasRestingHrData',
            'hasHrvData',
        ];
        const keyForFlag: Record<keyof HealthPaneFlags, HealthMetricKey> = {
            hasSleepData: 'sleep',
            hasHeartRateData: 'heartRate',
            hasRestingHrData: 'restingHr',
            hasHrvData: 'hrv',
        };

        for (let mask = 0; mask < 16; mask++) {
            const flags = { ...allOff } as HealthPaneFlags;
            flagKeys.forEach((k, bit) => {
                flags[k] = Boolean(mask & (1 << bit));
            });
            const expected = HEALTH_PANE_ORDER.filter((key) =>
                flagKeys.some((fk) => keyForFlag[fk] === key && flags[fk])
            );
            expect(availableHealthPanes(flags)).toEqual(expected);
        }
    });
});
