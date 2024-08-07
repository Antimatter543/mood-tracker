// queries.ts

// Gets every mood for the past week, averaged for each day (same format as month averages). Any days with no entries are given avgMood NULL!!!!
// [{"avgMood": 7.5, "date": "2025-01-15"}, {"avgMood": 4.8, "date": "2025-01-16"}, {"avgMood": 4.7, "date": "2025-01-17"}, {"avgMood": 0.5, "date": "2025-01-18"}, {"avgMood": 2.5, "date": "2025-01-19"}, 
// {"avgMood": null, "date": "2025-01-20"},
//  {"avgMood": 7.1, "date": "2025-01-21"}, {"avgMood": 7.1, "date": "2025-01-22"}]
export const WEEKLY_MOOD_AVERAGES_NULLED = `
WITH RECURSIVE dates(date) AS (
  SELECT date('now', '-7 days')
  UNION ALL
  SELECT date(date, '+1 day')
  FROM dates
  WHERE date < date('now')
)
SELECT 
  dates.date,
  ROUND(AVG(entries.mood), 1) as avgMood
FROM dates 
LEFT JOIN entries ON date(entries.date) = dates.date
GROUP BY dates.date
ORDER BY dates.date`;

// Gets every mood for the past month, averaged for each day 

// [{"avgMood": 4.5, "date": "2025-01-01"}, {"avgMood": 1.7, "date": "2025-01-02"}, {"avgMood": 3, "date": "2025-01-03"}, ...] example
export const MONTHLY_MOOD_AVERAGES = `
  SELECT 
    date(date) as date,
    ROUND(AVG(mood), 1) as avgMood
  FROM entries
  WHERE date BETWEEN ? AND ?
  GROUP BY date(date)
  ORDER BY date
`;





// This just gets you every mood entry in the last 7 days. Not really useful since we're doing averages already tbh.
export const WEEKLY_MOOD_POINTS = `
  SELECT 
    date(date) as date,
    mood
  FROM entries
  WHERE date >= date('now', '-7 days')
  ORDER BY date
`;


// Gets every mood for the past week, averaged for each day (same format as month averages) 
// export const WEEKLY_MOOD_AVERAGES = `
//   SELECT 
//     date(date) as date,
//     ROUND(AVG(mood), 1) as avgMood
//   FROM entries
//   WHERE date >= date('now', '-7 days')
//   GROUP BY date(date)
//   ORDER BY date
// `;
export const GET_CURRENT_STREAK = `
WITH RECURSIVE dates(date) AS (
  SELECT date('now', '-30 days')
  UNION ALL
  SELECT date(date, '+1 day')
  FROM dates
  WHERE date < date('now', '+1 day')  -- Include today
),
daily_entries AS (
  SELECT 
    dates.date,
    CASE WHEN COUNT(entries.id) > 0 THEN 1 ELSE 0 END as has_entry
  FROM dates
  LEFT JOIN entries ON date(entries.date) = dates.date
  GROUP BY dates.date
  ORDER BY dates.date DESC
),
streak AS (
  SELECT 
    date,
    has_entry,
    (
      SELECT COUNT(*)
      FROM daily_entries d2
      WHERE d2.date >= daily_entries.date
      AND d2.has_entry = 1
      AND NOT EXISTS (
        SELECT 1 FROM daily_entries d3
        WHERE d3.date > daily_entries.date 
        AND d3.date <= date('now')
        AND d3.has_entry = 0
      )
    ) as streak_length
  FROM daily_entries
  WHERE date <= date('now')
)
SELECT MAX(streak_length) as streak
FROM streak
WHERE date <= date('now');
`