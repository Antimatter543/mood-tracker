/**
 * A backup and a stored key written by the RELEASED 2.16.0 code, not rebuilt
 * from a spec (encryptedBackupV1.ts does that part).
 *
 * FROZEN, never edit: people hold real files like this one. If a change makes
 * __tests__/encryptedBackupReleased.test.ts fail, the change broke old backups.
 *
 * How it was made, on 2026-11-04: `git archive v2.16.0` into an empty directory,
 * then that tree's own setBackupPassword(PASSWORD, KDF_FLOOR_PARAMS) and
 * exportDatabaseData, with its jest setup (node:crypto AES-GCM, @noble Argon2id,
 * the same bytes as the native path). That same tree opened the file again
 * before it was copied here. The params are the floor 2.16.0's calibration
 * writes on a slow phone.
 *
 * Throwaway password and key: this key has never protected anyone's data.
 */

/** "correct horse café 2.16.0", with the é as ONE code point (U+00E9, NFC). */
export const RELEASED_2_16_0_PASSWORD = 'correct horse caf' + String.fromCharCode(0xe9) + ' 2.16.0';

/** The one entry inside the file. */
export const RELEASED_2_16_0_NOTE = 'written by 2.16.0';

/** The file exportDatabaseData wrote. */
export const RELEASED_2_16_0_FILE =
  '{"format":"soulsync-encrypted-backup","version":1,"_note":"This SoulSync backup is encrypted with your backup password. Restore it in SoulSync and enter the password to open it. Without the password it cannot be opened.","kdf":{"name":"argon2id","memoryKiB":19456,"iterations":2,"parallelism":4,"salt":"TBw9nZOsqiCIIqV0/DYM+w=="},"cipher":"aes-256-gcm","iv":"C4z9AO0zFMhslK1V","payload":"nPYaw3eiEvgdTBwSzi4/z3ZJSfz4VUvHQosDoN8BhCmkCQWE0bwCyfzi9Nqh1nJZZeRZ+4zusX/AyCmk9xZoTe+kyTD+dpPGnaG7wDJNq39/tKpSY9QR/lTrlRSNR6ahSU4iPnk6GF6jfMCTTpMVKN+0JZREulQmSakdKCv4GIT6s3LAH4wRqaJ7PHbRWnKfJk8wxpTXc5NlM5oDstPDxfplRwcseqcF5W6e5sksRFmXKgVWXSwqD6Jhrbf8fdY8tekl7+0bUFAREbQo7tIhjgAkVNpadofS2snQ4HIV+aS9+RSq5b1w6OWn2gwEwEfkWBJH7AEdyT2zpSfiph8yhapHSP2Q57Fz2D7ilJMP/LP8IbtwzlwkqA4hF6PB7ty0AbTBuJ3CXgNLWxon9NpSwSvga7em8vf/6iLsDhkyqaFUj2pTyuQTNmJOEuByINeDkVWbpNHX3JwdkgsYJoLIp26sLHI8qUlNtW8mLMuyhC6iTYDyUPTWomJx8+EbPD0w7SJB4hwEV/O6U7fkUhL0HgV3uQRDDoJSnBSYD+d3zjcrdHqyxXmlO6c/qfWjMclvZxOoXzkuWvkkX1W5c2FBpp5cLDBiACTnpsr5fkTPaSDJCQ9Pjb0BeHSv8QsHkxlST1uuOQevIFKaawAm4YWMh7RDa7PHl6azeauyUL8i7iZMf/NQYkUGktNiYqIS4uiqRj8jiw=="}';

/** What setBackupPassword left in secure storage: `{ kdf, key }`, no strength mode. */
export const RELEASED_2_16_0_STORED_KEY =
  '{"kdf":{"name":"argon2id","memoryKiB":19456,"iterations":2,"parallelism":4,"salt":"TBw9nZOsqiCIIqV0/DYM+w=="},"key":"ubUZNVtGmBhWoMylu6MibrIREXxPsWspLydi9KSGnYI="}';
