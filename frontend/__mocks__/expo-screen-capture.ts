// expo-screen-capture (FLAG_SECURE): no native module under jest.
export const preventScreenCaptureAsync = jest.fn().mockResolvedValue(undefined);
export const allowScreenCaptureAsync = jest.fn().mockResolvedValue(undefined);
