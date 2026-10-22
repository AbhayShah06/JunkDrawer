let vision=null;
async function runtime(){if(!vision){vision=await import('/vendor/vision/vision.mjs');vision.ort.env.wasm.wasmPaths=new URL('/vendor/vision/ort/',self.location).href;vision.ort.env.wasm.numThreads=2;vision.ort.env.wasm.proxy=false;}return vision;}
let ocr=null,bg=null,busy=false;
const asset=name=>'/api/model-pack-file?name='+encodeURIComponent(name);
async function extractText(blob){
 const {PaddleOCR,ort}=await runtime();
 if(!ocr)ocr=await PaddleOCR.create({worker:true,textDetectionModelName:'PP-OCRv6_small_det',textRecognitionModelName:'PP-OCRv6_small_rec',textDetectionModelAsset:{url:asset('PP-OCRv6_small_det.tar')},textRecognitionModelAsset:{url:asset('PP-OCRv6_small_rec.tar')},ortOptions:{backend:'wasm',wasmPaths:ort.env.wasm.wasmPaths,numThreads:2,proxy:false}});
 const [result]=await ocr.predict(blob);return result.items.map(line=>line.text).join('\n');
}
async function removeBackground(blob){
 const {ort}=await runtime();
 if(!bg)bg=await ort.InferenceSession.create(asset('birefnet-lite.onnx'),{executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:false});
 const image=await createImageBitmap(blob);try{
 if(image.width*image.height>64000000||image.width>16000||image.height>16000)throw Error('Resize this image below 64 megapixels before removing its background.');
 const small=new OffscreenCanvas(512,512),ctx=small.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,512,512);const rgba=ctx.getImageData(0,0,512,512).data,n=512*512,data=new Float32Array(3*n),mean=[.485,.456,.406],std=[.229,.224,.225];
 for(let c=0;c<3;c++)for(let i=0;i<n;i++)data[c*n+i]=(rgba[i*4+c]/255-mean[c])/std[c];
 const result=await bg.run({[bg.inputNames[0]]:new ort.Tensor('float32',data,[1,3,512,512])}),output=result[bg.outputNames[0]],values=output.data;
 const mask=new OffscreenCanvas(512,512),maskCtx=mask.getContext('2d'),pixels=maskCtx.createImageData(512,512);for(let i=0;i<n;i++){pixels.data[i*4]=255;pixels.data[i*4+1]=255;pixels.data[i*4+2]=255;pixels.data[i*4+3]=Math.round(255/(1+Math.exp(-values[i])));}maskCtx.putImageData(pixels,0,0);
 const canvas=new OffscreenCanvas(image.width,image.height),out=canvas.getContext('2d');out.drawImage(image,0,0);out.globalCompositeOperation='destination-in';out.drawImage(mask,0,0,image.width,image.height);output.dispose();return await canvas.convertToBlob({type:'image/png'});
 }finally{image.close();}
}
self.onmessage=async({data:{id,type,blob}})=>{if(busy){self.postMessage({id,error:'Another image task is running.'});return;}busy=true;try{let result;if(type==='included-background'){const {removeBackground}=await import('/vendor/imgly/background-removal.mjs');result=await removeBackground(blob,{publicPath:new URL('/vendor/imgly/data/',self.location).href,proxyToWorker:false});}else result=type==='ocr'?await extractText(blob):await removeBackground(blob);self.postMessage({id,result});}catch(e){self.postMessage({id,error:String(e.message||e)});}finally{busy=false;}};
