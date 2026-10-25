(() => {
  const labels = [['rest','Resting, lying down'],['m1','1 minute standing'],['m3','3 minutes standing'],['m5','5 minutes standing'],['m10','10 minutes standing']];
  let available = false, image = null, busy = false, controller = null, revision = 0, checked = null, model = null;
  const ui = id => document.getElementById(id);
  const message = text => { ui('aiMsg').textContent = text; };
  function invalidate() {
    checked = null;
    ui('aiConfirm').checked = false;
    ui('aiBuild').disabled = true;
    ui('aiOut').hidden = true;
    ui('aiDownload').hidden = true;
  }
  function setBusy(value) {
    busy = value;
    ui('aiGo').disabled = busy || !image || !available;
    ui('aiFile').disabled = busy;
    ui('aiCtx').disabled = busy;
    ui('aiStop').hidden = !busy;
  }
  function clearReview() { invalidate(); ui('aiReview').hidden = true; }
  labels.forEach(([key,label]) => {
    const wrap = document.createElement('div');
    const fieldLabel = document.createElement('label');
    fieldLabel.className = 'f'; fieldLabel.htmlFor = 'extract-' + key; fieldLabel.textContent = label + ' (bpm)';
    const field = document.createElement('input');
    field.type = 'number'; field.min = '30'; field.max = '220'; field.step = '1'; field.inputMode = 'numeric'; field.id = 'extract-' + key; field.placeholder = 'Not found';
    field.addEventListener('input', invalidate);
    wrap.append(fieldLabel, field); ui('aiFields').append(wrap);
  });
  fetch('/api/analyze').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
    available = data.ok === true && data.feature === 'chart-extraction';
    ui('aiStatus').textContent = available ? 'AI chart reader is ready. No image has been sent.' : 'AI is not connected yet. The app owner needs to configure the server API key.';
    setBusy(false);
  }).catch(() => { ui('aiStatus').textContent = 'Start Stacora with its included server to use the AI chart reader.'; });
  ui('aiNav').onclick = () => { PREV = S.phase; show('ai'); };
  ui('aiBack').onclick = () => { if(controller) controller.abort(); show(PREV || 'intro'); };
  ui('aiFile').onchange = async function() {
    const current = ++revision;
    image = null; ui('pv').hidden = true; ui('pv').removeAttribute('src'); clearReview(); message(''); setBusy(false);
    const file = this.files && this.files[0];
    if (!file) return;
    if (!['image/jpeg','image/png'].includes(file.type)) return message('Choose a JPG or PNG image.');
    if (file.size > 12 * 1024 * 1024) return message('Choose an image smaller than 12 MB.');
    const url = URL.createObjectURL(file);
    try {
      const im = new Image(); im.src = url; await im.decode();
      if (current !== revision) return;
      if (im.width * im.height > 40_000_000) return message('This image is too large. Crop it to the chart first.');
      const scale = Math.min(1,1600 / Math.max(im.width,im.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(im.width*scale)); canvas.height = Math.max(1,Math.round(im.height*scale));
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(im,0,0,canvas.width,canvas.height);
      image = canvas.toDataURL('image/jpeg', .9);
      if (image.length > 4_200_000) { image = null; return message('Crop the chart or choose a smaller image.'); }
      ui('pv').src = image; ui('pv').hidden = false; setBusy(false);
    } catch { if (current === revision) message('This image could not be opened. Try a different JPG or PNG.'); }
    finally { URL.revokeObjectURL(url); }
  };
  ui('aiStop').onclick = () => { if(controller) controller.abort(); };
  ui('aiGo').onclick = async () => {
    if (!image || !available || busy) return;
    clearReview(); message('Reading labeled measurements…'); setBusy(true); controller = new AbortController();
    try {
      const response = await fetch('/api/analyze', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({image,note:ui('aiCtx').value.trim().slice(0,300)}), signal:controller.signal});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The chart could not be read. Please try again.');
      const extraction = data.extraction;
      if (!extraction || !extraction.is_chart) return message('AI did not identify a heart-rate chart. Choose a clearer chart with labeled readings.');
      model = data.model;
      const warnings = ui('aiWarnings'); warnings.replaceChildren();
      for (const warning of extraction.warnings) { const li = document.createElement('li'); li.textContent = warning; warnings.append(li); }
      for (const [key] of labels) ui('extract-'+key).value = extraction.readings[key] ?? '';
      ui('aiReview').hidden = false;
      message('AI extraction is ready. Check the image and confirm or correct each number.');
    } catch (error) { message(error.name === 'AbortError' ? 'Reading cancelled. No summary was created.' : error.message); }
    finally { controller = null; setBusy(false); }
  };
  ui('aiConfirm').onchange = () => { ui('aiBuild').disabled = !ui('aiConfirm').checked; };
  ui('aiBuild').onclick = () => {
    if (!ui('aiConfirm').checked) return;
    const readings = {};
    for (const [key] of labels) {
      const field = ui('extract-'+key), value = field.value;
      if (field.validity.badInput || (value !== '' && (!Number.isInteger(Number(value)) || Number(value)<30 || Number(value)>220))) return message('Use whole-number readings between 30 and 220, or leave a missing reading blank.');
      readings[key] = value === '' ? null : Number(value);
    }
    const standing = labels.slice(1).filter(([key]) => readings[key] !== null);
    if (readings.rest === null || !standing.length) return message('A checked resting reading and at least one checked standing reading are needed.');
    const missing = labels.filter(([key]) => readings[key] === null).map(([,label])=>label);
    const changes = standing.map(([key])=>readings[key]-readings.rest);
    const largest = Math.max(...changes);
    checked = { title:'Stacora imported chart summary', created_at:new Date().toISOString(), source:'AI-extracted, user-checked chart; not a guided Stacora test', model, readings_bpm:readings, missing:missing, largest_change_bpm:largest, educational_only:true };
    const lines = ['STACORA · CHECKED CHART SUMMARY', 'Imported from an image; these values were checked by the user.', '', ...labels.map(([key,label])=>label+': '+(readings[key] === null ? 'Missing' : readings[key]+' bpm')), '', 'Largest recorded change from rest: '+(largest>0?'+':'')+largest+' bpm.', missing.length ? 'Incomplete measurements: '+missing.join(', ')+'.' : 'All five labeled measurements are present.', '', 'This is a record of supplied measurements, not a diagnosis or a verified standing-test result. Share the original chart and checked values with your clinician.'];
    ui('aiOut').textContent = lines.join('\n'); ui('aiOut').hidden = false; ui('aiDownload').hidden = false; message('Your checked summary is ready.');
  };
  ui('aiDownload').onclick = () => {
    if (!checked) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(checked,null,2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'stacora-checked-readings.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
})();
