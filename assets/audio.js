/* Audio modes (4.1.0): mode cards, a truthful active status, the streaming plan for OBS, and the recording sound check.
   The backend decides everything; this file only shows it. A selected mode is never shown as working until a session reports it. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const A = { status: null, env: null, envBusy: false, loading: false, lastLoad: 0, problem: '', html: {}, timer: null };

const modes = () => (state.schema && state.schema.audioModes) || [];
const cur = () => (state.settings && state.settings.audioMode) || 'video_only';
const streamCur = () => (state.settings && state.settings.streamAudio) || 'none';
const labelOf = id => { const m = modes().find(x => x.id === id); return m ? m.label : id; };
const STREAMS = [
  { id: 'none', label: 'Stream without game sound', note: 'OBS gets the mirror video only.' },
  { id: 'listen', label: 'Stream and listen on the PC', note: 'You hear the game and OBS captures it.' },
  { id: 'silent_pc', label: 'Stream, PC speakers stay silent', note: 'OBS captures the game while your speakers stay quiet.' }
];

/* ---------- pieces ---------- */
function cardsHtml() {
  return modes().map(m => {
    const on = m.id === cur();
    return `<button type="button" class="amode ${on ? 'is-selected' : ''}" role="radio" aria-checked="${on}" data-amode="${esc(m.id)}">
      <span class="amode-top"><b>${esc(m.label)}</b>${m.id === 'video_only' ? '<em class="amode-tag">Default</em>' : ''}<span class="amode-check" ${on ? '' : 'hidden'}>${icon('check', 'sm')}</span></span>
      <span class="amode-sum">${esc(m.summary)}</span>
      <span class="amode-rows"><span><i>Phone</i><b>${esc(m.phone)}</b></span><span><i>PC</i><b>${esc(m.pc)}</b></span><span><i>Recording</i><b>${esc(m.recording)}</b></span></span>
      <small class="amode-need">Needs: ${esc(m.needs)}</small></button>`;
  }).join('');
}

function sessionRow(s) {
  const a = s.audio, st = s.audioState || { state: 'off', detail: '' };
  const kind = s.recording ? (s.headless ? 'Background recording' : 'Recording') : 'Mirror';
  if (!a) return { tone: 'muted', head: kind, text: 'Started before audio modes existed. It has no audio information.', facts: '', act: '' };
  let tone = 'ok', text, facts = '';
  if (a.fallback) { tone = 'bad'; text = `Asked for ${labelOf(a.requested)}, but this session is running as Video only. ${a.reason}`; }
  else if (st.state === 'failed') { tone = 'bad'; text = `${labelOf(a.effective)} has a sound problem: ${st.detail}`; }
  else if (!a.capture) {
    tone = 'muted';
    if (a.requested === 'video_only') text = 'Video only: no phone sound is captured. The phone plays normally.';
    else if (a.requested === 'record_only' && !s.recording) text = 'Copy to recording: this mirror has no sound. Recordings made in this mode carry the sound.';
    else text = `${labelOf(a.requested)}: this session captures no sound. ${(a.warnings || []).join(' ')}`;
  } else if (st.state === 'starting') { tone = 'muted'; text = `${labelOf(a.effective)}: starting the sound capture.`; }
  else text = `${labelOf(a.effective)}: capturing sound. scrcpy reports no errors.` + (s.recording ? ' The saved file is checked when the recording ends.' : '');
  if (a.capture && !a.fallback) facts = `<span>Phone: <b>${a.phone === 'silent' ? 'silent' : 'plays'}</b></span><span>PC: <b>${a.playsOnPc ? 'plays' : 'silent'}</b></span>${s.recording ? `<span>Recording: <b>${a.recordsAudio ? 'gets sound' : 'no sound'}</b></span>` : ''}`;
  if (a.note && a.capture) text += ' ' + a.note;
  let act = '';
  if (a.requested !== cur() && !a.fallback) {
    text += ` It started with ${labelOf(a.requested)}; ${labelOf(cur())} applies to the next one.`;
    if (!s.recording) act = `<button type="button" class="btn sm" data-aapply="1">Restart mirror with ${esc(labelOf(cur()))}</button>`;
  }
  return { tone, head: kind, text, facts, act };
}

function liveHtml() {
  const list = state.sessions || [];
  const sel = `<div class="aline"><span class="chip sm"><i class="dot"></i><b>Selected</b></span><span>${esc(labelOf(cur()))}. Starts with the next mirror or recording.</span></div>`;
  if (!list.length) return sel + `<div class="aline"><span class="chip sm"><i class="dot"></i><b>Active</b></span><span class="muted">Nothing is running, so no mode is active yet.</span></div>`;
  return sel + list.map(s => {
    const r = sessionRow(s);
    return `<div class="aline"><span class="chip sm ${r.tone === 'ok' ? 'ok' : r.tone === 'bad' ? 'bad' : ''}"><i class="dot"></i><b>${esc(r.head)}</b></span><span>${esc(r.text)}${r.facts ? `<span class="afacts">${r.facts}</span>` : ''}${r.act ? `<span class="aact">${r.act}</span>` : ''}</span></div>`;
  }).join('');
}

function warnHtml() {
  const st = A.status, out = [];
  if (st) {
    if (st.scrcpy && !st.scrcpy.ok && cur() !== 'video_only') out.push(`scrcpy did not list its options, so this audio mode cannot be checked. ${esc(st.scrcpy.error || '')}`);
    for (const w of st.warnings || []) if (cur() !== 'video_only') out.push(esc(w));
  }
  (state.sessions || []).forEach(s => { if (s.audio && s.audio.fallback && !out.some(x => x.includes(esc(s.audio.reason)))) out.push(esc(s.audio.reason)); });
  return out.length ? `<div class="awarn" role="status">${icon('alert', 'sm')}<div>${out.map(x => `<p>${x}</p>`).join('')}</div></div>` : '';
}

function deviceLine() {
  const st = A.status; if (!st) return '<span class="muted">Checking the phone and scrcpy...</span>';
  const d = st.device, bits = [];
  if (d && d.ok) bits.push(`${esc(d.manufacturer ? d.manufacturer + ' ' : '')}${esc(d.model)} · Android ${esc(d.release)} (API ${d.sdk})`);
  else if (d) bits.push('Android version not read: ' + esc(d.error));
  else bits.push('No phone connected');
  bits.push(st.scrcpy && st.scrcpy.ok ? 'scrcpy ' + esc(st.scrcpy.version) : 'scrcpy options unreadable');
  return bits.join(' · ');
}

function troubleHtml() {
  const sess = (state.sessions || []).some(s => s.audio && (s.audio.fallback || (s.audioState && s.audioState.state === 'failed')));
  if (!A.problem && !sess) return '';
  return `<div class="atrouble"><b>If the sound is missing or silent</b><ul>
    <li>The two Copy modes record only what apps allow to be captured. Some games block it, and then the track is silent. Reroute captures the whole phone output instead, but the phone goes quiet.</li>
    <li>Copy modes need Android 13. Reroute needs Android 11. Keep the phone unlocked while a session starts.</li>
    <li>Close other screen recorders or scrcpy windows that use the phone sound.</li>
    <li>Open Library, then More, then Check sound on a recording to see whether the file really has sound.</li></ul>${A.problem ? `<p class="hint">Last problem: ${esc(A.problem)}</p>` : ''}</div>`;
}

function streamHtml() {
  const st = A.status && A.status.stream, p = st && st.plan === streamCur() ? st : null;
  const tone = !p ? '' : p.status === 'ok' ? 'ok' : p.status === 'conflict' ? 'bad' : 'warn';
  const word = !p ? '' : p.status === 'ok' ? 'Works with this mode' : p.status === 'conflict' ? 'Does not work with this mode' : p.status === 'setup' ? 'Needs a Windows setup' : 'Check this';
  let body = '<p class="muted">Checking...</p>';
  if (p) body = `<div class="aplan ${tone}"><span class="chip sm ${tone === 'ok' ? 'ok' : tone === 'bad' ? 'bad' : ''}"><i class="dot"></i><b>${esc(word)}</b></span><p><b>${esc(p.headline)}</b></p>${p.steps && p.steps.length ? `<ol>${p.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}${(p.notes || []).map(x => `<p class="hint">${esc(x)}</p>`).join('')}</div>`;
  return `<div class="astream" role="radiogroup" aria-label="Streaming audio plan">${STREAMS.map(s => `<button type="button" class="aopt ${s.id === streamCur() ? 'is-selected' : ''}" role="radio" aria-checked="${s.id === streamCur()}" data-astream="${s.id}"><b>${esc(s.label)}</b><small>${esc(s.note)}</small></button>`).join('')}</div>${body}`;
}

function envHtml() {
  const e = A.env;
  if (A.envBusy) return '<p class="muted">Reading the Windows audio setup...</p>';
  if (!e) return '';
  if (!e.windows) return `<p class="hint">${esc((e.notes || []).join(' '))}</p>`;
  const rows = [
    ['OBS', e.obsRunning ? 'Running (' + esc((e.obsProcesses || []).join(', ')) + ')' : 'Not running'],
    ['Application Audio Capture in OBS', e.appAudioCapture ? 'Available on this Windows version (needs OBS 28 or newer)' : 'Not available. Windows 10 version 2004 or newer is needed.'],
    ['Mirror window for OBS', (e.scrcpyWindows || []).length ? esc(e.scrcpyWindows.map(w => w.title).join(', ')) : 'No mirror window is open'],
    ['Virtual audio devices', (e.virtualHints || []).length ? esc(e.virtualHints.join(', ')) : 'None found. Nothing is needed for the listen plan.'],
    ['Sound devices', (e.devices || []).length ? esc(e.devices.join(', ')) : 'Not listed']
  ];
  return `<div class="aenv">${rows.map(r => `<div><i>${esc(r[0])}</i><span>${r[1]}</span></div>`).join('')}</div><p class="hint">This is a read-only look. DROID ADB does not configure OBS, install audio drivers or change Windows sound settings.</p>`;
}

/* ---------- render ---------- */
function put(key, sel, html) {
  if (A.html[key] === html) return;
  A.html[key] = html;
  const el = $(sel); if (el) STK.setHtml(el, html);
}
function renderParts() {
  if (!$('#audio-host') || !$('#audio-cards')) return;
  put('cards', '#audio-cards', cardsHtml());
  put('live', '#audio-live', liveHtml());
  put('warn', '#audio-warn', warnHtml());
  put('dev', '#audio-dev', deviceLine());
  put('trouble', '#audio-trouble', troubleHtml());
  put('stream', '#audio-stream', streamHtml());
  put('env', '#audio-env', envHtml());
}
STK.renderAudioPanel = function () {
  const host = $('#audio-host'); if (!host) return;
  A.html = {};
  host.innerHTML = `<div class="apanel">
    <div class="ahead"><h3>Audio mode</h3><span class="hint" id="audio-dev"></span></div>
    <div class="amodes" id="audio-cards" role="radiogroup" aria-label="Audio mode"></div>
    <div class="alive" id="audio-live" aria-live="polite"></div>
    <div id="audio-warn"></div>
    <div id="audio-trouble"></div>
    <div class="ahead stream"><h3>Streaming audio (OBS)</h3></div>
    <p class="hint">What OBS hears is separate from what the recording keeps. Pick what you want for your stream. DROID ADB checks it against the audio mode above and tells you what to set in OBS and Windows. It never changes OBS, the phone or a recording because of this choice.</p>
    <div id="audio-stream"></div>
    <div class="row"><button type="button" class="btn sm" id="audio-envbtn">${icon('search', 'sm')}<span>Check Windows audio setup</span></button></div>
    <div id="audio-env"></div></div>`;
  renderParts();
  loadStatus();
};

/* ---------- data ---------- */
async function loadStatus(force) {
  if (A.loading || !$('#audio-host')) return;
  if (!force && Date.now() - A.lastLoad < 4000) return;
  A.loading = true;
  try {
    const sel = STK.sel ? STK.sel() : '';
    A.status = await STK.api('/audio-status' + (sel ? '?serial=' + encodeURIComponent(sel) : ''));
    A.lastLoad = Date.now();
  } catch (e) { A.status = null; }
  A.loading = false; renderParts();
}

/* ---------- actions ---------- */
async function setMode(id, apply) {
  if (!id) return;
  try {
    const r = await STK.post('/audio-mode', { mode: id, apply: !!apply });
    state.settings = r.settings; STK.emit('settings', r.settings);
    state.sessions = r.sessions || state.sessions;
    let msg = `${r.label} saved.`;
    if (apply) msg = r.restartedMirrors ? `${r.label} applied. The mirror was restarted.` : (r.restartError ? 'The mirror could not restart: ' + r.restartError : `${r.label} is already active.`);
    else if ((state.sessions || []).length) msg += ' It applies to the next mirror or recording.';
    if (r.recordingsKeepOldMode) msg += ' A running recording keeps its old mode until it stops.';
    STK.toast(msg, r.restartError ? 'bad' : 'ok');
    if (STK.refreshCmd) STK.refreshCmd();
  } catch (e) { STK.fail(e); }
  renderParts(); loadStatus(true);
}
async function setStream(id) {
  try { const r = await STK.post('/settings', { patch: { streamAudio: id } }); state.settings = r.settings; STK.emit('settings', r.settings); } catch (e) { return STK.fail(e); }
  renderParts(); loadStatus(true);
}
async function loadEnv() {
  A.envBusy = true; renderParts();
  try { const r = await STK.api('/audio-env'); A.env = r.env; } catch (e) { A.env = null; STK.fail(e); }
  A.envBusy = false; renderParts();
}

/* Sound check for a saved recording. Shown from Library, More. */
const BAD = ['no_audio', 'silent_hint', 'silent', 'unreadable'];
STK.audioCheck = async function (name) {
  STK.toast('Checking the sound in ' + name + '...');
  try {
    const r = (await STK.api('/audio-check?deep=1&name=' + encodeURIComponent(name))).report;
    const bad = BAD.includes(r.state);
    if (bad) { A.problem = r.summary; renderParts(); }
    STK.toast(`${name}: ${r.summary}`, bad ? 'bad' : 'ok');
  } catch (e) { STK.fail(e); }
};
STK.audioAfterRecording = async function (ev) {
  if (ev.audioProblem) { A.problem = ev.audioProblem; renderParts(); }
  try {
    const r = (await STK.api('/audio-check?name=' + encodeURIComponent(ev.file))).report;
    const bad = BAD.includes(r.state);
    if (bad) { A.problem = r.summary; renderParts(); }
    STK.toast(`Sound in ${ev.file}: ${r.summary}`, bad ? 'bad' : 'ok', { label: 'Check loudness', run: () => STK.audioCheck(ev.file) });
  } catch (e) { /* the recording is saved either way */ }
};
STK.on('audio-problem', ev => {
  A.problem = ev.problem || 'The phone sound could not be captured.';
  STK.logError && STK.logError('scrcpy audio', A.problem, { mode: ev.mode });
  STK.toast('Sound problem: ' + (STK.friendly ? STK.friendly(A.problem) : A.problem), 'bad');
  renderParts();
});

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-amode],[data-astream],[data-aapply],#audio-envbtn'); if (!t || !$('#view-settings').contains(t)) return;
  if (t.dataset.amode) return setMode(t.dataset.amode, false);
  if (t.dataset.astream) return setStream(t.dataset.astream);
  if (t.dataset.aapply) {
    if (!await STK.confirm('Restart the mirror?', `<p>The mirror window closes and opens again with <b>${esc(labelOf(cur()))}</b>. A recording that is running is not touched.</p>`, 'Restart', false)) return;
    return setMode(cur(), true);
  }
  if (t.id === 'audio-envbtn') return loadEnv();
});
document.addEventListener('keydown', e => {
  const t = e.target.closest && e.target.closest('.amode'); if (!t) return;
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const all = $$('.amode'), i = all.indexOf(t), n = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? (i + 1) % all.length : (i + all.length - 1) % all.length;
  all[n].focus(); setMode(all[n].dataset.amode, false);
});
STK.on('state', () => { if (state.view === 'settings') renderParts(); });
STK.on('settings', () => { if (state.view === 'settings') renderParts(); });
STK.on('device-changed', () => { if (state.view === 'settings') loadStatus(true); });
STK.on('view', () => { if (state.view === 'settings') loadStatus(true); });
setInterval(() => { if (state.view === 'settings' && document.visibilityState === 'visible') loadStatus(); }, 15000);
})();
