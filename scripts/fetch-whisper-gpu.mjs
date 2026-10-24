// Optional Windows x64 backend, built from whisper.cpp b5130 by our public workflow.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function fetchWhisperGpu(){
  if(process.platform!=='win32'||process.arch!=='x64')return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-gpu-'));
  try{
    const url='https://github.com/AbhayShah06/JunkDrawer/releases/download/v1.9.0/whisper-gpu-windows-x64.zip';
    const response=await fetch(url);if(!response.ok)throw Error('GPU helper download failed ('+response.status+').');
    const hash=crypto.createHash('sha256');let bytes=0;
    const meter=new Transform({transform(data,_encoding,cb){bytes+=data.length;if(bytes>100*1024**2)return cb(Error('Unexpected GPU helper size.'));hash.update(data);cb(null,data);}});
    const archive=path.join(dir,'helper.zip');await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(archive));
    if(hash.digest('hex')!=='bc1f5f680f24e0ea7cd47bc04e2bd47922f832f2ff548d54479bf1ab66d9185e')throw Error('GPU helper checksum did not match.');
    const extracted=path.join(dir,'extracted');fs.mkdirSync(extracted);
    const result=spawnSync('tar',['-xf',archive,'-C',extracted],{windowsHide:true});if(result.status!==0)throw Error('Could not extract GPU helper.');
    const target=fileURLToPath(new URL('../resources/bin/win/whisper-gpu/',import.meta.url));fs.mkdirSync(target,{recursive:true});
    for(const name of fs.readdirSync(extracted))if(name==='whisper-cli.exe'||name==='LICENSE'||name.endsWith('.dll'))fs.copyFileSync(path.join(extracted,name),path.join(target,name));
    console.log('Installed optional Vulkan speech backend.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await fetchWhisperGpu();
