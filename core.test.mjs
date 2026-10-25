import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKS,createSession,validateReading,recordReading,startStanding,getTiming,getSummary,finishSession,addSymptom,removeReading,isSession } from './core.mjs';
const start=1_800_000_000_000;
function standing() {
 const session=createSession({age:'teen',name:'Ada',context:['Slept poorly']},start);
 recordReading(session,{bpm:68},{now:start+300_000});
 startStanding(session,start+305_000);
 return session;
}
const clone=value=>JSON.parse(JSON.stringify(value));

test('validates integer pulse and both optional pressure values without rounding',()=>{
 assert.deepEqual(validateReading({bpm:'68'}),{bpm:68,bp:null});
 assert.deepEqual(validateReading({bpm:68,systolic:'110',diastolic:'70'}),{bpm:68,bp:[110,70]});
 for(const bpm of ['',null,true,' ','abc',29,221,68.5,Infinity])assert.throws(()=>validateReading({bpm}));
 for(const pressure of [{systolic:110},{diastolic:70},{systolic:70,diastolic:110},{systolic:111.5,diastolic:70}])assert.throws(()=>validateReading({bpm:68,...pressure}));
});
test('requires the entire lying period and baseline before standing',()=>{
 const session=createSession({},start);
 assert.throws(()=>recordReading(session,{bpm:68},{now:start+299_999}));
 assert.throws(()=>startStanding(session,start+300_000));
 recordReading(session,{bpm:68},{now:start+300_000});
 assert.throws(()=>recordReading(session,{bpm:70},{now:start+301_000}));
 startStanding(session,start+301_000);
 assert.equal(session.phase,'stand'); assert.equal(isSession(session),true);
});
test('first reading at ten minutes fills only the ten-minute slot',()=>{
 const session=standing();
 const reading=recordReading(session,{bpm:105},{now:session.standStartedAt+600_000});
 assert.equal(reading.scheduledKey,'m10'); assert.equal(reading.elapsedSeconds,600);
 assert.deepEqual(getSummary(session).missing,['m1','m3','m5']);
 finishSession(session,{now:session.standStartedAt+601_000});
 assert.equal(session.status,'incomplete'); assert.equal(getSummary(session).complete,false);
});
test('saves capture time rather than delayed confirmation time',()=>{
 const session=standing();
 const capturedAt=session.standStartedAt+61_000;
 const reading=recordReading(session,{bpm:96},{now:session.standStartedAt+200_000,capturedAt,source:'camera'});
 assert.equal(reading.scheduledKey,'m1'); assert.equal(reading.elapsedSeconds,61); assert.equal(reading.capturedAt,capturedAt);
 assert.throws(()=>recordReading(session,{bpm:98},{now:capturedAt,capturedAt:capturedAt+1000}));
});
test('labels outside-window readings as late and never backfills an earlier slot',()=>{
 const session=standing();
 const reading=recordReading(session,{bpm:90},{now:session.standStartedAt+170_000});
 assert.equal(reading.scheduledKey,null);assert.equal(reading.late,true);
 const next=recordReading(session,{bpm:95},{now:session.standStartedAt+180_000});
 assert.equal(next.scheduledKey,'m3'); assert.equal(next.late,false);
});
test('duplicate measurements retain actual time without overwriting timed slots',()=>{
 const session=standing();
 const first=recordReading(session,{bpm:90},{now:session.standStartedAt+61_000});
 const second=recordReading(session,{bpm:92},{now:session.standStartedAt+65_000});
 assert.equal(first.scheduledKey,'m1');assert.equal(second.scheduledKey,null);assert.equal(session.readings.length,3);
 assert.equal(isSession(session),true);
});
test('edits keep original timestamps and an audit trail after completion',()=>{
 const session=standing();
 const first=recordReading(session,{bpm:90},{now:session.standStartedAt+61_000,source:'camera'});
 finishSession(session,{now:session.standStartedAt+600_000});
 const edit=recordReading(session,{bpm:94,systolic:110,diastolic:70},{now:session.endedAt+1000,readingId:first.id});
 assert.equal(edit.elapsedSeconds,61); assert.equal(edit.scheduledKey,'m1'); assert.equal(edit.capturedAt,session.standStartedAt+61_000);
 assert.equal(edit.edits[0].bpm,90);assert.equal(edit.edits[0].source,'camera');assert.deepEqual(edit.bp,[110,70]);
 assert.equal(isSession(session),true);
});
test('marks a full timed test complete and reopens its status after deletion',()=>{
 const session=standing();
 for(const [index,mark] of MARKS.entries()) recordReading(session,{bpm:98+index},{now:session.standStartedAt+mark.seconds*1000});
 finishSession(session,{now:session.standStartedAt+600_000});
 const summary=getSummary(session);
 assert.equal(session.status,'complete');assert.equal(summary.complete,true);assert.equal(summary.largestChange,33);assert.equal(summary.missing.length,0);
 assert.equal(isSession(clone(session)),true);
 removeReading(session,summary.standing[0].id);
 assert.equal(session.status,'incomplete');assert.equal(getSummary(session).complete,false);assert.equal(isSession(session),true);
});
test('keeps stopped tests marked stopped even if all readings exist',()=>{
 const session=standing();
 for(const mark of MARKS)recordReading(session,{bpm:100},{now:session.standStartedAt+mark.seconds*1000});
 finishSession(session,{stopped:true,now:session.standStartedAt+601_000});
 assert.equal(session.status,'stopped');assert.equal(getSummary(session).complete,false);
 removeReading(session,session.readings[1].id);assert.equal(session.status,'stopped');assert.equal(isSession(session),true);
});
test('timestamps symptoms in the phase where they happened and rejects new events after ending',()=>{
 const session=createSession({},start);
 const lying=addSymptom(session,'Dizzy',start+120_000);assert.equal(lying.phase,'rest');assert.equal(lying.elapsedSeconds,120);
 recordReading(session,{bpm:68},{now:start+300_000});startStanding(session,start+305_000);
 const standing=addSymptom(session,'Nauseous',start+365_000);assert.equal(standing.phase,'stand');assert.equal(standing.elapsedSeconds,60);
 finishSession(session,{stopped:true,now:start+370_000});
 assert.throws(()=>addSymptom(session,'Dizzy',start+371_000));assert.throws(()=>recordReading(session,{bpm:80},{now:start+371_000}));
 assert.equal(isSession(session),true);
});
test('exposes only the currently due timing window and retains elapsed time after ending',()=>{
 const session=standing(),now=session.standStartedAt;
 assert.equal(getTiming(session,now+10_000).nextMark.key,'m1');
 assert.equal(getTiming(session,now+60_000).dueMark.key,'m1');
 assert.equal(getTiming(session,now+106_000).dueMark,null);
 assert.equal(getTiming(session,now+180_000).dueMark.key,'m3');
 assert.equal(getTiming(session,now+600_000).phaseComplete,true);
 finishSession(session,{now:now+605_000});assert.equal(getTiming(session,now+999_000).elapsedSeconds,605);
});
test('rejects corrupted or inconsistent stored data',()=>{
 const session=standing();recordReading(session,{bpm:98},{now:session.standStartedAt+60_000});finishSession(session,{now:session.standStartedAt+600_000});
 assert.equal(isSession(clone(session)),true);
 for(const change of [s=>s.readings[0].bpm=NaN,s=>s.readings[1].scheduledKey='m3',s=>s.readings[1].elapsedSeconds=1,s=>s.status='complete',s=>s.context=[42],s=>s.readings.push(clone(s.readings[0])),s=>s.endedAt=s.startedAt-1,s=>s.symptoms=[{label:'Dizzy'}]]){
   const value=clone(session);change(value);assert.equal(isSession(value),false);
 }
 for(const invalid of [null,[],{},'hello'])assert.equal(isSession(invalid),false);
});

test('removing a baseline preserves a reopenable incomplete session',()=>{
 const session=standing();recordReading(session,{bpm:100},{now:session.standStartedAt+60_000});finishSession(session,{now:session.standStartedAt+600_000});
 removeReading(session,session.readings.find(reading=>reading.phase==='rest').id);
 assert.equal(getSummary(session).rest,null);assert.equal(getSummary(session).largestChange,null);assert.equal(isSession(session),true);
});

test('keeps separately scanned BP time independent from pulse capture and slot assignment',()=>{
 const session=standing(),pulseTime=session.standStartedAt+60_000,bpTime=session.standStartedAt+80_000;
 const reading=recordReading(session,{bpm:98,systolic:110,diastolic:70},{now:session.standStartedAt+90_000,capturedAt:pulseTime,source:'camera-ocr',bpCapturedAt:bpTime,bpSource:'camera-ocr'});
 assert.equal(reading.capturedAt,pulseTime);assert.equal(reading.elapsedSeconds,60);assert.equal(reading.scheduledKey,'m1');assert.equal(reading.bpCapturedAt,bpTime);assert.equal(reading.bpSource,'camera-ocr');
 finishSession(session,{now:session.standStartedAt+600_000});assert.equal(isSession(clone(session)),true);
 const serialized=clone(session);serialized.readings[1].bpCapturedAt=serialized.endedAt+1;assert.equal(isSession(serialized),false);
});
test('rejects BP capture timestamps outside the measurement phase or in the future',()=>{
 const session=standing(),now=session.standStartedAt+90_000;
 for(const bpCapturedAt of [NaN,Infinity,session.standStartedAt-1,now+1])assert.throws(()=>recordReading(session,{bpm:98,systolic:110,diastolic:70},{now,capturedAt:session.standStartedAt+60_000,bpCapturedAt}));
 assert.throws(()=>recordReading(session,{bpm:98,systolic:110,diastolic:70},{now,bpSource:'x'.repeat(41)}));
 assert.equal(session.readings.length,1);
});
test('preserves BP metadata on corrections and removes it when BP is cleared',()=>{
 const session=standing(),pulseTime=session.standStartedAt+60_000,bpTime=session.standStartedAt+80_000;
 const reading=recordReading(session,{bpm:98,systolic:110,diastolic:70},{now:session.standStartedAt+90_000,capturedAt:pulseTime,bpCapturedAt:bpTime,bpSource:'camera-ocr'});
 finishSession(session,{now:session.standStartedAt+600_000});
 recordReading(session,{bpm:99,systolic:112,diastolic:72},{readingId:reading.id,now:session.endedAt+1000});
 assert.equal(reading.bpCapturedAt,bpTime);assert.equal(reading.bpSource,'camera-ocr');assert.equal(reading.capturedAt,pulseTime);
 assert.equal(reading.edits[0].bpCapturedAt,bpTime);assert.equal(isSession(clone(session)),true);
 recordReading(session,{bpm:99},{readingId:reading.id,now:session.endedAt+2000});
 assert.equal(reading.bp,null);assert.equal(Object.hasOwn(reading,'bpCapturedAt'),false);assert.equal(Object.hasOwn(reading,'bpSource'),false);assert.equal(isSession(clone(session)),true);
});
test('never assigns an imported photo to a scheduled standing slot',()=>{
 const session=standing();
 const imported=recordReading(session,{bpm:98},{now:session.standStartedAt+60_000,source:'photo-ocr'});
 assert.equal(imported.scheduledKey,null);assert.equal(getSummary(session).missing.includes('m1'),true);
 assert.equal(imported.capturedAt,session.standStartedAt+60_000);assert.equal(isSession(clone(session)),true);
 const corrupt=clone(session);corrupt.readings[1].scheduledKey='m1';assert.equal(isSession(corrupt),false);
});

test('rejects imported photos as a guided resting baseline',()=>{
 const session=createSession({},start);
 assert.throws(()=>recordReading(session,{bpm:68},{now:start+300_000,source:'photo-ocr'}),/Use a live camera capture or manual entry for the resting baseline/);
 assert.equal(session.readings.length,0);
 recordReading(session,{bpm:68},{now:start+300_000,source:'camera-ocr'});
 assert.equal(isSession(session),true);
 const corrupted=clone(session);corrupted.readings[0].source='photo-ocr';assert.equal(isSession(corrupted),false);
});
