import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCandidates,validateScan,createScanner} from './scanner.js';

test('OCR candidate extraction preserves exact digit groups without guesses',()=>{
  assert.deepEqual(parseCandidates('PR 98 bpm 98 7 999 29 221 120.5 -120 9O'),[98]);
  assert.deepEqual(parseCandidates('SYS 128 DIA 82 PULSE 71','bp'),[128,82,71]);
  assert.deepEqual(parseCandidates('260 261 30','bp'),[260,30]);
  assert.deepEqual(parseCandidates(null),[]);
});
test('scanner validates heart and blood pressure independently',()=>{
  assert.deepEqual(validateScan({bpm:'98'}),{bpm:98,systolic:null,diastolic:null});
  for(const bpm of ['',null,undefined,29,221,98.5,'abc'])assert.throws(()=>validateScan({bpm}));
  assert.deepEqual(validateScan({systolic:'120',diastolic:'80'},'bp'),{bpm:null,systolic:120,diastolic:80});
  for(const v of [{systolic:80,diastolic:120},{systolic:120},{systolic:120,diastolic:20}])assert.throws(()=>validateScan(v,'bp'));
});
function harness(t,{recognizeText='PR 98 bpm',cameraError=null,cameraWait=null}={}){
  const saved=new Map();
  const setGlobal=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
  t.after(()=>{for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  function node(){return{value:'',hidden:false,disabled:false,checked:false,children:[],events:{},width:640,height:400,videoWidth:640,videoHeight:400,textContent:'',
    setAttribute(){},addEventListener(name,fn){(this.events[name]??=[]).push(fn);},async emit(name,event={}){for(const fn of this.events[name]||[])await fn(event);},
    append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},focus(){this.events.focus?.forEach(fn=>fn());},async play(){},
    getContext(){return{drawImage(){},fillRect(){},strokeRect(){}};}};}
  const nodes=new Map();const get=name=>{if(!nodes.has(name))nodes.set(name,node());return nodes.get(name);};
  const dialog=node();dialog.querySelector=selector=>get(selector.match(/data-scan="([^"]+)"/)[1]);dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  let requests=0,stops=0,terminations=0,calls=[];
  const stream={getTracks:()=>[{stop(){stops++;}}]};
  setGlobal('navigator',{mediaDevices:{async getUserMedia(){requests++;if(cameraError)throw cameraError;if(cameraWait)await cameraWait;return stream;}}});
  setGlobal('document',{createElement:()=>node(),head:node()});
  setGlobal('Tesseract',{PSM:{SPARSE_TEXT:'11'},async createWorker(){return{async setParameters(){},async recognize(){return{data:{text:recognizeText}};},async terminate(){terminations++;}};}});
  const scanner=createScanner({dialog,onUse:value=>{calls.push(value);}});
  return {scanner,get,dialog,calls,stats:()=>({requests,stops,terminations})};
}
test('opening scanner does not request camera; closing releases camera',async t=>{
  const h=harness(t);h.scanner.open({contextLabel:'Resting reading'});
  assert.equal(h.stats().requests,0);assert.equal(h.get('context').textContent,'Resting reading');
  await h.get('start').emit('click');assert.equal(h.stats().requests,1);
  h.scanner.close();assert.equal(h.stats().stops,1);assert.equal(h.dialog.open,false);
});
test('denied camera leaves manual/photo alternatives and reports error',async t=>{
  const h=harness(t,{cameraError:Object.assign(new Error('denied'),{name:'NotAllowedError'})});h.scanner.open();
  await h.get('start').emit('click');assert.match(h.get('status').textContent,/permission was not granted/);
  assert.equal(h.get('file').disabled,false);h.scanner.close();
});
test('OCR requires explicit confirmation and preserves capture timestamp',async t=>{
  const h=harness(t);h.scanner.open();await h.get('start').emit('click');
  const before=Date.now();await h.get('capture').emit('click');const after=Date.now();
  assert.equal(h.stats().stops,1);
  await h.get('read').emit('click');assert.equal(h.get('bpm').value,'98');assert.equal(h.get('use').disabled,true);
  await h.get('use').emit('click');assert.equal(h.calls.length,0);
  h.get('confirm').checked=true;await h.get('confirm').emit('change');await h.get('use').emit('click');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].bpm,98);assert.equal(h.calls[0].source,'camera-ocr');
  assert.ok(h.calls[0].capturedAt>=before&&h.calls[0].capturedAt<=after);assert.equal(h.dialog.open,false);
  assert.ok(h.stats().terminations>=1);
});
test('multiple OCR candidates stay unselected and edits invalidate confirmation',async t=>{
  const h=harness(t,{recognizeText:'PULSE 98 SPO2 99'});h.scanner.open();await h.get('start').emit('click');await h.get('capture').emit('click');await h.get('read').emit('click');
  assert.equal(h.get('bpm').value,'');assert.equal(h.calls.length,0);
  h.get('confirm').checked=true;await h.get('confirm').emit('change');h.get('bpm').value='98';await h.get('bpm').emit('input');
  assert.equal(h.get('confirm').checked,false);assert.equal(h.get('use').disabled,true);h.scanner.destroy();
});
test('BP scanner does not silently choose systolic and diastolic',async t=>{
  const h=harness(t,{recognizeText:'SYS 120 DIA 80 PULSE 71'});h.scanner.open({mode:'bp'});
  await h.get('start').emit('click');await h.get('capture').emit('click');await h.get('read').emit('click');
  assert.equal(h.get('systolic').value,'');assert.equal(h.get('diastolic').value,'');
  h.get('systolic').value='120';h.get('diastolic').value='80';h.get('confirm').checked=true;await h.get('use').emit('click');
  assert.deepEqual({...h.calls[0],capturedAt:0},{bpm:null,systolic:120,diastolic:80,capturedAt:0,source:'camera-ocr'});
});

test('invalid replacement image clears the previous source and cannot reuse its reading',async t=>{
  const h=harness(t);h.scanner.open();await h.get('start').emit('click');await h.get('capture').emit('click');await h.get('read').emit('click');
  assert.equal(h.get('review').hidden,false);
  await h.get('file').emit('change',{target:{files:[{type:'text/plain',size:100}],value:'bad.txt'}});
  assert.equal(h.get('preview').hidden,true);assert.equal(h.get('crop').hidden,true);assert.equal(h.get('review').hidden,true);
  await h.get('read').emit('click');assert.equal(h.get('review').hidden,true);
  h.get('bpm').value='98';h.get('confirm').checked=true;await h.get('use').emit('click');assert.equal(h.calls.length,0);h.scanner.close();
});
test('cancelled replacement selection also discards the old image',async t=>{
  const h=harness(t);h.scanner.open();await h.get('start').emit('click');await h.get('capture').emit('click');
  await h.get('file').emit('change',{target:{files:[],value:''}});
  assert.equal(h.get('preview').hidden,true);assert.equal(h.get('crop').hidden,true);
  await h.get('read').emit('click');assert.equal(h.get('review').hidden,true);assert.match(h.get('status').textContent,/No photo selected/);h.scanner.close();
});
test('closing while camera permission is pending stops the eventual stream',async t=>{
  let allowCamera;const waiting=new Promise(resolve=>{allowCamera=resolve;});
  const h=harness(t,{cameraWait:waiting});h.scanner.open();const pending=h.get('start').emit('click');
  assert.equal(h.stats().requests,1);h.scanner.close();allowCamera();await pending;
  assert.equal(h.stats().stops,1);assert.equal(h.dialog.open,false);assert.equal(h.get('video').srcObject,null);
});
