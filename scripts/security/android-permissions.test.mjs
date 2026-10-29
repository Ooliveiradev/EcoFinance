import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionFindings } from './android-permissions.mjs';

const manifest=permission=>`<manifest><uses-permission android:name="${permission}"/><application android:allowBackup="false"><activity android:name=".MainActivity" android:exported="true"/></application></manifest>`;
test('release allows network and rejects broad data access or exported native components',()=> {
  assert.deepEqual(permissionFindings(manifest('android.permission.INTERNET')),[]);
  for(const name of ['READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE','CAMERA','RECORD_AUDIO','ACCESS_FINE_LOCATION','SYSTEM_ALERT_WINDOW','VIBRATE','USE_BIOMETRIC','USE_FINGERPRINT'])assert.ok(permissionFindings(manifest('android.permission.'+name)).some(message=>message.includes(name)));
  assert.ok(permissionFindings(manifest('android.permission.INTERNET').replace('</application>','<service android:name=".Ingest" android:exported="true"/></application>')).some(message=>message.includes('component')));
  const receiver=permission=>manifest('android.permission.INTERNET').replace('</application>',`<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver" android:exported="true"${permission}/></application>`);
  assert.deepEqual(permissionFindings(receiver(' android:permission="android.permission.DUMP"')),[]);
  assert.ok(permissionFindings(receiver('')).some(message=>message.includes('ProfileInstallReceiver')));
  assert.ok(permissionFindings(receiver(' android:permission="com.example.OPEN"')).length);
  const listener=(name,permission)=>manifest('android.permission.INTERNET').replace('</application>',`<service android:name="${name}" android:exported="true"${permission}/></application>`);
  assert.deepEqual(permissionFindings(listener('com.ecofinance.capture.CaptureListenerService',' android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"')),[]);
  assert.ok(permissionFindings(listener('com.ecofinance.capture.CaptureListenerService','')).length);
  assert.ok(permissionFindings(listener('com.example.Other',' android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"')).length);
  assert.ok(permissionFindings(manifest('android.permission.BIND_NOTIFICATION_LISTENER_SERVICE')).length);
  assert.ok(permissionFindings(manifest('android.permission.INTERNET').replace('android:allowBackup="false"','android:allowBackup="true"')).length);
  assert.ok(permissionFindings(manifest('android.permission.INTERNET').replace('android:allowBackup="false"','android:allowBackup="false" android:debuggable="true"')).length);
});
