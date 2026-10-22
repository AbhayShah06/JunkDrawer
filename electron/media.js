/* Shared conversion contract. Plain JavaScript for both Electron's server and renderer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JDMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const inputs = {
    video: 'mp4 mov mkv webm avi flv wmv m4v 3gp 3g2 mpeg mpg ts mts m2ts m2t m2v ogv vob mod tod mxf dv asf rm rmvb f4v wtv divx'.split(' '),
    audio: 'mp3 wav aac m4a m4b flac ogg oga opus wma aiff aif amr ac3 eac3 dts au snd ape alac caf mka mp2 aifc wv spx voc ra'.split(' '),
    image: 'png jpg jpeg webp gif bmp heic heif avif jxl tif tiff ico tga ppm pgm pbm pnm pcx jp2 j2k exr hdr dds qoi'.split(' '),
  };
  const formats = [
    ['mp4','video','MP4 · most devices','libx264','mp4',['-c:v','libx264','-crf','20','-preset','fast','-c:a','aac','-b:a','192k','-movflags','+faststart']],
    ['mkv','video','MKV · flexible container','libx264','matroska',['-c:v','libx264','-crf','20','-preset','fast','-c:a','aac']],
    ['webm','video','WebM · web video','libvpx-vp9','webm',['-c:v','libvpx-vp9','-crf','32','-b:v','0','-c:a','libopus']],
    ['mov','video','MOV · QuickTime','libx264','mov',['-c:v','libx264','-crf','20','-c:a','aac']],
    ['avi','video','AVI · older software','mpeg4','avi',['-c:v','mpeg4','-q:v','3','-c:a','libmp3lame']],
    ['mpg','video','MPEG · legacy video','mpeg2video','mpeg',['-c:v','mpeg2video','-q:v','3','-c:a','mp2','-b:a','192k']],
    ['mp3','audio','MP3 · most devices','libmp3lame','mp3',['-c:a','libmp3lame','-q:a','2']],
    ['wav','audio','WAV · uncompressed','pcm_s16le','wav',['-c:a','pcm_s16le']],
    ['flac','audio','FLAC · lossless','flac','flac',['-c:a','flac']],
    ['m4a','audio','M4A · AAC audio','aac','ipod',['-c:a','aac','-b:a','192k']],
    ['aac','audio','AAC · raw AAC','aac','adts',['-c:a','aac','-b:a','192k']],
    ['ogg','audio','OGG · Vorbis','libvorbis','ogg',['-c:a','libvorbis','-q:a','5']],
    ['opus','audio','Opus · small voice files','libopus','opus',['-c:a','libopus','-b:a','128k']],
    ['aiff','audio','AIFF · uncompressed','pcm_s16be','aiff',['-c:a','pcm_s16be']],
    ['ac3','audio','AC3 · Dolby Digital','ac3','ac3',['-c:a','ac3','-b:a','192k']],
    ['wma','audio','WMA · older Windows devices','wmav2','asf',['-c:a','wmav2','-b:a','192k']],
    ['au','audio','AU · legacy audio','pcm_s16be','au',['-c:a','pcm_s16be']],
    ['mp2','audio','MP2 · MPEG audio','mp2','mp2',['-c:a','mp2','-b:a','192k']],
    ['png','image','PNG · transparency','png','image2',['-c:v','png']],
    ['jpg','image','JPG · photos','mjpeg','image2',['-c:v','mjpeg','-q:v','2']],
    ['webp','image','WebP · smaller images','libwebp','image2',['-c:v','libwebp','-quality','90']],
    ['tiff','image','TIFF · lossless','tiff','image2',['-c:v','tiff']],
    ['bmp','image','BMP · legacy bitmap','bmp','image2',['-c:v','bmp']],
    ['tga','image','TGA · textures','targa','image2',['-c:v','targa']],
    ['ppm','image','PPM · portable pixmap','ppm','image2',['-c:v','ppm']],
    ['pgm','image','PGM · grayscale','pgm','image2',['-c:v','pgm']],
    ['avif','image','AVIF · compact still image','libaom-av1','avif',['-c:v','libaom-av1','-crf','30','-still-picture','1']],
    ['jxl','image','JPEG XL · lossless','libjxl','image2',['-c:v','libjxl','-distance','0']],
  ].map(([ext,kind,label,encoder,muxer,args]) => ({ext,kind,label,encoder,muxer,args}));
  function available(encoders, muxers) {
    const e=new Set(encoders), m=new Set(muxers);
    return formats.filter(f=>e.has(f.encoder)&&m.has(f.muxer)&&
      (f.kind!=='video'||e.has(({webm:'libopus',avi:'libmp3lame',mpg:'mp2'})[f.ext]||'aac'))).map(f=>({...f}));
  }
  function plan(format, input='in.bin', output) {
    const f=formats.find(f=>f.ext===format);
    if(!f) throw new Error('Unsupported output format');
    output=output||'out.'+f.ext;
    if(![input,output].every(n=>/^[a-zA-Z0-9_.-]{1,64}$/.test(n)&&!n.includes('..')))throw new Error('Invalid filename');
    const routing=f.kind==='audio'?['-map','0:a:0','-vn','-sn','-dn']:f.kind==='video'?
      ['-map','0:v:0','-map','0:a:0?','-sn','-dn','-vf','scale=ceil(iw/2)*2:ceil(ih/2)*2','-pix_fmt','yuv420p']:
      ['-map','0:v:0','-frames:v','1','-an'];
    return ['-i',input,...routing,...f.args,...(f.kind==='image'&&f.muxer==='image2'?['-update','1']:[]),output];
  }
  function identify(b) {
    const text=new TextDecoder('latin1').decode(b), starts=s=>text.startsWith(s);
    if(starts('SQLite format 3'))return {label:'SQLite database',note:'This contains database records, not a playable recording. Export with a database-specific tool.'};
    if(text.includes('#!SILK_V3'))return {label:'SILK audio (possibly a Skype recording)',note:'This build does not bundle a raw SILK decoder. Keep the original and use a dedicated SILK/Skype exporter.'};
    if(starts('RIFF'))return {label:'RIFF container (WAV, AVI, or WebP)'};
    if(starts('OggS'))return {label:'Ogg media'};
    if(starts('fLaC'))return {label:'FLAC audio'};
    if(starts('ID3')||(b[0]===255&&(b[1]&224)===224))return {label:'MPEG audio / AAC candidate'};
    if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)return {label:'PNG image'};
    if(b[0]===255&&b[1]===216&&b[2]===255)return {label:'JPEG image'};
    if(starts('GIF8'))return {label:'GIF image'};
    if(starts('%PDF'))return {label:'PDF document'};
    if(starts('PK\x03\x04'))return {label:'ZIP / Office archive'};
    if(text.slice(4,8)==='ftyp')return {label:'ISO media container (MP4, MOV, HEIF, or AVIF)'};
    if(b[0]===0x47&&b[188]===0x47||b[4]===0x47&&b[196]===0x47)return {label:'MPEG transport stream (TS / MTS / M2TS)'};
    if(b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3)return {label:'Matroska / WebM media'};
    return {label:'Unknown signature',note:'Unknown does not mean corrupt. The native media engine may still recognize streams. Encrypted, proprietary, and database files cannot be converted as ordinary media.'};
  }
  return { inputs, formats, available, plan, identify };
});
