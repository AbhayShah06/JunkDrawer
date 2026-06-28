// Renders the app icon with Chromium (via Electron) and writes build/icon-src.png.
// Run: ./node_modules/.bin/electron icongen.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration(); // makes offscreen paint reliable

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}</style></head>
<body><canvas id="c" width="1024" height="1024" style="width:1024px;height:1024px"></canvas>
<script>
const ctx = document.getElementById('c').getContext('2d'); const S = 1024;
function rr(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

// rounded-square background (warm paper)
let bg = ctx.createLinearGradient(0,0,0,S); bg.addColorStop(0,'#f1e8d5'); bg.addColorStop(1,'#dccfb0');
rr(0,0,S,S,224); ctx.fillStyle=bg; ctx.fill();
// faint inner bevel
rr(20,20,S-40,S-40,206); ctx.lineWidth=4; ctx.strokeStyle='rgba(0,0,0,0.10)'; ctx.stroke();
rr(20,18,S-40,S-40,206); ctx.lineWidth=3; ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.stroke();

// cabinet body with a soft drop shadow
ctx.save();
ctx.shadowColor='rgba(60,30,20,0.30)'; ctx.shadowBlur=46; ctx.shadowOffsetY=22;
let body = ctx.createLinearGradient(0,230,0,800); body.addColorStop(0,'#b0472c'); body.addColorStop(1,'#8c3620');
rr(258,228,508,584,46); ctx.fillStyle=body; ctx.fill();
ctx.restore();
// body top highlight
rr(258,228,508,584,46); ctx.lineWidth=6; ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.stroke();

// two drawers
function drawer(y){
  const x=298, w=428, h=232, r=22;
  let g = ctx.createLinearGradient(0,y,0,y+h); g.addColorStop(0,'#c45a3f'); g.addColorStop(1,'#a84529');
  rr(x,y,w,h,r); ctx.fillStyle=g; ctx.fill();
  // bevel: light top, dark bottom
  ctx.save(); rr(x,y,w,h,r); ctx.clip();
  ctx.strokeStyle='rgba(255,255,255,0.28)'; ctx.lineWidth=6; ctx.beginPath(); ctx.moveTo(x+10,y+6); ctx.lineTo(x+w-10,y+6); ctx.stroke();
  ctx.strokeStyle='rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.moveTo(x+10,y+h-5); ctx.lineTo(x+w-10,y+h-5); ctx.stroke();
  ctx.restore();
  // handle (cream pill)
  const hw=168, hh=34, hx=x+(w-hw)/2, hy=y+(h-hh)/2;
  rr(hx,hy,hw,hh,hh/2); ctx.fillStyle='#f1e8d5'; ctx.fill();
  rr(hx,hy,hw,hh,hh/2); ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.stroke();
}
drawer(258);
drawer(528);

document.title = 'done';
</script></body></html>`;

app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false,
    webPreferences: { offscreen: true } });
  let last = null;
  w.webContents.on('paint', (e, dirty, image) => { last = image; });
  w.webContents.setFrameRate(8);
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  w.webContents.on('did-finish-load', () => setTimeout(() => {
    if (last) { fs.writeFileSync(path.join(__dirname, 'build', 'icon-src.png'), last.toPNG());
      console.log('wrote build/icon-src.png', last.getSize()); }
    else console.log('ERROR: no paint captured');
    app.quit();
  }, 1000));
});
