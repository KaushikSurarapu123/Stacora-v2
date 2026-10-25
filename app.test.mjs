import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const core=(await readFile(new URL('./core.mjs',import.meta.url),'utf8')).replace(/export /g,'');
const app=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
function harness(){
  let time=1800000000000,blob=null,scanOptions=null;const nodes=new Map(),events={},windowEvents={},intervals=[];const storage=new Map();
  class Element{
    constructor(id=''){this.id=id;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.dataset={};this.style={};this.children=[];this.attrs={};this.events={};this._text='';this.innerHTML='';this.open=false;this.classList={toggle(){},contains(){return false;}};}
    set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent).join('');}
    append(...items){this.children.push(...items);}replaceChildren(...items){this._text='';this.children=items;}
    addEventListener(name,fn){(this.events[name]??=[]).push(fn);}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}
    querySelector(selector){const key=selector.match(/data-scan="([^"]+)"/)?.[1];return get('scanner-'+key);}
    showModal(){this.open=true;}close(){this.open=false;}focus(){}scrollIntoView(){}click(){}reset(){for(const id of ['bpmInput','sysInput','diaInput'])get(id).value='';}
  }
  function get(id){if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);}
  for(const match of html.matchAll(/\bid="([^"]+)"/g))get(match[1]);
  const document={documentElement:{dataset:{theme:'light'}},visibilityState:'visible',hidden:false,
    getElementById:get,querySelector:s=>s.includes('name="age"')?{value:'teen'}:null,
    querySelectorAll:s=>s==='.page'?[...nodes.values()].filter(n=>n.id.startsWith('view-')):[],
    createElement:()=>new Element(),createTextNode:text=>String(text),addEventListener(name,fn){(events[name]??=[]).push(fn);}};
  const window={scrollTo(){},addEventListener(name,fn){(windowEvents[name]??=[]).push(fn);},print(){}};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const context=vm.createContext({document,window,navigator:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Date:Clock,crypto:globalThis.crypto,structuredClone,Blob,URL:{createObjectURL(value){blob=value;return 'blob:test';},revokeObjectURL(){}},setInterval:fn=>intervals.push(fn),setTimeout:()=>1,clearTimeout(){},confirm:()=>false,createScanner:options=>{scanOptions=options;return{open(){},close(){}};}});
  vm.runInContext(core+'\n'+app,context);
  const click=selectors=>{const target={closest:s=>selectors[s]||null};for(const fn of events.click||[])fn({target,preventDefault(){}});};
  const submit=id=>get(id).onsubmit({preventDefault(){}});
  function start(){get('safeCheck').checked=get('understandCheck').checked=true;submit('setupForm');}
  function baseline(){time+=300000;intervals.forEach(fn=>fn());get('bpmInput').value='70';submit('readingForm');get('standButton').onclick();}
  function save(bpm){get('bpmInput').value=String(bpm);submit('readingForm');}
  function stop(){get('confirmStop').onclick();}
  async function exported(){get('downloadSession').onclick();return JSON.parse(await blob.text());}
  return{get,click,change:target=>{for(const fn of events.change||[])fn({target});},submit,start,baseline,save,stop,exported,advance:ms=>{time+=ms;intervals.forEach(fn=>fn());},now:()=>time,scan:value=>scanOptions.onUse(value),beforeUnload(){let prevented=false;for(const fn of windowEvents.beforeunload||[])fn({preventDefault(){prevented=true;}});return prevented;}};
}
test('controller records a ten-minute-first reading without filling earlier slots',async()=>{
  const h=harness();h.start();h.baseline();h.advance(600000);h.save(110);h.get('finishButton').onclick();
  const data=await h.exported();assert.equal(data.readings[1].scheduledKey,'m10');assert.equal(data.status,'incomplete');
  assert.match(h.get('reportCompleteness').textContent,/1 min, 3 min, 5 min/);
});
test('scanner integration keeps pulse and BP timestamps separate without wiping fields',async()=>{
  const h=harness();h.start();h.baseline();h.advance(61000);const pulseTime=h.now();h.scan({bpm:98,systolic:null,diastolic:null,capturedAt:pulseTime,source:'camera-ocr'});
  h.advance(19000);const bpTime=h.now();h.scan({bpm:null,systolic:120,diastolic:80,capturedAt:bpTime,source:'camera-ocr'});
  assert.equal(h.get('bpmInput').value,98);h.submit('readingForm');h.stop();
  const data=await h.exported(),reading=data.readings[1];assert.equal(reading.bpm,98);assert.equal(reading.capturedAt,pulseTime);assert.equal(reading.bpCapturedAt,bpTime);assert.equal(reading.scheduledKey,'m1');assert.deepEqual(reading.bp,[120,80]);
});
test('undo refuses to restore an occupied slot after a replacement is recorded',async()=>{
  const h=harness();h.start();h.baseline();h.advance(61000);h.save(98);
  const ids=[...h.get('liveReadings').innerHTML.matchAll(/data-remove="([^"]+)"/g)].map(m=>m[1]);
  h.click({'[data-remove]':{dataset:{remove:ids[1]}}});const undo=h.get('toast').children.at(-1);
  h.advance(1000);h.save(99);undo.onclick();h.stop();const data=await h.exported();assert.equal(data.readings.filter(r=>r.scheduledKey==='m1').length,1);assert.equal(data.readings[1].bpm,99);
});
test('unsaved stopped reports remain accessible and warn before unload or replacement',async()=>{
  const h=harness();h.start();h.stop();assert.equal(h.beforeUnload(),true);
  h.click({'[data-view]':{dataset:{view:'home'}}});assert.match(h.get('homeHistory').innerHTML,/unsaved session/);
  h.get('exampleButton').onclick();const data=await h.exported();assert.equal(data.status,'stopped');assert.equal(data.example,undefined);
  h.get('saveSession').onclick();assert.equal(h.beforeUnload(),false);
});

test('complete reports save, reopen, and compare through the controller',async()=>{
  const h=harness();
  const complete=values=>{h.start();h.baseline();let previous=0;for(const [second,bpm]of values){h.advance((second-previous)*1000);h.save(bpm);previous=second;}h.get('finishButton').onclick();h.get('saveSession').onclick();};
  complete([[61,98],[181,110],[301,112],[601,108]]);
  assert.equal((await h.exported()).status,'complete');assert.equal(h.beforeUnload(),false);
  complete([[61,90],[181,95],[301,96],[601,98]]);
  h.click({'[data-view]':{dataset:{view:'history'}}});
  const ids=[...h.get('historyList').innerHTML.matchAll(/data-select="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,2);
  for(const id of ids)h.change({dataset:{select:id},checked:true});
  h.get('compareButton').onclick();assert.equal(h.get('comparison').hidden,false);assert.match(h.get('comparisonBody').innerHTML,/110 bpm at 3:01/);assert.match(h.get('comparisonBody').innerHTML,/95 bpm at 3:01/);
  h.click({'[data-open]':{dataset:{open:ids[0]}}});assert.equal(h.get('view-result').hidden,false);assert.match(h.get('reportCompleteness').textContent,/All five/);
});
