/**
 * The local secure-window module (modules/secure-window, README there) stays
 * what it was built to be: FLAG_SECURE on or off, nothing else.
 *
 * It replaced expo-screen-capture, which registered screenshot DETECTION on
 * every start and crashed the app on Android 14+ when its permission was
 * blocked. These checks keep that from creeping back.
 */
import fs from 'fs';
import path from 'path';
import pkg from '../package.json';
import appJson from '../app.json';

const root = path.join(__dirname, '..', 'modules', 'secure-window');
const kotlin = fs.readFileSync(
    path.join(root, 'android/src/main/java/expo/modules/securewindow/SecureWindowModule.kt'),
    'utf8'
);
const code = kotlin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // comments out

describe('secure-window module', () => {
    it('only adds or clears FLAG_SECURE', () => {
        expect(code).toMatch(/addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/);
        expect(code).toMatch(/clearFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/);
        // no screenshot detection, observers, listeners or permissions of any kind
        expect(code).not.toMatch(/register|Observer|Callback|Listener|permission|Permission|MediaStore|Events\(/);
    });

    it('declares no permissions and is autolinked from ./modules', () => {
        expect(fs.existsSync(path.join(root, 'android/src/main/AndroidManifest.xml'))).toBe(false);
        const config = JSON.parse(fs.readFileSync(path.join(root, 'expo-module.config.json'), 'utf8'));
        expect(config.android.modules).toEqual(['expo.modules.securewindow.SecureWindowModule']);
        // the module's Name() is what index.ts asks for
        expect(code).toMatch(/Name\("SecureWindow"\)/);
        expect(fs.readFileSync(path.join(root, 'index.ts'), 'utf8')).toMatch(/requireOptionalNativeModule<[^>]+>\('SecureWindow'\)/);
    });

    it('expo-screen-capture is not back, and nothing needs its permissions', () => {
        const deps = { ...pkg.dependencies, ...(pkg as { devDependencies?: object }).devDependencies };
        expect(Object.keys(deps)).not.toContain('expo-screen-capture');
        const android = appJson.expo.android as { permissions?: string[] };
        expect(android.permissions ?? []).not.toContain('android.permission.DETECT_SCREEN_CAPTURE');
        expect(android.permissions ?? []).not.toContain('android.permission.READ_MEDIA_IMAGES');
    });
});
