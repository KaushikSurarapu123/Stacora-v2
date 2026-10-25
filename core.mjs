export const MARKS = Object.freeze([
  { key: 'm1', seconds: 60, label: '1 min' },
  { key: 'm3', seconds: 180, label: '3 min' },
  { key: 'm5', seconds: 300, label: '5 min' },
  { key: 'm10', seconds: 600, label: '10 min' }
].map(Object.freeze));
const WINDOW = 45;
const timestamp = value => Number.isFinite(value) && value >= 0;
const blank = value => value === undefined || value === null || value === '';
const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
const cleanText = (value, max) => typeof value === 'string' && value.length <= max;
function at(value = Date.now()) {
  if (!timestamp(value)) throw new Error('The measurement time is invalid.');
  return value;
}
function integer(value, min, max) {
  if (blank(value) || typeof value === 'boolean' || (typeof value !== 'number' && typeof value !== 'string')) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}
function validBP(value) {
  return value === null || (Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]) && value[0] >= 60 && value[0] <= 260 && Number.isInteger(value[1]) && value[1] >= 30 && value[1] <= 160 && value[0] > value[1]);
}
function bpMetadata(session, phase, bp, capturedAt, source, now) {
  if (!bp) return {};
  const metadata = {};
  if (capturedAt !== undefined) {
    const start = phase === 'rest' ? session.startedAt : session.standStartedAt;
    const end = phase === 'rest' ? session.standStartedAt ?? session.endedAt ?? now : session.endedAt ?? now;
    if (!timestamp(capturedAt) || start === null || capturedAt < start || capturedAt > end || capturedAt > now) throw new Error('The blood pressure capture time is outside this measurement phase.');
    metadata.bpCapturedAt = capturedAt;
  }
  if (source !== undefined) {
    if (!cleanText(source, 40) || !source) throw new Error('The blood pressure source is invalid.');
    metadata.bpSource = source;
  }
  return metadata;
}
function hasValidBPMetadata(reading, session) {
  const hasTime = Object.hasOwn(reading, 'bpCapturedAt'), hasSource = Object.hasOwn(reading, 'bpSource');
  if (!hasTime && !hasSource) return true;
  if (!reading.bp) return false;
  const start = reading.phase === 'rest' ? session.startedAt : session.standStartedAt;
  const end = reading.phase === 'rest' ? session.standStartedAt ?? session.endedAt : session.endedAt;
  if (hasTime && (!timestamp(reading.bpCapturedAt) || start === null || reading.bpCapturedAt < start || (end !== null && reading.bpCapturedAt > end))) return false;
  return !hasSource || (cleanText(reading.bpSource, 40) && Boolean(reading.bpSource));
}
export function createSession({ age = 'teen', name = '', context = [] } = {}, now = Date.now()) {
  at(now);
  if (!['teen', 'adult'].includes(age)) throw new Error('Choose an age group.');
  if (!cleanText(name, 80) || !Array.isArray(context) || context.length > 20 || context.some(item => !cleanText(item, 120))) throw new Error('The session details are invalid.');
  return { id: id(), startedAt: now, standStartedAt: null, endedAt: null, phase: 'lie', status: 'active', age, name: name.trim(), context: [...context], readings: [], symptoms: [] };
}
export function validateReading({ bpm, systolic, diastolic } = {}) {
  const pulse = integer(bpm, 30, 220);
  if (pulse === null) throw new Error('Enter a whole-number heart rate from 30 to 220 bpm.');
  if (blank(systolic) && blank(diastolic)) return { bpm: pulse, bp: null };
  const top = integer(systolic, 60, 260), bottom = integer(diastolic, 30, 160);
  if (top === null || bottom === null || top <= bottom) throw new Error('Enter both blood pressure numbers, with the top number greater than the bottom, or leave both blank.');
  return { bpm: pulse, bp: [top, bottom] };
}
export function getTiming(session, now = Date.now()) {
  const time = at(now);
  const standing = session.phase === 'stand' || (session.phase === 'result' && session.standStartedAt !== null);
  const start = standing ? session.standStartedAt : session.startedAt;
  const end = session.endedAt ?? time;
  const elapsedSeconds = Math.max(0, (end - start) / 1000);
  const length = standing ? 600 : 300;
  const recorded = new Set(session.readings.map(reading => reading.scheduledKey));
  return {
    elapsedSeconds, remainingSeconds: Math.max(0, length - elapsedSeconds),
    nextMark: standing ? MARKS.find(mark => elapsedSeconds < mark.seconds && !recorded.has(mark.key)) || null : null,
    dueMark: standing ? MARKS.find(mark => elapsedSeconds >= mark.seconds && elapsedSeconds <= mark.seconds + WINDOW && !recorded.has(mark.key)) || null : null,
    phaseComplete: elapsedSeconds >= length
  };
}
function updateFinishedStatus(session) {
  if (session.phase === 'result' && session.status !== 'stopped') session.status = getSummary(session).complete ? 'complete' : 'incomplete';
}
export function recordReading(session, values, { now = Date.now(), capturedAt, source = 'manual', readingId, bpCapturedAt, bpSource } = {}) {
  const time = at(now), data = validateReading(values);
  if (!cleanText(source, 40) || !source) throw new Error('The measurement source is invalid.');
  if (readingId) {
    const reading = session.readings.find(item => item.id === readingId);
    if (!reading) throw new Error('That reading could not be found.');
    if (time < reading.capturedAt) throw new Error('An edit cannot precede its measurement.');
    const metadata = data.bp ? (reading.bp ? bpMetadata(session, reading.phase, data.bp, reading.bpCapturedAt, reading.bpSource, time) : bpMetadata(session, reading.phase, data.bp, bpCapturedAt, bpSource, time)) : {};
    const audit = { editedAt: time, bpm: reading.bpm, bp: reading.bp ? [...reading.bp] : null, source: reading.source };
    if (reading.bpCapturedAt !== undefined) audit.bpCapturedAt = reading.bpCapturedAt;
    if (reading.bpSource !== undefined) audit.bpSource = reading.bpSource;
    reading.edits.push(audit);
    delete reading.bpCapturedAt; delete reading.bpSource;
    Object.assign(reading, data, metadata);
    updateFinishedStatus(session);
    return reading;
  }
  if (session.phase === 'result' || session.status !== 'active') throw new Error('This test has ended. Edit an existing reading instead.');
  const capture = at(capturedAt ?? time);
  if (capture > time) throw new Error('A measurement cannot be in the future.');
  const phase = session.phase === 'lie' ? 'rest' : 'stand';
  const start = phase === 'rest' ? session.startedAt : session.standStartedAt;
  if (!timestamp(start) || capture < start) throw new Error('This measurement was captured before the current phase.');
  const elapsedSeconds = (capture - start) / 1000;
  if (phase === 'rest') {
    if (source === 'photo-ocr') throw new Error('Use a live camera capture or manual entry for the resting baseline. Imported photos have unknown measurement times.');
    if (elapsedSeconds < 300) throw new Error('Finish the five-minute lying-down period before saving your resting reading.');
    if (session.readings.some(item => item.phase === 'rest')) throw new Error('A resting reading is already saved. Edit that reading to correct it.');
  }
  const mark = phase === 'stand' && source !== 'photo-ocr' ? MARKS.find(item => elapsedSeconds >= item.seconds && elapsedSeconds <= item.seconds + WINDOW) : null;
  const occupied = mark && session.readings.some(item => item.scheduledKey === mark.key);
  const reading = { id: id(), phase, ...data, elapsedSeconds, capturedAt: capture, source, scheduledKey: mark && !occupied ? mark.key : null, late: phase === 'stand' && elapsedSeconds >= 60 && !mark, edits: [] };
  Object.assign(reading, bpMetadata(session, phase, data.bp, bpCapturedAt, bpSource, time));
  session.readings.push(reading);
  return reading;
}
export function startStanding(session, now = Date.now()) {
  const time = at(now);
  if (session.phase !== 'lie' || session.status !== 'active') throw new Error('This test is not in the lying-down phase.');
  if (time - session.startedAt < 300_000 || !session.readings.some(item => item.phase === 'rest')) throw new Error('Finish five minutes lying down and save a resting reading first.');
  if (session.readings.some(item => item.capturedAt > time || (item.bpCapturedAt !== undefined && item.bpCapturedAt > time))) throw new Error('Standing cannot begin before the resting reading.');
  session.standStartedAt = time; session.phase = 'stand';
  return session;
}
export function getSummary(session) {
  const rest = session.readings.find(item => item.phase === 'rest') || null;
  const standing = session.readings.filter(item => item.phase === 'stand').slice().sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  const missing = [...(!rest ? ['rest'] : []), ...MARKS.filter(mark => !standing.some(reading => reading.scheduledKey === mark.key)).map(mark => mark.key)];
  const end = session.endedAt ?? Date.now();
  const complete = missing.length === 0 && session.standStartedAt !== null && end - session.standStartedAt >= 600_000 && session.status !== 'stopped';
  return { rest, standing, largestChange: rest && standing.length ? Math.max(...standing.map(reading => reading.bpm - rest.bpm)) : null, missing, complete, status: session.status };
}
export function finishSession(session, { stopped = false, now = Date.now() } = {}) {
  const time = at(now);
  if (session.phase === 'result') return session;
  const latest = Math.max(session.standStartedAt ?? session.startedAt, ...session.readings.map(reading => Math.max(reading.capturedAt, reading.bpCapturedAt ?? 0)), ...session.symptoms.map(symptom => symptom.capturedAt));
  if (time < latest) throw new Error('The end time cannot precede a recorded event.');
  session.endedAt = time; session.phase = 'result'; session.status = stopped ? 'stopped' : 'incomplete';
  updateFinishedStatus(session);
  return session;
}
export function addSymptom(session, label, now = Date.now()) {
  const time = at(now);
  if (session.status !== 'active' || session.phase === 'result') throw new Error('This test has ended.');
  if (!cleanText(label, 80) || !label.trim()) throw new Error('Choose a symptom.');
  const phase = session.phase === 'lie' ? 'rest' : 'stand';
  const start = phase === 'rest' ? session.startedAt : session.standStartedAt;
  if (time < start) throw new Error('The symptom time precedes this phase.');
  const symptom = { id: id(), label: label.trim(), phase, elapsedSeconds: (time - start) / 1000, capturedAt: time };
  session.symptoms.push(symptom);
  return symptom;
}
export function removeReading(session, readingId) {
  const index = session.readings.findIndex(item => item.id === readingId);
  if (index < 0) throw new Error('That reading could not be found.');
  const [reading] = session.readings.splice(index, 1);
  updateFinishedStatus(session);
  return reading;
}
export function isSession(session) {
  try {
    if (!session || typeof session !== 'object' || !cleanText(session.id, 100) || !session.id || !timestamp(session.startedAt) || !['teen', 'adult'].includes(session.age) || !cleanText(session.name, 80)) return false;
    if (!['lie', 'stand', 'result'].includes(session.phase) || !['active', 'complete', 'incomplete', 'stopped'].includes(session.status)) return false;
    if ((session.phase === 'result') !== (session.status !== 'active')) return false;
    if (session.standStartedAt !== null && (!timestamp(session.standStartedAt) || session.standStartedAt < session.startedAt + 300_000)) return false;
    if (session.phase === 'stand' && session.standStartedAt === null) return false;
    if (session.phase === 'lie' && session.standStartedAt !== null) return false;
    if (session.phase === 'result' ? !timestamp(session.endedAt) || session.endedAt < (session.standStartedAt ?? session.startedAt) : session.endedAt !== null) return false;
    if (!Array.isArray(session.context) || session.context.length > 20 || session.context.some(item => !cleanText(item, 120))) return false;
    if (!Array.isArray(session.readings) || session.readings.length > 1000 || !Array.isArray(session.symptoms) || session.symptoms.length > 1000) return false;
    const ids = new Set(), slots = new Set(); let restCount = 0;
    for (const reading of session.readings) {
      if (!reading || !cleanText(reading.id, 100) || !reading.id || ids.has(reading.id) || !['rest', 'stand'].includes(reading.phase) || !timestamp(reading.capturedAt) || !Number.isFinite(reading.elapsedSeconds) || reading.elapsedSeconds < 0) return false;
      ids.add(reading.id);
      if (!Number.isInteger(reading.bpm) || reading.bpm < 30 || reading.bpm > 220 || !validBP(reading.bp) || !cleanText(reading.source, 40) || !reading.source || typeof reading.late !== 'boolean') return false;
      const start = reading.phase === 'rest' ? session.startedAt : session.standStartedAt;
      if (start === null || Math.abs(reading.elapsedSeconds - (reading.capturedAt - start) / 1000) > .001 || (session.endedAt !== null && reading.capturedAt > session.endedAt)) return false;
      if (!hasValidBPMetadata(reading, session)) return false;
      if (reading.source === 'photo-ocr' && (reading.phase === 'rest' || reading.scheduledKey !== null)) return false;
      if (reading.phase === 'rest') {
        restCount++;
        if (reading.elapsedSeconds < 300 || reading.scheduledKey !== null || reading.late || (session.standStartedAt !== null && reading.capturedAt > session.standStartedAt)) return false;
      } else {
        const mark = MARKS.find(item => item.key === reading.scheduledKey);
        if (reading.scheduledKey !== null && (!mark || slots.has(mark.key) || reading.elapsedSeconds < mark.seconds || reading.elapsedSeconds > mark.seconds + WINDOW)) return false;
        if (mark) slots.add(mark.key);
      }
      if (!Array.isArray(reading.edits) || reading.edits.length > 1000 || reading.edits.some(edit => !edit || !timestamp(edit.editedAt) || edit.editedAt < reading.capturedAt || !Number.isInteger(edit.bpm) || edit.bpm < 30 || edit.bpm > 220 || !validBP(edit.bp) || !cleanText(edit.source, 40) || !hasValidBPMetadata({ ...edit, phase: reading.phase }, session))) return false;
    }
    if (restCount > 1) return false;
    for (const symptom of session.symptoms) {
      if (!symptom || !cleanText(symptom.id, 100) || !symptom.id || ids.has(symptom.id) || !cleanText(symptom.label, 80) || !symptom.label.trim() || !['rest', 'stand'].includes(symptom.phase) || !timestamp(symptom.capturedAt) || !Number.isFinite(symptom.elapsedSeconds) || symptom.elapsedSeconds < 0) return false;
      ids.add(symptom.id);
      const start = symptom.phase === 'rest' ? session.startedAt : session.standStartedAt;
      if (start === null || Math.abs(symptom.elapsedSeconds - (symptom.capturedAt - start) / 1000) > .001 || (session.endedAt !== null && symptom.capturedAt > session.endedAt)) return false;
    }
    if (session.status === 'complete' && !getSummary(session).complete) return false;
    return true;
  } catch { return false; }
}

