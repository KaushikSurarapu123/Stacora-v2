import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const script=await readFile(new URL('./chart-reader.js',import.meta.url),'utf8');
async function uiHarness(extraction) {
  const elements=new Map();
  function element(tag='div') {
    return {tag,value:'',hidden:true,disabled:false,checked:false,textContent:'',validity:{badInput:false},children:[],events:{},
      append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,handler){this.events[name]=handler;},removeAttribute(name){delete this[name];},click(){},
      getContext(){return {fillRect(){},drawImage(){}};},toDataURL(){return 'data:image/jpeg;base64,/9j/2Q==';}
    };
  }
  const doc={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement(tag){const e=element(tag); if(tag==='input')Object.defineProperty(e,'id',{set(id){elements.set(id,e);}}); return e;}};
  const fetch=async (url,options)=>({ok:true,json:async()=>options?{extraction,model:'test-model'}:{ok:true,feature:'chart-extraction'}});
  class Image {constructor(){this.width=600;this.height=300;} async decode(){}}
  vm.runInNewContext(script,{document:doc,fetch,Image,URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},AbortController,Blob,setTimeout,S:{phase:'intro'},show(){},PREV:'intro'});
  await new Promise(resolve=>setImmediate(resolve));
  const ui=id=>doc.getElementById(id);
  await ui('aiFile').onchange.call({files:[{type:'image/png',size:100}]});
  await ui('aiGo').onclick();
  return ui;
}
const extraction={is_chart:true,readings:{rest:68,m1:98,m3:112,m5:110,m10:109},warnings:[]};
test('requires confirmation and invalidates summary when a measurement changes',async()=> {
  const ui=await uiHarness(extraction);
  assert.equal(ui('aiReview').hidden,false); assert.equal(ui('aiBuild').disabled,true);
  ui('aiBuild').onclick(); assert.equal(ui('aiOut').hidden,true);
  ui('aiConfirm').checked=true; ui('aiConfirm').onchange(); ui('aiBuild').onclick();
  assert.equal(ui('aiOut').hidden,false); assert.match(ui('aiOut').textContent,/\+44 bpm/);
  assert.equal(ui('aiDownload').hidden,false);
  ui('extract-m3').value='115'; ui('extract-m3').events.input();
  assert.equal(ui('aiOut').hidden,true); assert.equal(ui('aiConfirm').checked,false); assert.equal(ui('aiDownload').hidden,true);
});
test('requires a resting baseline and marks missing readings',async()=> {
  const ui=await uiHarness({...extraction,readings:{rest:null,m1:90,m3:null,m5:null,m10:null}});
  ui('aiConfirm').checked=true; ui('aiBuild').onclick();
  assert.equal(ui('aiOut').hidden,true); assert.match(ui('aiMsg').textContent,/resting reading/);
  ui('extract-rest').value='70'; ui('aiConfirm').checked=true; ui('aiBuild').onclick();
  assert.match(ui('aiOut').textContent,/Incomplete measurements/); assert.match(ui('aiOut').textContent,/\+20 bpm/);
});
test('does not show a review or summary for unrelated images',async()=> {
  const ui=await uiHarness({is_chart:false,readings:{rest:null,m1:null,m3:null,m5:null,m10:null},warnings:[]});
  assert.equal(ui('aiReview').hidden,true); assert.equal(ui('aiOut').hidden,true);
  assert.match(ui('aiMsg').textContent,/did not identify/);
});
