import test from 'node:test';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { createApp, validateExtraction, validImage, keys } from './server.mjs';

const readings = { rest:68, m1:98, m3:112, m5:110, m10:109 };
const extraction = { is_chart:true, readings, warnings:[] };
const image = 'data:image/jpeg;base64,' + Buffer.from([255,216,1,2,255,217]).toString('base64');
// Exercise the actual HTTP request handler in-process; this environment blocks loopback client sockets.
const handlers = new Map(); let nextPort=3100;
async function serve(t, options) {
  const server=createApp(options), url='http://127.0.0.1:'+(nextPort++);
  handlers.set(new URL(url).host, server.listeners('request')[0]);
  t.after(()=>handlers.delete(new URL(url).host));
  return url;
}
async function localFetch(url, options={}) {
  const parsed=new URL(url);
  const headers={host:parsed.host};
  for(const [key,value] of Object.entries(options.headers||{})) headers[key.toLowerCase()]=value;
  const req=Readable.from(options.body ? [Buffer.from(options.body)] : []);
  Object.assign(req,{method:options.method||'GET',url:parsed.pathname+parsed.search,headers});
  let status=200, responseHeaders={};
  return new Promise((resolve,reject)=>{
    const res={writeHead(code,values){status=code;responseHeaders=values;},end(value){resolve(new Response(value,{status,headers:responseHeaders}));}};
    Promise.resolve(handlers.get(parsed.host)(req,res)).catch(reject);
  });
}
const request = (url, data, headers={}) => localFetch(url+'/api/analyze', {method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
const modelResult = value => ({ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});

test('rejects missing, fractional, out-of-range, and non-chart measurements',()=> {
  assert.deepEqual(validateExtraction(extraction),extraction);
  for(const invalid of [undefined,29,221,80.5,'80']) assert.throws(()=>validateExtraction({...extraction,readings:{...readings,m1:invalid}}));
  assert.throws(()=>validateExtraction({...extraction,is_chart:false}));
  assert.doesNotThrow(()=>validateExtraction({is_chart:false,readings:Object.fromEntries(keys.map(k=>[k,null])),warnings:['Not a chart.']}));
});
test('rejects arbitrary URLs and invalid image bytes',()=> {
  assert.equal(validImage(image),true);
  for(const invalid of ['https://example.com/chart.jpg','data:image/jpeg;base64,AAAA','data:image/png;base64,AAAA',null]) assert.equal(validImage(invalid),false);
});
test('serves app and does not expose server source',async t=> {
  const url = await serve(t,{apiKey:''});
  const page = await localFetch(url); assert.equal(page.status,200); assert.match(await page.text(),/Check every number/);
  assert.equal((await localFetch(url+'/server.mjs')).status,404);
  assert.equal((await localFetch(url+'/chart-reader.js')).status,200);
});
test('reports unconfigured state and rejects analysis without a key',async t=> {
  const url = await serve(t,{apiKey:''});
  assert.equal((await (await localFetch(url+'/api/analyze')).json()).ok,false);
  assert.equal((await request(url,{image})).status,503);
});
test('sends real vision input and strict schema; returns unconfirmed readings',async t=> {
  let captured;
  const url = await serve(t,{apiKey:'test-key',model:'test-vision-model',fetchImpl:async (target,options)=>{
    captured={target,options,body:JSON.parse(options.body)};
    return modelResult(extraction);
  }});
  const response = await request(url,{image,note:'Rest is labeled.'});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.deepEqual(result.extraction,extraction); assert.equal(result.requires_confirmation,true);
  assert.equal(captured.target,'https://api.openai.com/v1/responses');
  assert.equal(captured.options.headers.Authorization,'Bearer test-key');
  assert.equal(captured.body.store,false);
  assert.equal(captured.body.text.format.strict,true);
  assert.equal(captured.body.input[0].content[1].image_url,image);
  assert.match(captured.body.instructions,/Do not infer a baseline/);
  assert.equal(JSON.stringify(result).includes('test-key'),false);
});
test('rejects foreign origins and invalid inputs before contacting AI',async t=> {
  let calls=0;
  const url=await serve(t,{apiKey:'test-key',fetchImpl:async()=>{calls++; return modelResult(extraction);}});
  assert.equal((await request(url,{image},{Origin:'https://other.example'})).status,403);
  assert.equal((await request(url,{image:'https://example.com/image'})).status,400);
  assert.equal((await request(url,{image,note:42})).status,400);
  assert.equal(calls,0);
});
test('handles AI refusal without creating readings',async t=> {
  const url=await serve(t,{apiKey:'test-key',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal',refusal:'No'}]}]})})});
  const response=await request(url,{image}); assert.equal(response.status,422);
  assert.equal((await response.json()).extraction,undefined);
});
test('rejects malformed AI output instead of trusting it',async t=> {
  const url=await serve(t,{apiKey:'test-key',fetchImpl:async()=>modelResult({...extraction,readings:{...readings,rest:999}})});
  assert.equal((await request(url,{image})).status,502);
});
test('handles upstream rate limits and incomplete results',async t=> {
  let calls=0;
  const url=await serve(t,{apiKey:'test-key',fetchImpl:async()=>++calls===1?{ok:false,status:429}:{ok:true,json:async()=>({status:'incomplete'})}});
  assert.equal((await request(url,{image})).status,429);
  assert.equal((await request(url,{image})).status,502);
});
