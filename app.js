const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const mysql = require('mysql2/promise');


const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const PUBLIC_DIR = path.join(__dirname, 'public');
const BACKUP_DIR = path.join(PUBLIC_DIR, 'backup', 'database');
fs.mkdirSync(BACKUP_DIR, { recursive: true });


app.use(express.static(PUBLIC_DIR));


const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });


// Map clientId -> ws
const clients = new Map();


wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(String(raw || '{}'));
            if (msg.type === 'register' && msg.clientId) {
                clients.set(msg.clientId, ws);
                ws.clientId = msg.clientId;
                ws.send(JSON.stringify({ type: 'registered', clientId: msg.clientId }));
            }
        } catch (_) { }
    });
    ws.on('close', () => {
        if (ws.clientId) clients.delete(ws.clientId);
    });
});
function emitProgress(clientId, payload) {
    const ws = clients.get(clientId);
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'progress', ...payload }));
    }
}


// Helper to format timestamps
function stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}


// Escape identifiers like table names using backticks
function qid(name) {
    return '`' + String(name).replace(/`/g, '``') + '`';
}


// Convert a row object to value list using mysql2 format/escape
function valuesClause(conn, row) {
    const cols = Object.keys(row);
    const vals = cols.map((k) => conn.escape(row[k])).join(', ');
    return '(' + vals + ')';
}

async function backupDatabase({ host, user, password, database }, clientId) {
    const title = `Backup DB ${database}`;
    emitProgress(clientId, { stage: 'start', percent: 2, message: 'Memulai proses backup…' });


    // Create a new pool based on provided credentials
    const pool = mysql.createPool({
        host,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 4,
        namedPlaceholders: true,
        timezone: 'Z',
    });


    let conn;
    try {
        emitProgress(clientId, { stage: 'connect', percent: 5, message: 'Mengecek koneksi database…' });
        conn = await pool.getConnection();
        await conn.query('SELECT 1');
        emitProgress(clientId, { stage: 'connect', percent: 10, message: 'Koneksi sukses. Mulai backup struktur…' });


        // Get table list
        const [tablesRows] = await conn.query(
            "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            [database]
        );


        const tables = tablesRows.filter(r => r.TABLE_TYPE === 'BASE TABLE').map(r => r.TABLE_NAME);


        const ts = stamp();
        const schemaFile = path.join(BACKUP_DIR, `${database}_schema_${ts}.sql`);
        const dataFile = path.join(BACKUP_DIR, `${database}_data_${ts}.sql`);


        const schemaOut = fs.createWriteStream(schemaFile, { encoding: 'utf8' });
        const dataOut = fs.createWriteStream(dataFile, { encoding: 'utf8' });


        // Header
        const header = [
            '-- --------------------------------------------------',
            `-- Backup for database: ${database}`,
            `-- Generated at: ${new Date().toISOString()}`,
            '-- Engine: Node.js + mysql2',
            '-- --------------------------------------------------',
            'SET NAMES utf8mb4;',
            'SET FOREIGN_KEY_CHECKS=0;',
            '',
        ].join('\n');


        schemaOut.write(header + '\n');


        // ===== Backup schema =====
        let doneTables = 0;
        for (const tbl of tables) {
            const [createRows] = await conn.query(`SHOW CREATE TABLE ${qid(tbl)}`);
            const createSql = createRows[0]['Create Table'];
            schemaOut.write(`\n-- Table structure for ${qid(tbl)}\n`);
            schemaOut.write(`DROP TABLE IF EXISTS ${qid(tbl)};\n`);
            schemaOut.write(createSql + ';\n');
            doneTables++;
            const percent = 10 + Math.round((doneTables / Math.max(1, tables.length)) * 35); // upto 45%
            emitProgress(clientId, { stage: 'schema', percent, message: `Struktur: ${doneTables}/${tables.length} (${tbl})` });
        }


        schemaOut.write('\nSET FOREIGN_KEY_CHECKS=1;\n');
        schemaOut.end();


        // ===== Backup data =====
        emitProgress(clientId, { stage: 'data', percent: 46, message: 'Mulai backup data…' });
        dataOut.write(header + '\n');
        let tableIdx = 0;
        for (const tbl of tables) {
            tableIdx++;
            dataOut.write(`\n-- Data for ${qid(tbl)}\n`);
            dataOut.write(`LOCK TABLES ${qid(tbl)} WRITE;\n`);
            dataOut.write(`ALTER TABLE ${qid(tbl)} DISABLE KEYS;\n`);


            // Count rows to estimate progress
            const [[{ cnt }]] = await conn.query(`SELECT COUNT(*) AS cnt FROM ${qid(tbl)}`);


            const batchSize = 1000; // reasonable chunking
            let offset = 0;
            let written = 0;


            while (offset < cnt) {
                const [rows] = await conn.query(`SELECT * FROM ${qid(tbl)} LIMIT ? OFFSET ?`, [batchSize, offset]);
                if (!rows.length) break;


                // Compose batched INSERTS
                const cols = Object.keys(rows[0]).map(c => qid(c)).join(', ');
                const values = rows.map(r => valuesClause(conn, r)).join(',\n');
                dataOut.write(`INSERT INTO ${qid(tbl)} (${cols}) VALUES\n${values};\n`);


                offset += rows.length;
                written += rows.length;
                // Progress estimate for data: 46% -> 99%
                const perTable = written / Math.max(1, cnt);
                const acrossTables = (tableIdx - 1 + perTable) / Math.max(1, tables.length);
                const percent = 46 + Math.floor(acrossTables * 53); // 46..99
                emitProgress(clientId, {
                    stage: 'data',
                    percent,
                    message: `Data: ${tbl} ${written}/${cnt}`,
                });
            }


            dataOut.write(`ALTER TABLE ${qid(tbl)} ENABLE KEYS;\n`);
            dataOut.write('UNLOCK TABLES;\n');
        }


        dataOut.write('\nSET FOREIGN_KEY_CHECKS=1;\n');
        dataOut.end();


        emitProgress(clientId, {
            stage: 'done', percent: 100, message: 'Backup selesai.', files: {
                schema: path.relative(PUBLIC_DIR, schemaFile).replace(/\\/g, '/'),
                data: path.relative(PUBLIC_DIR, dataFile).replace(/\\/g, '/'),
            }
        });
    } catch (err) {
        emitProgress(clientId, { stage: 'error', percent: 0, message: 'Error: ' + (err && err.message ? err.message : String(err)) });
        throw err;
    } finally {
        if (conn) conn.release();
        // drain pool
        try { await (await pool.getConnection()).release(); } catch (_) { }
        try { await pool.end(); } catch (_) { }
    }
}
app.post('/api/backup', async (req, res) => {
    const { host, user, password, database, clientId } = req.body || {};
    if (!host || !user || !database || !clientId) {
        return res.status(400).json({ ok: false, error: 'Field host, user, database, clientId wajib diisi.' });
    }


    // fire and forget (progress via WS)
    setImmediate(() => backupDatabase({ host, user, password, database }, clientId).catch(() => { }));


    res.json({ ok: true, message: 'Backup dimulai.' });
});
app.get('/api/backups', async (req, res) => {
    try {
        const files = await fs.promises.readdir(BACKUP_DIR);
        // Contoh nama file: dbku_schema_20251016_091234.sql  /  dbku_data_20251016_091234.sql
        const items = files
            .filter(f => f.endsWith('.sql'))
            .map(f => {
                const m = f.match(/^(.+?)_(schema|data)_(\d{8}_\d{6})\.sql$/i);
                if (!m) return null;
                const [, dbname, kind, ts] = m; // ts: YYYYMMDD_HHMMSS
                const y = ts.slice(0, 4), mo = ts.slice(4, 6), d = ts.slice(6, 8),
                    hh = ts.slice(9, 11), mm = ts.slice(11, 13), ss = ts.slice(13, 15);
                const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`;
                return {
                    db: dbname,
                    type: kind === 'schema' ? 'Struktur' : 'Data',
                    tsRaw: ts,
                    tsISO: iso,
                    tsDisplay: `${d}-${mo}-${y} ${hh}:${mm}:${ss}`,
                    filename: f,
                    url: `/backup/database/${f}`
                };
            })
            .filter(Boolean)
            // urutkan terbaru dulu
            .sort((a, b) => (a.tsISO > b.tsISO ? -1 : 1));

        res.json({ ok: true, items });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err.message || err) });
    }
});

// === DELETE BACKUP ===
app.delete('/api/backups', async (req, res) => {
    try {
        const { file } = req.query; // ?file=nama.sql
        if (!file || typeof file !== 'string') {
            return res.status(400).json({ ok: false, error: 'Parameter ?file wajib.' });
        }
        // Hardening: hanya boleh hapus file di BACKUP_DIR, tidak boleh traversal
        if (file.includes('..') || file.includes('/') || file.includes('\\')) {
            return res.status(400).json({ ok: false, error: 'Nama file tidak valid.' });
        }
        const full = path.join(BACKUP_DIR, file);
        // pastikan file berada di dalam BACKUP_DIR
        if (!full.startsWith(BACKUP_DIR)) {
            return res.status(400).json({ ok: false, error: 'Path tidak valid.' });
        }
        await fs.promises.unlink(full);
        res.json({ ok: true, message: 'File dihapus.' });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err.message || err) });
    }
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});