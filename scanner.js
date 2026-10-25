const OCR_SCRIPT='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
let enginePromise;
export function parseCandidates(text,mode='heart') {
  if(typeof text!=='string')return[];
  const tokens=text.match(/(?<![\w.\-])\d{2,3}(?![\w.])/g)||[];
  return [...new Set(tokens.map(Number).filter(n=>n>=30&&n<=(mode==='bp'?260:220)))];
}
export function validateScan(v,mode='heart') {
  const whole=(x,min,max)=>x!==''&&x!==null&&x!==undefined&&Number.isInteger(Number(x))&&Number(x)>=min&&Number(x)<=max;
  if(mode==='bp'){
    if(!whole(v.systolic,60,260)||!whole(v.diastolic,30,160)||Number(v.systolic)<=Number(v.diastolic))throw new Error('Check both blood pressure numbers. The top number must be larger than the bottom number.');
    return {bpm:null,systolic:Number(v.systolic),diastolic:Number(v.diastolic)};
  }
  if(!whole(v.bpm,30,220))throw new Error('Use a whole-number heart rate between 30 and 220 bpm.');
  return {bpm:Number(v.bpm),systolic:null,diastolic:null};
}
function loadEngine(){
  if(globalThis.Tesseract)return Promise.resolve(globalThis.Tesseract);
  if(!enginePromise)enginePromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=OCR_SCRIPT;script.async=true;script.crossOrigin='anonymous';
    let settled=false;
    const fail=()=>{if(settled)return;settled=true;clearTimeout(timeout);script.onload=script.onerror=null;script.remove();enginePromise=null;reject(new Error('The reader could not download. Check your connection, or use manual entry.'));};
    const timeout=setTimeout(fail,30000);
    script.onload=()=>{if(settled)return;if(!globalThis.Tesseract)return fail();settled=true;clearTimeout(timeout);script.onload=script.onerror=null;resolve(globalThis.Tesseract);};
    script.onerror=fail;document.head.append(script);
  });return enginePromise;
}
export function createScanner({dialog,onUse,onClose=()=>{}}){
  if(!dialog||typeof onUse!=='function')throw new Error('Scanner needs a dialog and callback.');
  dialog.setAttribute('aria-labelledby','scan-title');
  dialog.innerHTML=`<div class="scanner-head"><div><p class="eyebrow">CAMERA + LOCAL MACHINE LEARNING</p><h2 id="scan-title">Scan a reading</h2></div><button type="button" class="button" data-scan="close">Close</button></div>
  <p data-scan="context" class="muted"></p><p>Read a number from your device display. A nearby helper can scan while you stay still. Your watch or monitor measures your pulse; this camera reads its screen.</p>
  <div class="scanner-actions"><label>Measurement<select data-scan="mode"><option value="heart">Heart rate (bpm)</option><option value="bp">Blood pressure (mmHg)</option></select></label><button type="button" class="button primary" data-scan="start">Start camera</button><label class="button">Choose a photo<input data-scan="file" type="file" accept="image/jpeg,image/png,image/webp" class="scanner-file"></label></div>
  <p class="small muted">Images are processed in this browser. The reader and pretrained model download the first time; no API key is needed.</p>
  <div class="scanner-media"><video data-scan="video" playsinline muted hidden aria-label="Live camera preview"></video><canvas data-scan="preview" hidden aria-label="Display image with crop region"></canvas></div>
  <div class="scanner-actions"><button type="button" class="button primary" data-scan="capture" hidden>Capture display</button><button type="button" class="button" data-scan="stop-camera" hidden>Stop camera</button></div>
  <div data-scan="crop" hidden><h3>Frame just the reading</h3><p class="small muted">Keep the digits and their units or labels in view.</p><div class="scanner-grid">
  <label>Left<input type="range" min="0" max="90" value="0" data-scan="left"></label><label>Top<input type="range" min="0" max="90" value="0" data-scan="top"></label><label>Width<input type="range" min="10" max="100" value="100" data-scan="width"></label><label>Height<input type="range" min="10" max="100" value="100" data-scan="height"></label></div><button type="button" class="button primary" data-scan="read">Read selected area</button></div>
  <p data-scan="status" class="scan-status" role="status" aria-live="polite"></p>
  <section data-scan="review" hidden><h3>Check before using</h3><p data-scan="timestamp" class="small muted"></p><p class="small muted">Digits can be misread, especially with glare or digital segments. Check the measurement type and every number.</p><div data-scan="candidates" class="scan-candidates"></div>
  <div class="scanner-fields"><label data-scan="heart-field">Heart rate (bpm)<input data-scan="bpm" type="number" inputmode="numeric" min="30" max="220" step="1"></label><label data-scan="systolic-field" hidden>Top number<input data-scan="systolic" type="number" inputmode="numeric" min="60" max="260" step="1"></label><label data-scan="diastolic-field" hidden>Bottom number<input data-scan="diastolic" type="number" inputmode="numeric" min="30" max="160" step="1"></label></div>
  <label class="check-row"><input data-scan="confirm" type="checkbox">I checked the numbers, units, and measurement type against the original display. This reading is current.</label><button type="button" class="button primary" data-scan="use" disabled>Use checked reading</button></section>`;
  const el=name=>dialog.querySelector(`[data-scan="${name}"]`),video=el('video'),preview=el('preview');
  let stream=null,worker=null,source=null,capturedAt=null,sourceKind=null,current=0,opened=false,busy=false,destroyed=false,target='bpm';
  const status=text=>{el('status').textContent=text;};
  function stopStream(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.hidden=true;el('capture').hidden=el('stop-camera').hidden=true;}
  function terminateWorker(){const old=worker;worker=null;if(old)Promise.resolve(old.terminate()).catch(()=>{});}
  function setBusy(value){busy=value;['read','start','file','mode','left','top','width','height'].forEach(name=>{el(name).disabled=value;});}
  function invalidate(){el('confirm').checked=false;el('use').disabled=true;}
  function clearReview(){invalidate();el('review').hidden=true;el('candidates').replaceChildren();['bpm','systolic','diastolic'].forEach(n=>{el(n).value='';});}
  function clearImage(){source=null;capturedAt=null;sourceKind=null;preview.width=preview.height=1;preview.hidden=true;el('crop').hidden=true;clearReview();}
  function modeChanged(){invalidate();const bp=el('mode').value==='bp';target=bp?'systolic':'bpm';el('heart-field').hidden=bp;el('systolic-field').hidden=el('diastolic-field').hidden=!bp;el('candidates').replaceChildren();}
  function cropRect(){const left=+el('left').value/100,top=+el('top').value/100;return{x:source.width*left,y:source.height*top,w:source.width*Math.min(+el('width').value/100,1-left),h:source.height*Math.min(+el('height').value/100,1-top)};}
  function drawPreview(){if(!source)return;preview.width=source.width;preview.height=source.height;const ctx=preview.getContext('2d'),r=cropRect();ctx.drawImage(source,0,0);ctx.fillStyle='rgba(9,24,39,.5)';ctx.fillRect(0,0,source.width,source.height);ctx.drawImage(source,r.x,r.y,r.w,r.h,r.x,r.y,r.w,r.h);ctx.strokeStyle='#29b9a1';ctx.lineWidth=Math.max(3,source.width/250);ctx.strokeRect(r.x,r.y,r.w,r.h);preview.hidden=false;}
  function acceptImage(image,time,kind){const factor=Math.min(1,1600/Math.max(image.width,image.height));source=document.createElement('canvas');source.width=Math.max(1,Math.round(image.width*factor));source.height=Math.max(1,Math.round(image.height*factor));const ctx=source.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,source.width,source.height);ctx.drawImage(image,0,0,source.width,source.height);capturedAt=time;sourceKind=kind;el('left').value=el('top').value='0';el('width').value=el('height').value='100';clearReview();el('crop').hidden=false;drawPreview();status('Frame the display, then choose Read selected area. Nothing has been saved.');}
  async function startCamera(){const token=++current;clearImage();stopStream();status('Requesting camera access…');if(!navigator.mediaDevices?.getUserMedia)return status('Camera access needs HTTPS or localhost and a supported browser. Choose a photo or enter manually.');try{const result=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});if(!opened||token!==current){result.getTracks().forEach(t=>t.stop());return;}stream=result;video.srcObject=stream;video.hidden=false;preview.hidden=true;el('crop').hidden=true;await video.play();if(!opened||token!==current)return;el('capture').hidden=el('stop-camera').hidden=false;status('Point at the measurement display. Ask a nearby helper if needed.');}catch(error){if(token!==current||!opened)return;stopStream();status(error.name==='NotAllowedError'?'Camera permission was not granted. Choose a photo or use manual entry.':'The camera could not open. Close other camera apps or choose a photo.');}}
  el('start').addEventListener('click',startCamera);
  el('stop-camera').addEventListener('click',()=>{++current;stopStream();status('Camera stopped. Choose a photo or start again.');});
  el('capture').addEventListener('click',()=>{if(!video.videoWidth||!stream)return status('Wait for the camera preview before capturing.');const time=Date.now(),image=document.createElement('canvas');image.width=video.videoWidth;image.height=video.videoHeight;image.getContext('2d').drawImage(video,0,0);stopStream();acceptImage(image,time,'camera-ocr');});
  el('file').addEventListener('change',async event=>{const token=++current;stopStream();clearImage();const file=event.target.files?.[0];if(!file)return status('No photo selected. Choose a current photo or start the camera.');if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024)return status('Choose a JPG, PNG, or WebP image smaller than 12 MB.');const time=Date.now(),url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();if(token!==current||!opened)return;if(!image.width||!image.height||image.width*image.height>40_000_000)throw new Error('Use a smaller image cropped to the device display.');acceptImage(image,time,'photo-ocr');}catch(error){if(token===current&&opened)status(error.message||'The image could not open.');}finally{URL.revokeObjectURL(url);event.target.value='';}});
  ['left','top','width','height'].forEach(n=>el(n).addEventListener('input',()=>{clearReview();drawPreview();}));
  el('mode').addEventListener('change',modeChanged);
  ['bpm','systolic','diastolic'].forEach(n=>{el(n).addEventListener('input',invalidate);el(n).addEventListener('focus',()=>{target=n;});});
  el('confirm').addEventListener('change',()=>{el('use').disabled=!el('confirm').checked;});
  el('read').addEventListener('click',async()=>{
    if(!source||busy)return;
    const token=++current;let jobWorker=null;clearReview();setBusy(true);status('Loading the local AI reader. The first model download may take a moment…');
    try{
      const engine=await loadEngine();if(token!==current||!opened)return;
      const created=await engine.createWorker('eng',1,{
        workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        logger:m=>{if(token===current&&opened&&m.status)status(m.status==='recognizing text'?`Reading digits… ${Math.round((m.progress||0)*100)}%`:'Preparing the local text-recognition model…');}
      });
      if(token!==current||!opened){await created.terminate();return;}
      jobWorker=created;worker=created;await created.setParameters({tessedit_pageseg_mode:engine.PSM?.SPARSE_TEXT||'11'});
      const r=cropRect(),scale=Math.min(3,2400/Math.max(r.w,r.h)),crop=document.createElement('canvas');
      crop.width=Math.max(1,Math.round(r.w*scale));crop.height=Math.max(1,Math.round(r.h*scale));
      const ctx=crop.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,crop.width,crop.height);ctx.drawImage(source,r.x,r.y,r.w,r.h,0,0,crop.width,crop.height);
      const result=await created.recognize(crop);if(token!==current||!opened)return;
      const candidates=parseCandidates(result.data?.text||'',el('mode').value),box=el('candidates');box.replaceChildren();
      if(candidates.length){
        const p=document.createElement('p');p.className='small muted';p.textContent=el('mode').value==='bp'?'Choose a field below, then tap a candidate. Check top and bottom numbers separately.':'Select the value labeled as heart rate, or type the correct value below.';box.append(p);
        candidates.forEach(value=>{const button=document.createElement('button');button.type='button';button.className='button';button.textContent=String(value);button.addEventListener('click',()=>{el(target).value=String(value);invalidate();if(el('mode').value==='bp'&&target==='systolic'){target='diastolic';el('diastolic').focus();}});box.append(button);});
        if(el('mode').value==='heart'&&candidates.length===1)el('bpm').value=String(candidates[0]);
      }
      el('timestamp').textContent=(sourceKind==='photo-ocr'?'Photo imported at ':'Display captured at ')+new Date(capturedAt).toLocaleTimeString()+'.'+(sourceKind==='photo-ocr'?' Import time is not the original measurement time. Use only a current reading.':' Processing time does not change this timestamp.');
      el('review').hidden=false;
      status(candidates.length?'Check the suggested digits against the original display. Nothing has been saved.':'No usable digits were found. Type the display value below or retake the photo.');
    }catch(error){if(token===current&&opened)status(error.message||'The display could not be read. Try a tighter crop or manual entry.');}
    finally{if(worker===jobWorker)terminateWorker();else if(jobWorker)Promise.resolve(jobWorker.terminate()).catch(()=>{});if(token===current&&opened)setBusy(false);}
  });
  el('use').addEventListener('click',()=>{
    if(!el('confirm').checked||!capturedAt||!source)return;
    try{const values=validateScan({bpm:el('bpm').value,systolic:el('systolic').value,diastolic:el('diastolic').value},el('mode').value);onUse({...values,capturedAt,source:sourceKind});close();}
    catch(error){status(error.message||'Check the reading and try again.');}
  });
  function close(){if(!opened)return;opened=false;++current;stopStream();terminateWorker();setBusy(false);clearReview();source=null;capturedAt=null;sourceKind=null;preview.width=preview.height=1;preview.hidden=true;el('crop').hidden=true;if(dialog.open)dialog.close();onClose();}
  el('close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(opened)close();});
  return{
    open({mode='heart',contextLabel=''}={}){if(destroyed)throw new Error('Scanner was destroyed.');if(opened)close();opened=true;++current;el('context').textContent=contextLabel;el('mode').value=mode==='bp'?'bp':'heart';modeChanged();clearReview();setBusy(false);status('Choose Start camera or a current photo of the device display.');if(!dialog.open)dialog.showModal();},
    close,destroy(){close();destroyed=true;dialog.replaceChildren();}
  };
}




