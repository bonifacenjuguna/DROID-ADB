/* Automation: record taps into macros, replay, text snippets, scheduled screenshots and macros. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const E = { rec: false, id: '', name: '', steps: [], last: 0, timing: STK.store.get('macro-timing', true) };
const root = () => $('#auto-root');
const macros = () => STK.kv.get('macros', []);
const snippets = () => STK.kv.get('snippets', []);
const schedules = () => STK.kv.get('schedules', []);
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const KEYS = [['back', 'Back'], ['home', 'Home'], ['recents', 'Recents'], ['enter', 'Enter'], ['playpause', 'Play or pause'], ['volup', 'Volume up'], ['voldown', 'Volume down'], ['power', 'Power'], ['wake', 'Wake screen'], ['sleep', 'Screen off'], ['notifications', 'Open notifications'], ['collapse', 'Close notifications']];

const stepText = s => ({
  tap: () => `Tap ${s.x}, ${s.y}`, long: () => `Long press ${s.x}, ${s.y}`, swipe: () => `Swipe ${s.x1}, ${s.y1} to ${s.x2}, ${s.y2}`,
  key: () => 'Press ' + ((KEYS.find(k => k[0] === s.key) || [0, s.key])[1]), text: () => `Type "${s.text}"`, wait: () => `Wait ${(s.ms / 1000).toFixed(1)} s`, open: () => 'Open ' + nice(s.package)
}[s.t] || (() => s.t))();
const stepIcon = s => ({ tap: 'tap', long: 'tap', swipe: 'up', key: 'keys', text: 'keyboard', wait: 'clock', open: 'apps' }[s.t] || 'tap');

function render() {
  if (state.view !== 'automation') return;
  const ms = macros(), sn = snippets(), sc = schedules();
  const editor = (E.rec || E.id !== '' || E.steps.length) ? editorHtml() : '';
  STK.setHtml(root(), `${editor}<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Macros</h2><button class="btn primary sm" id="m-new">${icon('record', 'sm')}<span>Record a macro</span></button></header>
      <p class="hint lead">Record taps, swipes and key presses on the phone picture, then replay them whenever you like.</p>
      ${ms.length ? ms.map(m => `<div class="grow-item"><span class="badge">${icon('macro')}</span><div><b>${esc(m.name)}</b><small>${m.steps.length} step${m.steps.length > 1 ? 's' : ''}</small></div><button class="btn sm" data-mrun="${esc(m.id)}">${icon('play', 'sm')}<span>Run</span></button><button class="icon-btn" data-mmore="${esc(m.id)}" aria-label="More">${icon('more')}</button></div>`).join('') : `<div class="empty small">${icon('macro')}<b>No macros yet</b><p>Press Record a macro, then tap on the phone picture on the Console.</p></div>`}</section>
    <section class="panel"><header class="panel-head"><h2>Text snippets</h2><button class="btn sm" id="s-new">${icon('pencil', 'sm')}<span>Add snippet</span></button></header>
      <p class="hint lead">Short texts you type often, like an email address. One click types it into the focused field on the phone.</p>
      ${sn.length ? sn.map((x, i) => `<div class="grow-item"><span class="badge">${icon('keyboard')}</span><div><b>${esc(x.name)}</b><small>${esc(x.text.length > 50 ? x.text.slice(0, 50) + '...' : x.text)}</small></div><button class="btn sm" data-ssend="${i}">${icon('send', 'sm')}<span>Type</span></button><button class="icon-btn" data-sdel="${i}" aria-label="Remove">${icon('trash')}</button></div>`).join('') : '<p class="hint">Nothing saved yet.</p>'}</section>
  </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>Scheduled tasks</h2><button class="btn sm" id="sc-new">${icon('clock', 'sm')}<span>Add task</span></button></header>
      <p class="hint lead">Take screenshots or run a macro on a timer. Scheduled tasks run while the toolkit is running, even if this page is closed.</p>
      ${sc.length ? sc.map((x, i) => `<div class="grow-item"><span class="badge">${icon(x.type === 'macro' ? 'macro' : 'camera')}</span><div><b>${esc(x.name || 'Task')}</b><small>${x.type === 'macro' ? 'Run ' + esc((ms.find(m => m.id === x.macro) || { name: 'a macro' }).name) : 'Screenshot'} · ${x.mode === 'daily' ? 'every day at ' + esc(x.at) : 'every ' + x.everyMin + ' min'}</small></div><label class="switch" title="Enabled"><input type="checkbox" data-scon="${i}" ${x.enabled === false ? '' : 'checked'} aria-label="Enabled"><i></i></label><button class="icon-btn" data-scdel="${i}" aria-label="Remove">${icon('trash')}</button></div>`).join('') : '<p class="hint">No scheduled tasks.</p>'}</section>
  </div></div>`);
}
function editorHtml() {
  return `<section class="panel editor"><header class="panel-head"><h2>${E.rec ? '<span class="live-tag">REC</span> Recording a macro' : 'Edit macro'}</h2><span class="hint">${E.steps.length} step${E.steps.length === 1 ? '' : 's'}</span></header>
  ${E.rec ? `<p class="hint lead">Now tap, swipe or press keys on the phone picture on the Console. Every action is added here. Waits between actions are added for you${E.timing ? '' : ' (off)'}.</p>` : ''}
  <div class="steps-list">${E.steps.length ? E.steps.map((s, i) => `<div class="stepr"><span class="n">${i + 1}</span>${icon(stepIcon(s), 'sm')}<span class="st">${esc(stepText(s))}</span><button class="icon-btn" data-mup="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>${icon('up', 'sm')}</button><button class="icon-btn" data-mdown="${i}" aria-label="Move down" ${i < E.steps.length - 1 ? '' : 'disabled'}>${icon('down', 'sm')}</button><button class="icon-btn" data-mdel="${i}" aria-label="Remove step">${icon('x', 'sm')}</button></div>`).join('') : '<p class="hint">No steps yet.</p>'}</div>
  <div class="row wrap"><span class="hint">Add:</span><button class="chipbtn" data-madd="wait">Wait</button><button class="chipbtn" data-madd="key">Key</button><button class="chipbtn" data-madd="text">Text</button><button class="chipbtn" data-madd="open">Open app</button><button class="chipbtn" data-madd="tap">Tap point</button><label class="chk inline"><input type="checkbox" id="m-timing" ${E.timing ? 'checked' : ''}><span>Add waits while recording</span></label></div>
  <div class="row"><button class="btn primary" id="m-save" ${E.steps.length ? '' : 'disabled'}>${icon('save', 'sm')}<span>Save macro</span></button><button class="btn" id="m-test" ${E.steps.length && STK.sel() ? '' : 'disabled'}>${icon('play', 'sm')}<span>Test run</span></button>${E.rec ? `<button class="btn rec" id="m-stop">${icon('stop', 'sm')}<span>Stop recording</span></button>` : ''}<button class="btn ghost" id="m-cancel">Discard</button></div></section>`;
}

/* floating pill while recording, so it is visible on the Console too */
const pill = document.createElement('div'); pill.className = 'macro-pill'; pill.hidden = true; document.body.append(pill);
function paintPill() { pill.hidden = !E.rec; pill.innerHTML = `<i></i><b>Recording macro</b><span>${E.steps.length} steps</span><button class="btn sm" id="pill-stop">Stop</button>`; }
pill.addEventListener('click', e => { if (e.target.id === 'pill-stop') { E.rec = false; paintPill(); STK.go('automation'); render(); } });

function addStep(s) {
  const now = Date.now();
  if (E.rec && E.timing && E.last && E.steps.length) { const gap = Math.min(5000, Math.max(0, Math.round((now - E.last) / 100) * 100)); if (gap >= 400) E.steps.push({ t: 'wait', ms: gap }); }
  E.steps.push(s); E.last = now; paintPill(); render();
}
STK.on('phone-input', s => { if (E.rec) addStep(s); });

async function addManual(kind) {
  let f;
  if (kind === 'wait') { f = await STK.form('Add a wait', STK.field('sec', 'Seconds', '1', 'type="number" min="0" max="30" step="0.1"')); if (f) addStep({ t: 'wait', ms: Math.round(Math.min(30, Math.max(0, Number(f.sec) || 1)) * 1000) }); }
  if (kind === 'key') { f = await STK.form('Add a key press', STK.select('key', 'Key', KEYS, 'back')); if (f) addStep({ t: 'key', key: f.key }); }
  if (kind === 'text') { f = await STK.form('Add typed text', STK.field('text', 'Text (letters, numbers and . , @ _ : / + = -)', '', 'maxlength="200"')); if (f) { if (!/^[A-Za-z0-9 .,@_:/+=\-]{1,200}$/.test(f.text)) return STK.toast('That text has characters the phone cannot type this way.', 'bad'); addStep({ t: 'text', text: f.text }); } }
  if (kind === 'open') { f = await STK.form('Open an app', STK.field('package', 'App package name', '', 'placeholder="com.whatsapp"')); if (f) { if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(f.package.trim())) return STK.toast('Use a package name like com.whatsapp.', 'bad'); addStep({ t: 'open', package: f.package.trim() }); } }
  if (kind === 'tap') { f = await STK.form('Add a tap', STK.field('x', 'X (pixels from the left)', '540', 'type="number" min="0"') + STK.field('y', 'Y (pixels from the top)', '1200', 'type="number" min="0"')); if (f) addStep({ t: 'tap', x: Math.round(Number(f.x)), y: Math.round(Number(f.y)) }); }
}
async function run(steps, name, btn) {
  const id = STK.sel(); if (!id) return STK.toast('Connect a phone first.', 'bad');
  await STK.busy(btn, async () => { try { await STK.jobs.start('/macro/run', { serial: id, name, steps, repeat: 1 }, 'Running "' + name + '".'); } catch (e) { STK.fail(e); } });
}
async function save(btn) {
  const name = await STK.prompt('Name this macro', 'For example: Open settings and turn off Wi-Fi', E.name, 'Save');
  if (!name) return;
  await STK.busy(btn, async () => {
    try { await STK.post('/macros', { id: E.id, name, steps: E.steps }); await STK.kv.load(); E.rec = false; E.id = ''; E.steps = []; E.name = ''; paintPill(); STK.toast('Macro saved.'); render(); } catch (e) { STK.fail(e); }
  });
}
async function newSchedule() {
  const ms = macros();
  const f = await STK.form('Add a scheduled task',
    STK.field('name', 'Name', 'Hourly screenshot') + STK.select('type', 'What to do', [['shot', 'Take a screenshot'], ...(ms.length ? [['macro', 'Run a macro']] : [])], 'shot') +
    (ms.length ? STK.select('macro', 'Macro (if running one)', ms.map(m => [m.id, m.name]), ms[0].id) : '') +
    STK.select('mode', 'How often', [['every', 'Every few minutes'], ['daily', 'Once a day']], 'every') + STK.field('everyMin', 'Minutes between runs', '60', 'type="number" min="1" max="1440"') + STK.field('at', 'Time of day (for once a day)', '08:00', 'placeholder="08:00"'), 'Add');
  if (!f) return;
  const list = [...schedules(), { name: f.name.slice(0, 40), type: f.type, macro: f.macro || '', mode: f.mode, everyMin: Number(f.everyMin) || 60, at: f.at || '08:00', enabled: true, serial: '' }];
  try { await STK.post('/schedules', { schedules: list }); await STK.kv.load(); render(); STK.toast('Task added.'); } catch (e) { STK.fail(e); }
}
async function saveSchedules(list) { try { await STK.post('/schedules', { schedules: list }); await STK.kv.load(); render(); } catch (e) { STK.fail(e); } }

document.addEventListener('click', async e => {
  const t = e.target.closest('#auto-root button'); if (!t) return;
  if (t.id === 'm-new') { if (!STK.sel()) return STK.toast('Connect a phone first.', 'bad'); Object.assign(E, { rec: true, id: '', name: '', steps: [], last: 0 }); paintPill(); STK.toast('Recording. Tap on the phone picture on the Console.'); return render(); }
  if (t.id === 'm-stop') { E.rec = false; paintPill(); return render(); }
  if (t.id === 'm-cancel') { Object.assign(E, { rec: false, id: '', name: '', steps: [] }); paintPill(); return render(); }
  if (t.id === 'm-save') return save(t);
  if (t.id === 'm-test') return run(E.steps, E.name || 'Test', t);
  if (t.dataset.madd) return addManual(t.dataset.madd);
  if (t.dataset.mdel !== undefined) { E.steps.splice(Number(t.dataset.mdel), 1); return render(); }
  if (t.dataset.mup !== undefined) { const i = Number(t.dataset.mup); [E.steps[i - 1], E.steps[i]] = [E.steps[i], E.steps[i - 1]]; return render(); }
  if (t.dataset.mdown !== undefined) { const i = Number(t.dataset.mdown); [E.steps[i + 1], E.steps[i]] = [E.steps[i], E.steps[i + 1]]; return render(); }
  if (t.dataset.mrun) { const m = macros().find(x => x.id === t.dataset.mrun); return m && run(m.steps, m.name, t); }
  if (t.dataset.mmore) {
    const m = macros().find(x => x.id === t.dataset.mmore);
    return STK.menu(t, [
      { label: 'Run 5 times', icon: 'refresh', run: () => STK.jobs.start('/macro/run', { serial: STK.sel(), name: m.name, steps: m.steps, repeat: 5 }).catch(STK.fail) },
      { label: 'Edit steps', icon: 'pencil', run: () => { Object.assign(E, { rec: false, id: m.id, name: m.name, steps: m.steps.map(s => ({ ...s })) }); render(); } },
      '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await STK.confirmDelete('Delete this macro?', `<p><b>${esc(m.name)}</b> will be removed.</p>`)) { STK.kv.set('macros', macros().filter(x => x.id !== m.id)); render(); } } }]);
  }
  if (t.id === 's-new') {
    const f = await STK.form('Add a snippet', STK.field('name', 'Name', '') + STK.field('text', 'Text to type (letters, numbers and . , @ _ : / + = -)', '', 'maxlength="200"'));
    if (!f) return; if (!f.name.trim() || !/^[A-Za-z0-9 .,@_:/+=\-]{1,200}$/.test(f.text)) return STK.toast('Give it a name and use only characters the phone can type.', 'bad');
    STK.kv.set('snippets', [...snippets(), { name: f.name.trim().slice(0, 30), text: f.text }].slice(0, 40)); return render();
  }
  if (t.dataset.ssend) return STK.busy(t, async () => { try { await STK.post('/text', { serial: STK.sel(), text: snippets()[Number(t.dataset.ssend)].text }); STK.toast('Typed on the phone.'); } catch (er) { STK.fail(er); } });
  if (t.dataset.sdel) { const l = snippets().slice(); l.splice(Number(t.dataset.sdel), 1); STK.kv.set('snippets', l); return render(); }
  if (t.id === 'sc-new') return newSchedule();
  if (t.dataset.scdel) { const l = schedules().slice(); l.splice(Number(t.dataset.scdel), 1); return saveSchedules(l); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'm-timing') { E.timing = e.target.checked; STK.store.set('macro-timing', E.timing); }
  const c = e.target.closest('input[data-scon]'); if (c) { const l = schedules().map(x => ({ ...x })); l[Number(c.dataset.scon)].enabled = c.checked; saveSchedules(l); }
});
STK.views.automation = { onShow() { render(); } };
STK.on('kv', () => render());
})();
