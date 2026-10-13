import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionFindings } from './android-permissions.mjs';

const manifest=permission=>`<manifest><uses-permission android:name="${permission}"/><application android:allowBackup="false"><activity android:name=".MainActivity" android:exported="true"/></application></manifest>`;
test('release allows network and rejects broad data access or exported native components',()=> {
  assert.deepEqual(permissionFindings(manifest('android.permission.INTERNET')),[]);
  for(const name of ['READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE','CAMERA','RECORD_AUDIO','ACCESS_FINE_LOCATION','SYSTEM_ALERT_WINDOW','VIBRATE'])assert.ok(permissionFindings(manifest('android.permission.'+name)).some(message=>message.includes(name)));
  assert.ok(permissionFindings(manifest('android.permission.INTERNET').replace('</application>','<service android:name=".Ingest" android:exported="true"/></application>')).some(message=>message.includes('component')));
  assert.ok(permissionFindings(manifest('android.permission.INTERNET').replace('android:allowBackup="false"','android:allowBackup="true"')).length);
  assert.ok(permissionFindings(manifest('android.permission.INTERNET').replace('android:allowBackup="false"','android:allowBackup="false" android:debuggable="true"')).length);
});
