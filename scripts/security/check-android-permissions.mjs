import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { permissionFindings } from './android-permissions.mjs';

async function files(dir) {
  return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(entry=>entry.isDirectory()?files(join(dir,entry.name)):[join(dir,entry.name)]))).flat();
}
const candidates=(await files('apps/expo/android/app/build/intermediates')).filter(path=>/[/\\]merged_manifests?[/\\]release[/\\]/.test(path) && path.endsWith('AndroidManifest.xml'));
if(!candidates.length)throw new Error('Missing merged release manifest. Run :app:processReleaseMainManifest.');
for(const path of candidates) {
  const findings=permissionFindings(await readFile(path,'utf8'));
  if(findings.length)throw new Error(findings.join('; '));
}
console.info('Merged release manifest permissions passed ('+candidates.length+' manifests).');
