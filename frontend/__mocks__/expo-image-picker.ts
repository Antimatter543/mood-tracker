// Jest mock for expo-image-picker. Defaults grant permission and return a
// cancelled pick so importing components that call the picker don't explode in
// the test environment. Tests that need a concrete asset override these.
export const requestCameraPermissionsAsync = jest
  .fn()
  .mockResolvedValue({ granted: true });
export const requestMediaLibraryPermissionsAsync = jest
  .fn()
  .mockResolvedValue({ granted: true });
export const launchCameraAsync = jest
  .fn()
  .mockResolvedValue({ canceled: true, assets: [] });
export const launchImageLibraryAsync = jest
  .fn()
  .mockResolvedValue({ canceled: true, assets: [] });

// Deprecated in v16 but still exported by the real module; kept for any code
// that references it.
export const MediaTypeOptions = { Images: 'Images', Videos: 'Videos', All: 'All' };
