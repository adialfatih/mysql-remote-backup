(() => {
    const y = document.getElementById('y');
    y.textContent = new Date().getFullYear();


    // WebSocket setup
    const clientId = crypto.randomUUID();
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${location.host}/ws`);
    let wsReady = false;


    ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'register', clientId }));
    });
    ws.addEventListener('message', (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'registered') { wsReady = true; }
            if (msg.type === 'progress') updateProgress(msg);
        } catch (_) { }
    });


    const form = document.getElementById('backupForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();


        if (!wsReady) {
            Swal.fire({ icon: 'error', title: 'WebSocket belum siap', text: 'Coba refresh halaman.' });
            return;
        }
        const fd = new FormData(form);
        const payload = Object.fromEntries(fd.entries());
        payload.clientId = clientId;


        // Open SweetAlert loading with custom progress UI
        Swal.fire({
            title: 'Menjalankan Backup…',
            html: `<div id="prgWrap" style="text-align:left;">
<div id="prgMsg" style="margin-bottom:8px;">Mengecek koneksi…</div>
<div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
<div id="prgBar" style="height:100%;width:0%;background:#2563eb;transition:width .25s ease"></div>
</div>
<div id="prgPct" style="margin-top:6px;font-weight:700;">0%</div>
</div>`,
            allowOutsideClick: false,
            allowEscapeKey: false,
            didOpen: () => { Swal.showLoading(); }
        });


        try {
            const res = await fetch('/api/backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || 'Gagal memulai backup');
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Gagal memulai', text: String(err.message || err) });
        }
    });


    function updateProgress(msg) {
        const bar = document.getElementById('prgBar');
        const pct = document.getElementById('prgPct');
        const m = document.getElementById('prgMsg');
        if (!bar || !pct || !m) return;


        const p = Math.max(0, Math.min(100, Number(msg.percent || 0)));
        bar.style.width = p + '%';
        pct.textContent = p + '%';
        m.textContent = msg.message || '';


        if (msg.stage === 'done') {
            Swal.fire({
                icon: 'success',
                title: 'Backup selesai',
                html: `
<div style="text-align:left;">
<p>File hasil backup siap diunduh:</p>
<ul>
<li><a href="/${msg.files.schema}" target="_blank">Schema SQL</a></li>
<li><a href="/${msg.files.data}" target="_blank">Data SQL</a></li>
</ul>
</div>
`
            });
        }


        if (msg.stage === 'error') {
            Swal.fire({ icon: 'error', title: 'Terjadi kesalahan', text: msg.message || 'Unknown error' });
        }
    }
})();