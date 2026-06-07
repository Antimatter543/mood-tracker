export const documentDirectory = '/mock/documents/';
export const writeAsStringAsync = jest.fn().mockResolvedValue(undefined);
export const readAsStringAsync = jest.fn().mockResolvedValue('');
export const copyAsync = jest.fn().mockResolvedValue(undefined);
// Media-helper surface (entry photo attachments). Defaults: directory does
// not exist (so ensureMediaDir creates it), delete/makeDirectory succeed.
export const getInfoAsync = jest.fn().mockResolvedValue({ exists: false });
export const makeDirectoryAsync = jest.fn().mockResolvedValue(undefined);
export const deleteAsync = jest.fn().mockResolvedValue(undefined);
export const EncodingType = { UTF8: 'utf8' };
export const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  createFileAsync: jest.fn().mockResolvedValue('mock://file'),
};
