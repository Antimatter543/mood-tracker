/**
 * expo-screen-capture (the app lock's FLAG_SECURE) also declares permissions for
 * its screenshot DETECTION, which SoulSync does not use. READ_MEDIA_IMAGES is a
 * sensitive permission on Google Play (it needs a declaration), so app.json
 * must keep both out of the manifest for as long as the package is installed.
 * (READ_EXTERNAL_STORAGE up to API 32 is not blocked: expo-image-picker already
 * declares it for photo attachments on older Android.)
 */
import appJson from '../app.json';
import pkg from '../package.json';

const UNUSED = ['android.permission.READ_MEDIA_IMAGES', 'android.permission.DETECT_SCREEN_CAPTURE'];

it('expo-screen-capture is installed and its unused permissions are blocked', () => {
    expect(Object.keys(pkg.dependencies)).toContain('expo-screen-capture');
    const blocked: string[] = (appJson.expo.android as { blockedPermissions?: string[] }).blockedPermissions ?? [];
    for (const p of UNUSED) expect(blocked).toContain(p);
    const requested: string[] = (appJson.expo.android as { permissions?: string[] }).permissions ?? [];
    for (const p of UNUSED) expect(requested).not.toContain(p);
});
