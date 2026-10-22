const fs = require('node:fs');
const path = require('node:path');

// Remove only the app-owned downloaded installer after the recorded version starts.
function createInstallerCleanup({cacheDir, receiptPath, currentVersion}) {
  const pending = path.resolve(cacheDir, 'pending');
  const newer = (a,b) => {
    const aa=String(a).split('.').map(Number),bb=String(b).split('.').map(Number);
    for(let i=0;i<Math.max(aa.length,bb.length);i++)if((aa[i]||0)!==(bb[i]||0))return (aa[i]||0)>(bb[i]||0);
    return false;
  };
  const validVersion = v => /^\d+\.\d+\.\d+$/.test(v||'');
  const same = (a,b) => process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  function safeFile(file) {
    if(typeof file!=='string'||!path.isAbsolute(file)||!same(path.dirname(path.resolve(file)),pending)||!file.toLowerCase().endsWith('.exe'))return false;
    const parent=fs.lstatSync(pending),entry=fs.lstatSync(file);
    return parent.isDirectory()&&!parent.isSymbolicLink()&&entry.isFile()&&!entry.isSymbolicLink()
      &&same(fs.realpathSync(pending),pending);
  }
  return {
    remember(info) {
      try {
        if(!validVersion(info.version)||!safeFile(info.downloadedFile))return;
        fs.mkdirSync(path.dirname(receiptPath),{recursive:true});
        fs.writeFileSync(receiptPath,JSON.stringify({version:info.version,file:info.downloadedFile}));
      } catch { /* Cleanup must never interfere with an update. */ }
    },
    cleanup() {
      try {
        const metadata=path.join(pending,'update-info.json');
        let receipt;
        if(fs.existsSync(receiptPath))receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
        else {
          // Older app versions did not save a receipt. Electron's own metadata
          // identifies the exact downloaded installer; its filename carries the version.
          if(!fs.existsSync(metadata)||fs.lstatSync(metadata).isSymbolicLink())return;
          const info=JSON.parse(fs.readFileSync(metadata,'utf8'));
          const version=/^Junk[- ]Drawer[- ]Setup[- ](\d+\.\d+\.\d+)\.exe$/i.exec(info.fileName||'');
          if(!version)return;
          receipt={version:version[1],file:path.join(pending,info.fileName)};
        }
        if(!validVersion(receipt.version)||!validVersion(currentVersion)||newer(receipt.version,currentVersion))return;
        if(fs.existsSync(receipt.file)) {
          if(!safeFile(receipt.file))return;
          fs.unlinkSync(receipt.file);
        }
        if(fs.existsSync(metadata)&&!fs.lstatSync(metadata).isSymbolicLink()) {
          const data=JSON.parse(fs.readFileSync(metadata,'utf8'));
          if(data.fileName===path.basename(receipt.file))fs.unlinkSync(metadata);
        }
        if(fs.existsSync(receiptPath))fs.unlinkSync(receiptPath);
      } catch { /* Locked files can be retried on the next launch. */ }
    },
  };
}
module.exports={createInstallerCleanup};
