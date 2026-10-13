export const releasePermissions = new Set([
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  // AndroidX protects its own dynamic receivers with a signature permission.
  'com.ecofinance.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);
const attribute=(tag,name)=>tag.match(new RegExp(name+'\\s*=\\s*"([^"]+)"'))?.[1];
export function permissionFindings(xml) {
  const findings=[];
  const app=xml.match(/<application\b[^>]*>/)?.[0];
  if(!app || attribute(app,'android:allowBackup')!=='false')findings.push('release backups must be disabled');
  if(app && attribute(app,'android:debuggable')==='true')findings.push('release must not be debuggable');
  for(const [tag]of xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*>/g)) {
    const name=attribute(tag,'android:name');
    if(!name || !releasePermissions.has(name))findings.push('unexpected release permission: '+(name??'missing name'));
  }
  for(const [tag]of xml.matchAll(/<(?:activity|activity-alias|service|receiver|provider)\b[^>]*>/g)) {
    // DUMP is signature|privileged|development: only adb/Play can reach AndroidX's profile installer.
    const systemOnly=attribute(tag,'android:permission')==='android.permission.DUMP';
    if(attribute(tag,'android:exported')==='true' && !systemOnly && !['.MainActivity','com.ecofinance.app.MainActivity'].includes(attribute(tag,'android:name')))findings.push('unexpected exported component: '+attribute(tag,'android:name'));
  }
  return findings;
}
