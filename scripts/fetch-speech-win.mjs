// Pinned Windows speech.cpp runtime. The application never runs its updater or server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {unzipSync} from 'fflate';
const base='https://github.com/nyosegawa/speech.cpp/releases/download/v0.8.11/';
const response=await fetch(base+'speech-0.8.11-windows-x64-vulkan.zip');
if(!response.ok)throw Error('Speech runtime download failed: '+response.status);
const zip=new Uint8Array(await response.arrayBuffer());
const hash=crypto.createHash('sha256').update(zip).digest('hex');
if(hash!=='63f4c5b5c60aeab9d4c90193298fe4ee5d2a6c931cdbdcbc8cbb126fbffc56d0')throw Error('Speech runtime checksum mismatch.');
const files=unzipSync(zip),target=path.resolve('resources/bin/win/speech');fs.mkdirSync(target,{recursive:true});
for(const name of ['speech.exe','speech.dll']){if(!files[name])throw Error('Missing speech runtime file: '+name);fs.writeFileSync(path.join(target,name),files[name]);}
const license=await fetch('https://raw.githubusercontent.com/nyosegawa/speech.cpp/v0.8.11/LICENSE');
if(!license.ok)throw Error('Could not retrieve speech.cpp license.');fs.writeFileSync(path.join(target,'LICENSE.txt'),await license.text());
console.log('speech.cpp 0.8.11 installed for the Windows build.');
