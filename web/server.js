'use strict';

const express         = require('express');
const multer          = require('multer');
const { v4: uuidv4 } = require('uuid');
const path            = require('path');
const fs              = require('fs');
const { spawn }       = require('child_process');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT        || 3000;
const UPLOAD_DIR  = process.env.UPLOAD_DIR  || path.join(__dirname, '../tmp/uploads');
const OUTPUT_DIR  = process.env.OUTPUT_DIR  || path.join(__dirname, '../tmp/outputs');
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(__dirname, '../scripts');
const PUBLIC_DIR  = path.join(__dirname, '../public');

[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── In-memory stores ─────────────────────────────────────────────────────────
const builds   = new Map();   // buildId  → BuildRecord
const previews = new Map();   // previewId → PreviewRecord  (30-min TTL)

// ─── Multer setup ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uuidv4()}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits:     { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.zip'))
      return cb(new Error('Only .zip files are accepted'));
    cb(null, true);
  },
});

// ─── Expire stale previews every 5 min ───────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of previews) {
    if (p.expiresAt < now) {
      try { fs.unlinkSync(p.zipPath); } catch {}
      previews.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(PUBLIC_DIR));

// =============================================================================
// POST /api/preview  — upload ZIP → extract metadata → keep file for build
// =============================================================================
app.post('/api/preview', upload.single('zip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No ZIP file uploaded' });

  const previewId = uuidv4();
  const { path: zipPath, originalname: zipName } = req.file;

  previews.set(previewId, {
    previewId,
    zipPath,
    zipName,
    expiresAt: Date.now() + 30 * 60 * 1000,
  });

  try {
    const info = await extractPreview(zipPath);
    res.json({ previewId, zipName, ...info });
  } catch (err) {
    // Always return previewId so the build can still proceed
    res.json({ previewId, zipName, error: String(err.message) });
  }
});

// =============================================================================
// POST /api/build  — start pipeline (reuse previewId OR accept fresh upload)
// =============================================================================
app.post('/api/build', upload.single('zip'), (req, res) => {
  let zipPath, zipName;

  const previewId = req.body?.previewId;

  if (previewId) {
    const p = previews.get(previewId);
    if (!p) return res.status(400).json({ error: 'Preview expired — please re-upload the ZIP' });
    zipPath = p.zipPath;
    zipName = p.zipName;
    previews.delete(previewId);   // consume it
  } else if (req.file) {
    zipPath = req.file.path;
    zipName = req.file.originalname;
  } else {
    return res.status(400).json({ error: 'No ZIP file or previewId provided' });
  }

  const buildId   = uuidv4();
  const outputDir = path.join(OUTPUT_DIR, buildId);
  const logPath   = path.join(outputDir, 'pipeline.log');
  fs.mkdirSync(outputDir, { recursive: true });

  builds.set(buildId, {
    id: buildId, status: 'RUNNING',
    zipPath, zipName, outputDir, logPath,
    apks: [], aabs: [], errors: [],
    startedAt: Date.now(), finishedAt: null,
    sseClients: new Set(),
  });

  res.json({ buildId });
  _runBuild(buildId);
});

// =============================================================================
// GET /api/build/:id/stream  — SSE live log feed
// =============================================================================
app.get('/api/build/:id/stream', (req, res) => {
  const build = builds.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Catch-up replay for reconnects
  if (fs.existsSync(build.logPath)) {
    fs.readFileSync(build.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .forEach(line => res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`));
  }

  if (build.status !== 'RUNNING') {
    res.write(`data: ${JSON.stringify({ type: 'result', build: _buildSummary(build) })}\n\n`);
    return res.end();
  }

  build.sseClients.add(res);
  req.on('close', () => build.sseClients.delete(res));
});

// =============================================================================
// GET /api/build/:id  — JSON status
// =============================================================================
app.get('/api/build/:id', (req, res) => {
  const build = builds.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });
  res.json(_buildSummary(build));
});

// =============================================================================
// GET /api/build/:id/download/:filename  — serve artifact
// =============================================================================
app.get('/api/build/:id/download/:filename', (req, res) => {
  const build = builds.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });

  const filename = path.basename(req.params.filename);
  const filePath = path.join(build.outputDir, filename);

  if (!filePath.startsWith(build.outputDir) || !fs.existsSync(filePath))
    return res.status(404).json({ error: 'Artifact not found' });

  res.download(filePath, filename);
});

// ─── Build helpers ────────────────────────────────────────────────────────────
function _buildSummary(b) {
  const duration = b.finishedAt
    ? Math.round((b.finishedAt - b.startedAt) / 1000)
    : Math.round((Date.now()   - b.startedAt) / 1000);
  return {
    id: b.id, status: b.status, zipName: b.zipName,
    apks: b.apks.map(f => ({ name: path.basename(f), size: _fileSize(f) })),
    aabs: b.aabs.map(f => ({ name: path.basename(f), size: _fileSize(f) })),
    errors: b.errors, duration,
    startedAt: b.startedAt, finishedAt: b.finishedAt,
  };
}

function _fileSize(p) {
  try {
    const b = fs.statSync(p).size;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  } catch { return '?' }
}

function _broadcast(build, event) {
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  build.sseClients.forEach(c => {
    try { c.write(msg); } catch { build.sseClients.delete(c); }
  });
}

function _log(build, line) {
  fs.appendFileSync(build.logPath, line + '\n');
  _broadcast(build, { type: 'log', line });
}

function _runBuild(buildId) {
  const build = builds.get(buildId);
  _log(build, `[Builder] Build ${buildId}`);
  _log(build, `[Builder] Source: ${build.zipName}`);
  _log(build, '─'.repeat(60));

  const env = {
    ...process.env,
    OUTPUT_DIR:     build.outputDir,
    WORK_DIR:       `/tmp/android_build_${buildId}`,
    ANDROID_HOME:   process.env.ANDROID_HOME   || `${process.env.HOME}/android-sdk`,
    KEYSTORE_PATH:  process.env.KEYSTORE_PATH  || '',
    KEYSTORE_ALIAS: process.env.KEYSTORE_ALIAS || '',
    KEYSTORE_PASS:  process.env.KEYSTORE_PASS  || '',
  };

  const proc = spawn('bash', [path.join(SCRIPTS_DIR, 'build.sh'), build.zipPath], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onLine = chunk =>
    chunk.toString().split('\n').forEach(l => { if (l) _log(build, l); });

  proc.stdout.on('data', onLine);
  proc.stderr.on('data', onLine);

  proc.on('close', exitCode => {
    _log(build, '─'.repeat(60));
    _log(build, `[Builder] Process exited (${exitCode})`);

    try {
      const files = fs.readdirSync(build.outputDir);
      build.apks = files.filter(f => f.endsWith('.apk')).map(f => path.join(build.outputDir, f));
      build.aabs = files.filter(f => f.endsWith('.aab')).map(f => path.join(build.outputDir, f));
    } catch {}

    try {
      const logText = fs.readFileSync(build.logPath, 'utf8');
      const m = logText.match(/\{[\s\S]*?"status"\s*:\s*"(SUCCESS|PARTIAL|FAILED)"[\s\S]*?\}/);
      if (m) {
        const r = JSON.parse(m[0]);
        build.status = r.status;
        build.errors = r.errors || [];
        const resolveList = (list) => (list || []).filter(p => fs.existsSync(p));
        const ra = resolveList(r.apk);  if (ra.length) build.apks = ra;
        const rb = resolveList(r.aab);  if (rb.length) build.aabs = rb;
      } else {
        build.status = exitCode === 0
          ? (build.aabs.length ? 'SUCCESS' : build.apks.length ? 'PARTIAL' : 'FAILED')
          : 'FAILED';
      }
    } catch {
      build.status = exitCode === 0 ? 'PARTIAL' : 'FAILED';
    }

    build.finishedAt = Date.now();
    _log(build, `[Builder] Status: ${build.status}`);

    _broadcast(build, { type: 'result', build: _buildSummary(build) });
    build.sseClients.forEach(c => { try { c.end(); } catch {} });
    build.sseClients.clear();
    try { fs.unlinkSync(build.zipPath); } catch {}
  });
}

// =============================================================================
// Preview extraction
// =============================================================================
function runCmd(cmd, args) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args);
    const bufs = [];
    proc.stdout.on('data', d => bufs.push(d));
    proc.on('close', () => resolve(Buffer.concat(bufs).toString('utf8')));
    proc.on('error', () => resolve(''));
  });
}

function runCmdBin(cmd, args) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args);
    const bufs = [];
    proc.stdout.on('data', d => bufs.push(d));
    proc.on('close', () => resolve(Buffer.concat(bufs)));
    proc.on('error', () => resolve(Buffer.alloc(0)));
  });
}

async function listZipFiles(zipPath) {
  // Try zipinfo one-per-line format first
  const z1 = await runCmd('unzip', ['-Z1', zipPath]);
  const lines = z1.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length > 1) return lines;

  // Fallback: unzip -l (parse filename column)
  const ul = await runCmd('unzip', ['-l', zipPath]);
  return ul.split('\n')
    .filter(l => /^\s*\d/.test(l))
    .map(l => l.trim().split(/\s+/).slice(3).join(' '))
    .filter(Boolean);
}

async function extractPreview(zipPath) {
  const files = await listZipFiles(zipPath);

  // ── build.gradle / build.gradle.kts ──────────────────────────────────────
  const gradlePath =
    files.find(f => /\/app\/build\.gradle(\.kts)?$/.test(f)) ||
    files.find(f => /\/build\.gradle(\.kts)?$/.test(f) && !/buildSrc/.test(f));

  let packageName = '', versionName = '', versionCode = '',
      compileSdk  = '', minSdk = '', targetSdk = '', depCount = 0;

  if (gradlePath) {
    const g = await runCmd('unzip', ['-p', zipPath, gradlePath]);
    packageName = g.match(/applicationId\s*=?\s*["']([^"']+)["']/)?.[1]  || '';
    versionName = g.match(/versionName\s*=?\s*["']([^"']+)["']/)?.[1]    || '';
    versionCode = g.match(/versionCode\s*=?\s*(\d+)/)?.[1]               || '';
    compileSdk  = g.match(/compileSdk(?:Version)?\s*=?\s*(\d+)/)?.[1]    || '';
    minSdk      = g.match(/minSdk(?:Version)?\s*=?\s*(\d+)/)?.[1]        || '';
    targetSdk   = g.match(/targetSdk(?:Version)?\s*=?\s*(\d+)/)?.[1]     || '';
    depCount    = (g.match(/^\s+(implementation|api|compileOnly|runtimeOnly)\b/gm) || []).length;
  }

  // ── AndroidManifest.xml fallback ─────────────────────────────────────────
  if (!packageName) {
    const mPath = files.find(f => /AndroidManifest\.xml$/.test(f) && !/build\//.test(f));
    if (mPath) {
      const m = await runCmd('unzip', ['-p', zipPath, mPath]);
      packageName = m.match(/package="([^"]+)"/)?.[1]                  || '';
      if (!versionName) versionName = m.match(/android:versionName="([^"]+)"/)?.[1] || '';
      if (!versionCode) versionCode = m.match(/android:versionCode="([^"]+)"/)?.[1] || '';
    }
  }

  // ── strings.xml → app name ────────────────────────────────────────────────
  let appName = '';
  const strPath = files.find(f => /\/res\/values\/strings\.xml$/.test(f));
  if (strPath) {
    const s = await runCmd('unzip', ['-p', zipPath, strPath]);
    appName = s.match(/<string name="app_name">([^<]+)<\/string>/i)?.[1]?.trim() || '';
  }

  // ── App icon (highest available density, PNG or WebP) ────────────────────
  const iconPatterns = [
    /mipmap-xxxhdpi\/ic_launcher(_round)?\.(png|webp)$/i,
    /mipmap-xxhdpi\/ic_launcher(_round)?\.(png|webp)$/i,
    /mipmap-xhdpi\/ic_launcher(_round)?\.(png|webp)$/i,
    /mipmap-hdpi\/ic_launcher(_round)?\.(png|webp)$/i,
    /mipmap-mdpi\/ic_launcher(_round)?\.(png|webp)$/i,
    /drawable-xxxhdpi\/ic_launcher\.(png|webp)$/i,
    /drawable\/ic_launcher\.(png|webp)$/i,
  ];

  let icon = null;
  for (const pat of iconPatterns) {
    const iconPath = files.find(f => pat.test(f));
    if (iconPath) {
      const buf = await runCmdBin('unzip', ['-p', zipPath, iconPath]);
      if (buf.length > 128) {
        const mime = /\.webp$/i.test(iconPath) ? 'image/webp' : 'image/png';
        icon = `data:${mime};base64,${buf.toString('base64')}`;
        break;
      }
    }
  }

  // ── Source file count & estimated build time ──────────────────────────────
  const sourceFiles = files.filter(f => /\.(kt|java)$/.test(f)).length;
  const estimatedBuildTime = _estimateBuildTime(sourceFiles, depCount);

  return {
    appName, packageName, versionName, versionCode,
    compileSdk, minSdk, targetSdk,
    icon, sourceFiles, depCount,
    estimatedBuildTime,
    totalFiles: files.length,
  };
}

function _estimateBuildTime(sourceFiles, depCount) {
  const secs = 90 + sourceFiles * 2 + depCount * 3;
  const lo = Math.max(1, Math.round(secs / 60));
  const hi = Math.round(lo * 1.6);
  if (hi <= 2)  return '1–2 min';
  if (hi <= 4)  return '2–4 min';
  if (hi <= 7)  return '4–7 min';
  if (hi <= 12) return '7–12 min';
  return `${lo}–${hi} min`;
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Android Builder UI  →  http://localhost:${PORT}\n`);
});
