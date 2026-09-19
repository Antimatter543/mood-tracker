// useDateFormat.ts
//
// The COMPONENT-side reader of the `date_format` setting. Components call this;
// pure transforms take the pref as a required parameter instead (never a hook)
// so they stay testable without a React tree — see lib/dateFormat.ts.
//
// Usage:
//   const { pref, format } = useDateFormat();
//   <Text>{format(entry.date, 'medium')}</Text>
//   // ...and pass `pref` down into any transform that builds labels.

import { useMemo } from 'react';
import { useSettings } from '@/context/SettingsContext';
import {
    formatDate,
    normalizeDateFormatPref,
    type DateFormatPref,
    type DateStyle,
} from '@/lib/dateFormat';

export type UseDateFormat = {
    /** The active preference, to hand to pure transforms. */
    pref: DateFormatPref;
    /** `formatDate` with the active preference already bound. */
    format: (date: Date | string, style: DateStyle) => string;
};

export function useDateFormat(): UseDateFormat {
    const { settings } = useSettings();
    // Settings are persisted as TEXT, so normalize rather than trust the string.
    const pref = normalizeDateFormatPref(settings.date_format);

    return useMemo(
        () => ({
            pref,
            format: (date: Date | string, style: DateStyle) => formatDate(date, pref, style),
        }),
        [pref]
    );
}
