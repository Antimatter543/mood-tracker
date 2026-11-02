export const getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const setNotificationChannelAsync = jest.fn().mockResolvedValue(null);
export const scheduleNotificationAsync = jest.fn().mockResolvedValue('mock-id');
export const cancelScheduledNotificationAsync = jest.fn().mockResolvedValue(undefined);
export const getAllScheduledNotificationsAsync = jest.fn().mockResolvedValue([]);

export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';
export const addNotificationResponseReceivedListener = jest
  .fn()
  .mockReturnValue({ remove: jest.fn() });
export const getLastNotificationResponse = jest.fn().mockReturnValue(null);
export const clearLastNotificationResponse = jest.fn();
export const dismissAllNotificationsAsync = jest.fn().mockResolvedValue(undefined);

export enum AndroidImportance {
  DEFAULT = 3,
  HIGH = 4,
}

export enum SchedulableTriggerInputTypes {
  DAILY = 'daily',
  DATE = 'date',
}
