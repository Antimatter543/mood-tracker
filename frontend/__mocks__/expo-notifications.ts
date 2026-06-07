export const getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const setNotificationChannelAsync = jest.fn().mockResolvedValue(null);
export const scheduleNotificationAsync = jest.fn().mockResolvedValue('mock-id');
export const cancelScheduledNotificationAsync = jest.fn().mockResolvedValue(undefined);
export const getAllScheduledNotificationsAsync = jest.fn().mockResolvedValue([]);

export enum AndroidImportance {
  DEFAULT = 3,
  HIGH = 4,
}

export enum SchedulableTriggerInputTypes {
  DAILY = 'daily',
  DATE = 'date',
}
