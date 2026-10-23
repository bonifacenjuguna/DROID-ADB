const API='http://127.0.0.1:47821/api';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
let toastTimer, settingsSaveTimer, settingsSaveSequence=0, lastDevices=[], recordingFiles=[];
function toast(message) {
    const el=$('#toast');
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove('show'), 3200)
}
async function api(path, opts= {
}
) {
    const response=await fetch(API+path, {
        ...opts, headers: {
            'Content-Type':'application/json', ...(opts.headers|| {
            }
            )
        }
    }
    );
    const data=await response.json().catch(()=>( {
        error:'Invalid backend response'
    }
    ));
    if(!response.ok)throw Error(data.error||'Request failed');
    return data
}
function esc(value) {
    return String(value??'').replace(/[&<>"']/g, c=>( {
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }
    [c]))
}
function size(n) {
    n=Number(n)||0;
    if(n<1024)return n+' B';
    if(n<1048576)return(n/1024).toFixed(1)+' KB';
    if(n<1073741824)return(n/1048576).toFixed(1)+' MB';
    return(n/1073741824).toFixed(2)+' GB'
}
function date(value) {
    const d=new Date(value);
    return Number.isNaN(d.getTime())?'Unknown date':d.toLocaleString()
}
function ago(value) {
    const seconds=Math.max(0, Math.floor((Date.now()-new Date(value).getTime())/1000));
    if(!Number.isFinite(seconds))return 'Date unavailable';
    if(seconds<60)return 'Just now';
    if(seconds<3600)return Math.floor(seconds/60)+' min ago';
    if(seconds<86400)return Math.floor(seconds/3600)+' hr ago';
    return Math.floor(seconds/86400)+' days ago'
}
function view(name) {
    $$('.view').forEach(el=>el.classList.toggle('hidden', el.id!=='view-'+name));
    $$('.nav[data-view]').forEach(el=>el.classList.toggle('active', el.dataset.view===name));
    const labels= {
        home:['Overview', 'OVERVIEW'], recordings:['Recording library', 'RECORDINGS'], settings:['Settings & preferences', 'SETTINGS'], device:['Device diagnostics', 'DEVICE DIAGNOSTICS']
    }
    ;
    $('#page-title').textContent=(labels[name]||labels.home)[0];
    $('#breadcrumb-current').textContent=(labels[name]||labels.home)[1];
    if(name==='recordings')loadFiles();
    if(name==='settings')loadSettings();
    if(name==='device')loadDevices()
}
$$('[data-view]').forEach(el=>el.addEventListener('click', ()=>view(el.dataset.view)));
async function loadStatus() {
    try {
        await api('/status');
        $('#status-chip').className='status-chip online';
        $('#status-chip').innerHTML='<span class="status-dot"></span>Backend online';
        $('#backend-label').textContent='Backend connected';
        $('#sidebar-dot').className='online-dot online';
        await Promise.allSettled([loadDevices(true), loadFiles(true), loadSession()]);
        $('#last-check').textContent='Last checked '+new Date().toLocaleTimeString([], {
            hour:'2-digit', minute:'2-digit'
        }
        )
    }
    catch(e) {
        $('#status-chip').className='status-chip offline';
        $('#status-chip').innerHTML='<span class="status-dot"></span>Backend offline';
        $('#backend-label').textContent='Backend offline';
        $('#sidebar-dot').className='online-dot offline';
        $('#device-summary').textContent='Could not connect to the local backend. Run Launch.bat and refresh.';
        $('#metric-devices').textContent='—';
        $('#metric-sessions').textContent='—'
    }
}
async function loadSession() {
    try {
        const d=await api('/session');
        const processes=d.sessions||[];
        $('#metric-sessions').textContent=String(processes.length);
        $('#metric-session-note').textContent=processes.length?processes.filter(p=>p.recording).length+' recording · '+processes.filter(p=>!p.recording).length+' mirror':'No active windows';
        $('#session-badge').className='mini-badge '+(processes.length?'good':'');
        $('#session-badge').textContent=processes.length?processes.length+' active':'No active sessions';
        $('#session-list').innerHTML=processes.length?processes.map(p=>'<div class="session-row"><span class="session-kind '+(p.recording?'recording':'')+'">'+(p.recording?'●':'▣')+'</span><div class="session-info"><b>'+esc(p.recording?'Screen recording':'Phone mirroring')+'</b><small>Process '+esc(p.pid)+(p.started?' · Started '+esc(date(p.started)):'')+'</small></div><span class="session-state '+(p.recording?'recording':'')+'">'+(p.recording?'RECORDING':'MIRRORING')+'</span></div>').join(''):'<div class="session-empty"><span class="session-empty-mark">◌</span><span>No active toolkit windows. Use Mirror phone or Start recording to begin a session.</span></div>'
    }
    catch {
        $('#metric-sessions').textContent='—';
        $('#metric-session-note').textContent='Session status unavailable';
        $('#session-badge').className='mini-badge bad';
        $('#session-badge').textContent='Unavailable';
        $('#session-list').textContent='Could not read session status.'
    }
}
async function action(name) {
    const buttons=$$('[data-action]');
    buttons.forEach(b=>b.disabled=true);
    try {
        const d=await api('/action', {
            method:'POST', body:JSON.stringify( {
                action:name
            }
            )
        }
        );
        toast(d.message||'Action complete.');
        if(name==='check') {
            view('device');
            await loadDevices()
        }
        setTimeout(()=> {
            loadStatus();recent()
        }
        , 900)
    }
    catch(e) {
        toast(e.message)
    }
    finally {
        buttons.forEach(b=>b.disabled=false)
    }
}
$$('[data-action]').forEach(b=>b.addEventListener('click', ()=>action(b.dataset.action)));
$('#refresh').addEventListener('click', ()=> {
    loadStatus();recent();toast('Dashboard refreshed.')
}
);
function deviceRows(devices) {
    return devices.map(d=>'<div class="device-summary-row"><span class="device-avatar">⌁</span><div class="device-summary-copy"><b>'+esc(d.id)+'</b><small>'+esc(d.details||'Android device')+'</small></div><span class="state-pill '+(d.state==='device'?'':'bad')+'">'+esc(d.state)+'</span></div>').join('')
}
async function loadDevices(quiet=false) {
    try {
        const d=await api('/devices');
        lastDevices=d.devices||[];
        const ready=lastDevices.filter(x=>x.state==='device').length;
        $('#metric-devices').textContent=String(ready);
        $('#metric-device-note').textContent=ready?'Authorized and ready':'No authorized device';
        $('#connection-badge').className='mini-badge '+(ready?'good':'bad');
        $('#connection-badge').textContent=ready?'Connected':'Not connected';
        $('#adb-chip').className='mini-badge '+(ready?'good':'bad');
        $('#adb-chip').textContent=ready?'Device ready':'Needs attention';
        $('#device-summary').innerHTML=lastDevices.length?deviceRows(lastDevices):'<div class="empty-state">'+esc(d.message||'No device detected. Connect your phone and run a device check.')+'</div>';
        $('#device-list').innerHTML=lastDevices.length?lastDevices.map(x=>'<div class="device-row"><span class="device-avatar">⌁</span><div class="device-id"><b>'+esc(x.id)+'</b><small>'+esc(x.details||'Android device')+'</small></div><span class="device-status '+(x.state==='device'?'':esc(x.state))+'">'+esc(x.state)+'</span></div>').join(''):'<div class="no-recordings"><div class="empty-illustration">⌁</div><b>No Android device detected</b><p>'+esc(d.message||'Connect your phone with USB debugging enabled, then check again.')+'</p></div>'
    }
    catch(e) {
        if(!quiet) {
            $('#device-list').textContent=e.message;
            $('#device-summary').textContent='Device status unavailable.';
            $('#adb-chip').textContent='Error'
        }
        throw e
    }
}
$('#run-check').addEventListener('click', async()=> {
    const b=$('#run-check');b.disabled=true;b.innerHTML='Checking…';try {
        await loadDevices();toast('Device check complete.')
    }
    catch(e) {
        toast(e.message)
    }
    finally {
        b.disabled=false;b.innerHTML='⌁ <span>Run device check</span>'
    }
}
);
$('#retry-device').addEventListener('click', ()=>$('#run-check').click());
function recordingRow(f) {
    return '<div class="recording-row"><span class="video-icon">▶</span><div class="recording-main"><b>'+esc(f.name)+'</b><small>'+size(f.size)+' · '+esc(date(f.modified))+' · '+esc(ago(f.modified))+'</small></div><div class="recording-actions"><button class="file-action" data-file-action="open" data-filename="'+esc(f.name)+'" title="Open video">▶ Open</button><button class="file-action" data-file-action="reveal" data-filename="'+esc(f.name)+'" title="Show in folder">⌕ Folder</button></div></div>'
}
function recentRow(f) {
    return '<div class="recent-item"><span class="video-icon">▶</span><div class="recent-file"><b>'+esc(f.name)+'</b><small>'+size(f.size)+' · '+esc(ago(f.modified))+'</small></div><button class="file-action" data-file-action="open" data-filename="'+esc(f.name)+'">Open</button></div>'
}
async function loadFiles(quiet=false) {
    try {
        const d=await api('/recordings');
        recordingFiles=d.files||[];
        const total=Number(d.totalSize)||0;
        $('#nav-recording-count').textContent=String(recordingFiles.length);
        $('#metric-recordings').textContent=String(recordingFiles.length);
        $('#metric-storage').textContent=size(total)+' stored locally';
        $('#recording-count').textContent=String(recordingFiles.length);
        $('#recording-total').textContent=size(total);
        $('#recent-summary').textContent=recordingFiles.length+' video file(s) · '+size(total);
        renderRecordingLibrary();
        await recent()
    }
    catch(e) {
        if(!quiet)$('#recording-list').textContent='Could not load recordings: '+e.message;
        throw e
    }
}
async function recent() {
    try {
        const d=await api('/recordings');
        const files=d.files||[];
        $('#recent-list').innerHTML=files.length?files.slice(0, 4).map(recentRow).join(''):'<div class="empty-state">No recordings yet. Start a recording and your saved MP4 will appear here.</div>'
    }
    catch {
        $('#recent-list').textContent='Could not load recordings.'
    }
}
async function openFolder() {
    try {
        await api('/open-recordings', {
            method:'POST', body:'{}'
        }
        );
        toast('Opened the Recordings folder.')
    }
    catch(e) {
        toast(e.message)
    }
}
$('#open-recordings').addEventListener('click', openFolder);
$('#open-recordings-page').addEventListener('click', openFolder);
$('#reload-recordings').addEventListener('click', async()=> {
    const b=$('#reload-recordings');b.disabled=true;try {
        await loadFiles();toast('Library refreshed.')
    }
    catch(e) {
        toast(e.message)
    }
    finally {
        b.disabled=false
    }
}
);
document.addEventListener('click', async e=> {
    const b=e.target.closest('[data-file-action]');if(!b)return;const filename=b.dataset.filename;try {
        const path=b.dataset.fileAction==='reveal'?'/reveal-recording':'/open-recording';await api(path, {
            method:'POST', body:JSON.stringify( {
                name:filename
            }
            )
        }
        );if(b.dataset.fileAction==='open')toast('Opening '+filename);else toast('Showing file in its folder.')
    }
    catch(err) {
        toast(err.message)
    }
}
);
async function loadSettings() {
    try {
        const d=await api('/settings');
        const f=$('#settings-form');
        f.elements.maxSize.value=String(d.settings.maxSize);
        f.elements.maxFps.value=String(d.settings.maxFps);
        f.elements.bitrate.value=d.settings.bitrate;
        f.elements.audio.checked=!!d.settings.audio;
        $('#settings-message').textContent='Your saved preferences are loaded.'
    }
    catch(e) {
        $('#settings-message').textContent='Could not load settings: '+e.message
    }
}
async function saveSettings() {
    const f=$('#settings-form');
    const seq=++settingsSaveSequence;
    const s= {
        maxSize:Number(f.elements.maxSize.value), maxFps:Number(f.elements.maxFps.value), bitrate:f.elements.bitrate.value, audio:f.elements.audio.checked
    }
    ;
    $('#settings-message').textContent='Saving changes…';
    try {
        await api('/settings', {
            method:'POST', body:JSON.stringify(s)
        }
        );
        if(seq===settingsSaveSequence) {
            $('#settings-message').textContent='✓ All changes saved automatically.';
            toast('Preferences saved.')
        }
    }
    catch(e) {
        if(seq===settingsSaveSequence) {
            $('#settings-message').textContent='Save failed: '+e.message;
            toast('Could not save preferences. '+e.message)
        }
    }
}
$('#settings-form').addEventListener('change', ()=> {
    clearTimeout(settingsSaveTimer);settingsSaveTimer=setTimeout(saveSettings, 200)
}
);
$('#settings-form').addEventListener('submit', e=> {
    e.preventDefault();clearTimeout(settingsSaveTimer);saveSettings()
}
);
$('#cleanup').addEventListener('click', async()=> {
    const days=Number($('#cleanup-days').value);const button=$('#cleanup');button.disabled=true;try {
        const preview=await api('/cleanup-preview?days='+days);if(!preview.files.length) {
            $('#cleanup-result').textContent='No recordings older than '+days+' days were found.';return
        }
        const total=preview.files.reduce((sum, f)=>sum+Number(f.size||0), 0);const names=preview.files.slice(0, 8).map(f=>f.name).join('\n');const more=preview.files.length>8?'\n…and '+(preview.files.length-8)+' more':'';if(!confirm('Delete '+preview.files.length+' recording(s) older than '+days+' days ('+size(total)+')?\n\n'+names+more+'\n\nThis cannot be undone.'))return;const result=await api('/cleanup', {
            method:'POST', body:JSON.stringify( {
                days, confirm:true
            }
            )
        }
        );$('#cleanup-result').textContent='Removed '+result.deleted+' file(s), freed '+size(result.freed)+'.';toast('Cleanup complete.');await loadFiles()
    }
    catch(e) {
        $('#cleanup-result').textContent=e.message;toast(e.message)
    }
    finally {
        button.disabled=false
    }
}
);
async function refreshQuietly() {
    try {
        await loadStatus()
    }
    catch {
    }
}
loadStatus().catch(()=> {
}
);
setInterval(()=> {
    if(document.visibilityState==='visible')refreshQuietly()
}
, 5000);
document.addEventListener('visibilitychange', ()=> {
    if(document.visibilityState==='visible')refreshQuietly()
}
);


/* ── Library controls and command palette ── */
let libraryQuery = '';
let librarySort = 'newest';
function ensureLibraryControls() {
    const list = $('#recording-list');
    if (!list || $('#library-tools')) return;
    const tools = document.createElement('div');
    tools.id = 'library-tools';
    tools.className = 'library-tools';
    tools.innerHTML = '<label class="library-search"><span aria-hidden="true">⌕</span><input id="library-search-input" type="search" placeholder="Search recordings by filename…" autocomplete="off" aria-label="Search recordings"></label><label class="library-sort-label">Sort by <select id="library-sort" aria-label="Sort recordings"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="largest">Largest file</option><option value="smallest">Smallest file</option><option value="name">Filename A–Z</option></select></label><span id="library-result-count" class="library-result-count"></span>';
    list.parentNode.insertBefore(tools, list);
    $('#library-search-input').addEventListener('input', e => { libraryQuery = e.target.value.trim().toLowerCase(); renderRecordingLibrary(); });
    $('#library-sort').addEventListener('change', e => { librarySort = e.target.value; renderRecordingLibrary(); });
}
function renderRecordingLibrary() {
    const list = $('#recording-list');
    if (!list) return;
    ensureLibraryControls();
    let files = recordingFiles.filter(f => String(f.name || '').toLowerCase().includes(libraryQuery));
    files = [...files].sort((a,b) => {
        if (librarySort === 'oldest') return new Date(a.modified) - new Date(b.modified);
        if (librarySort === 'largest') return Number(b.size || 0) - Number(a.size || 0);
        if (librarySort === 'smallest') return Number(a.size || 0) - Number(b.size || 0);
        if (librarySort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), undefined, {numeric:true, sensitivity:'base'});
        return new Date(b.modified) - new Date(a.modified);
    });
    const count = $('#library-result-count');
    if (count) count.textContent = files.length + ' of ' + recordingFiles.length + ' files';
    if (files.length) list.innerHTML = files.map(recordingRow).join('');
    else if (recordingFiles.length) list.innerHTML = '<div class="no-recordings"><div class="empty-illustration">⌕</div><b>No matching recordings</b><p>Try another filename or clear the search field.</p><button class="secondary-button" id="clear-library-search">Clear search</button></div>';
    else list.innerHTML = '<div class="no-recordings"><div class="empty-illustration">▤</div><b>No recordings yet</b><p>Start a recording from Overview. Finished MKV and MP4 files appear here automatically.</p></div>';
    const clear = $('#clear-library-search');
    if (clear) clear.addEventListener('click', () => { libraryQuery=''; const input=$('#library-search-input'); if(input) input.value=''; renderRecordingLibrary(); });
}
function setupCommandPalette() {
    if ($('#command-palette')) return;
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.id = 'command-launcher';
    launcher.className = 'command-launcher';
    launcher.innerHTML = '<span aria-hidden="true">⌕</span><span>Quick jump or run a command</span><kbd>Ctrl K</kbd>';
    launcher.setAttribute('aria-label', 'Open command palette');
    const actions = $('.topbar-actions');
    if (actions) actions.insertBefore(launcher, $('#refresh'));
    const overlay = document.createElement('div');
    overlay.id = 'command-palette';
    overlay.className = 'command-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<section class="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title"><div class="command-search-row"><span aria-hidden="true">⌕</span><input id="command-search" type="search" placeholder="Search pages and actions…" autocomplete="off" aria-label="Search commands"><kbd>ESC</kbd></div><div class="command-heading" id="command-title">QUICK ACTIONS</div><div id="command-results" class="command-results"></div><div class="command-footer"><span>Navigate with ↑ ↓</span><span>Enter to run · Esc to close</span></div></section>';
    document.body.appendChild(overlay);
    const commands = [
      {label:'Go to Overview', detail:'Dashboard and live sessions', keys:'Alt 1', run:()=>view('home')},
      {label:'Open recording library', detail:'Search, sort, and open saved videos', keys:'Alt 2', run:()=>view('recordings')},
      {label:'Open Settings', detail:'Capture quality and audio preferences', keys:'Alt 3', run:()=>view('settings')},
      {label:'Device diagnostics', detail:'Check ADB connection and authorization', keys:'Alt 4', run:()=>view('device')},
      {label:'Start phone mirroring', detail:'Launch a scrcpy mirror window', keys:'', run:()=>action('mirror')},
      {label:'Start screen recording', detail:'Mirror and record in one session', keys:'', run:()=>action('record')},
      {label:'Stop toolkit sessions', detail:'Gracefully close toolkit scrcpy windows', keys:'', run:()=>action('stop')},
      {label:'Run device check', detail:'Refresh Android device connection status', keys:'', run:()=>{view('device');$('#run-check').click()}},
      {label:'Open recordings folder', detail:'Show saved videos in File Explorer', keys:'', run:()=>openFolder()},
      {label:'Refresh dashboard', detail:'Update devices, recordings, and sessions', keys:'', run:()=>{loadStatus();recent();toast('Dashboard refreshed.')}} 
    ];
    let selected = 0;
    let filtered = commands;
    const input = $('#command-search');
    const results = $('#command-results');
    function paint() {
      const q=input.value.trim().toLowerCase();
      filtered=commands.filter(c=>(c.label+' '+c.detail).toLowerCase().includes(q));
      selected=Math.min(selected,Math.max(0,filtered.length-1));
      results.innerHTML=filtered.length?filtered.map((c,i)=>'<button type="button" class="command-item '+(i===selected?'selected':'')+'" data-command-index="'+i+'"><span class="command-item-icon">'+(i<4?'↗':'⌘')+'</span><span class="command-item-copy"><b>'+esc(c.label)+'</b><small>'+esc(c.detail)+'</small></span><kbd>'+esc(c.keys||'Run')+'</kbd></button>').join(''):'<div class="command-no-results">No matching commands. Try “recording” or “device”.</div>';
      results.querySelectorAll('[data-command-index]').forEach(b=>b.addEventListener('click',()=>execute(Number(b.dataset.commandIndex))));
    }
    function open() { overlay.hidden=false; input.value=''; selected=0; paint(); setTimeout(()=>input.focus(),0); }
    function close() { overlay.hidden=true; if(launcher) launcher.blur(); }
    function execute(i) { const command=filtered[i]; if(!command)return; close(); command.run(); }
    launcher.addEventListener('click',open);
    overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    input.addEventListener('input',()=>{selected=0;paint();});
    input.addEventListener('keydown',e=>{
      if(e.key==='ArrowDown'){e.preventDefault();selected=Math.min(selected+1,filtered.length-1);paint();}
      else if(e.key==='ArrowUp'){e.preventDefault();selected=Math.max(0,selected-1);paint();}
      else if(e.key==='Enter'){e.preventDefault();execute(selected);}
      else if(e.key==='Escape')close();
    });
    document.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open();return;}
      if(e.key==='Escape'&&!overlay.hidden){close();return;}
      if(e.altKey&&!e.ctrlKey&&!e.metaKey){
        const pages={'1':'home','2':'recordings','3':'settings','4':'device'};
        if(pages[e.key]&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();view(pages[e.key]);}
      }
    });
    paint();
}
setupCommandPalette();
ensureLibraryControls();
