import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Timeframe = 'week' | 'month' | '3months' | 'year' | 'alltime';

// Helper function to get SQL date condition string based on timeframe
export const getTimeframeCondition = (timeframe: Timeframe): string => {
  switch (timeframe) {
    case 'week':
      return "date >= date('now', '-7 days')";
    case 'month':
      return "date >= date('now', '-1 month')";
    case '3months':
      return "date >= date('now', '-3 months')";
    case 'year':
      return "date >= date('now', '-1 year')";
    case 'alltime':
    default:
      return "1=1"; // No time restriction
  }
};

// Helper to get readable description
export const getTimeframeDescription = (timeframe: Timeframe): string => {
  switch (timeframe) {
    case 'week':
      return "Past 7 days";
    case 'month':
      return "Past month";
    case '3months':
      return "Past 3 months";
    case 'year':
      return "Past year";
    case 'alltime':
      return "All time";
  }
};

interface TimeframeContextType {
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
  timeframeCondition: string;
  timeframeDescription: string;
}

const TimeframeContext = createContext<TimeframeContextType>({
  timeframe: 'month', // Default timeframe
  setTimeframe: () => {},
  timeframeCondition: getTimeframeCondition('month'),
  timeframeDescription: getTimeframeDescription('month')
});

export const TimeframeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('month');

  const contextValue = {
    timeframe,
    setTimeframe,
    timeframeCondition: getTimeframeCondition(timeframe),
    timeframeDescription: getTimeframeDescription(timeframe)
  };

  return (
    <TimeframeContext.Provider value={contextValue}>
      {children}
    </TimeframeContext.Provider>
  );
};

export const useTimeframe = () => useContext(TimeframeContext);