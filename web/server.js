'use strict';

const express         = require('express');
const multer          = require('multer');
const { v4: uuidv4 } = require('uuid');
const path            = require('path');
const fs              = require('fs');
const { finalize } = require('./finalize');
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
// Local single-owner console: expose through an authenticated reverse proxy only.
app.use((req, res, next) => {
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.sendStatus(403);
  next();
});
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
    const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-preview-'));
    try {
      await execFileAsync('python3', [path.join(SCRIPTS_DIR, 'safe_zip.py'), zipPath, checkDir], {timeout:60_000, maxBuffer:1024*1024, env:{PATH:process.env.PATH}});
    } finally { fs.rmSync(checkDir, {recursive:true, force:true}); }
    const info = await extractPreview(zipPath);
    res.json({ previewId, zipName, ...info });
  } catch (err) {
    previews.delete(previewId);
    try { fs.unlinkSync(zipPath); } catch {}
    res.status(400).json({error: 'Archive rejected or preview limits exceeded'});
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

  if ([...builds.values()].some(b => b.status === 'RUNNING')) return res.status(409).json({error: 'One build at a time'});
  const buildId   = uuidv4();
  const outputDir = path.join(OUTPUT_DIR, buildId);
  const logPath   = path.join(UPLOAD_DIR, `${buildId}.log`);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  if (process.getuid() === 0) fs.chownSync(outputDir, 1000, 1000);
  else if (process.getuid() !== 1000) return res.status(503).json({error: 'Host workspace must be owned by uid 1000'});
  fs.chmodSync(zipPath, 0o444);

  builds.set(buildId, {
    id: buildId, status: 'RUNNING',
    zipPath, zipName, outputDir, logPath,
    apks: [], aabs: [], errors: [], signingAuthorized: req.body?.authorizeSigning === 'true',
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

  if (!['SUCCESS', 'PARTIAL'].includes(build.status) || ![...build.apks, ...build.aabs].includes(filePath) || !fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink())
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
    apks: b.apks.map(f => ({ name: path.basename(f), size: _fileSize(f), sha256: b.verified?.find(a => a.name === path.basename(f))?.sha256, status: 'VERIFIED' })),
    aabs: b.aabs.map(f => ({ name: path.basename(f), size: _fileSize(f), sha256: b.verified?.find(a => a.name === path.basename(f))?.sha256, status: 'VERIFIED' })),
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
  if (fs.existsSync(build.logPath) && fs.statSync(build.logPath).size > 10*1024*1024) return;
  fs.appendFileSync(build.logPath, line + '\n', {mode:0o600});
  _broadcast(build, { type: 'log', line });
}

function _runBuild(buildId) {
  const build = builds.get(buildId);
  _log(build, `[Builder] Build ${buildId}`);
  _log(build, `[Builder] Source: ${build.zipName}`);
  _log(build, '─'.repeat(60));

  // No API/Firebase/GitHub/signing credentials enter the untrusted process.
  const containerName = `dual-build-${buildId}`;
  const proc = spawn('docker', ['run', '--rm', '--name', containerName,
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--init',
    '--user', '1000:1000',
    '--memory=4g', '--memory-swap=4g', '--cpus=2', '--pids-limit=512',
    '--ulimit', 'fsize=2147483648:2147483648', '--network=none',
    '--tmpfs', '/tmp:size=2g,exec,mode=1777',
    '--volume', `${path.resolve(build.zipPath)}:/input/project.zip:ro`,
    '--volume', `${path.resolve(build.outputDir)}:/output:rw`,
    '--env', 'BUILD_SANDBOX=true', '--env', 'STAGE_UNSIGNED_RELEASE=true', '--env', 'GRADLE_USER_HOME=/tmp/gradle',
    '--env', 'HOME=/tmp/home', '--env', 'OUTPUT_DIR=/output',
    process.env.BUILDER_IMAGE || 'android-builder:local', '/input/project.zip'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  let aborted = false;
  const stop = () => {
    aborted = true;
    spawn('docker', ['rm', '--force', containerName], {stdio: 'ignore'}).on('error', () => {});
    proc.kill('SIGTERM');
  };
  const timer = setTimeout(stop, 25 * 60 * 1000);
  const diskTimer = setInterval(() => {
    try {
      const bytes = fs.readdirSync(build.outputDir).reduce((n, f) => n + fs.lstatSync(path.join(build.outputDir, f)).size, 0);
      if (bytes > 4 * 1024 ** 3) stop();
    } catch { stop(); }
  }, 1000);
  proc.on('error', () => {
    clearTimeout(timer); clearInterval(diskTimer);
    build.status = 'FAILED'; build.finishedAt = Date.now();
    build.errors = ['Docker unavailable: isolated build was not started'];
    _broadcast(build, {type: 'result', build: _buildSummary(build)});
    build.sseClients.forEach(c => c.end()); build.sseClients.clear();
    try { fs.unlinkSync(build.zipPath); } catch {}
  });

  const onLine = chunk =>
    chunk.toString().split('\n').forEach(l => { if (l) _log(build, l); });

  proc.stdout.on('data', onLine);
  proc.stderr.on('data', onLine);

  proc.on('close', async exitCode => {
    _log(build, '─'.repeat(60));
    _log(build, `[Builder] Process exited (${exitCode})`);

    clearTimeout(timer); clearInterval(diskTimer);
    build.apks = []; build.aabs = [];
    const rawDir = build.outputDir;
    try {
      if (exitCode !== 0 || aborted) throw new Error('Build failed or interrupted');
      const result = await finalize(build.outputDir, SCRIPTS_DIR, build.signingAuthorized);
      build.outputDir = result.directory;
      build.verified = result.verified;
      build.apks = result.verified.filter(a => a.name.endsWith('.apk')).map(a => path.join(result.directory, a.name));
      build.aabs = result.verified.filter(a => a.name.endsWith('.aab')).map(a => path.join(result.directory, a.name));
      build.status = 'SUCCESS';
    } catch (err) {
      build.status = 'FAILED'; build.errors = [err.message]; build.apks = []; build.aabs = [];
    } finally {
      fs.rmSync(rawDir, {recursive:true, force:true});
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
    let bytes = 0;
    const timer = setTimeout(() => proc.kill('SIGKILL'), 10_000);
    proc.once('close', () => clearTimeout(timer));
    proc.once('error', () => clearTimeout(timer));
    proc.stdout.on('data', d => { bytes += d.length; if(bytes > 4*1024*1024) proc.kill('SIGKILL'); else bufs.push(d); });
    proc.on('close', code => resolve(code === 0 ? Buffer.concat(bufs).toString('utf8') : ''));
    proc.on('error', () => resolve(''));
  });
}

function runCmdBin(cmd, args) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args);
    const bufs = [];
    let bytes = 0;
    const timer = setTimeout(() => proc.kill('SIGKILL'), 10_000);
    proc.once('close', () => clearTimeout(timer));
    proc.once('error', () => clearTimeout(timer));
    proc.stdout.on('data', d => { bytes += d.length; if(bytes > 4*1024*1024) proc.kill('SIGKILL'); else bufs.push(d); });
    proc.on('close', code => resolve(code === 0 ? Buffer.concat(bufs) : Buffer.alloc(0)));
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
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Android Builder UI  →  http://localhost:${PORT}\n`);
});
