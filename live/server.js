// server.js
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer  = require('multer');
const { google } = require('googleapis');
const fsExtra = require('fs-extra');
const bcrypt = require('bcrypt');
const session = require('express-session');
require('dotenv').config();
const { startFFmpeg, stopFFmpeg, getFFmpegStatus } = require('./ffmpeg_manager');

const app = express();
const db = new sqlite3.Database('./db.sqlite');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/videos', express.static('videos'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'defaultsecret',
  resave: false,
  saveUninitialized: false
}));

function authMiddleware(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

fsExtra.ensureDirSync('./videos');

// DB Setup
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      video TEXT,
      rtmp_url TEXT,
      stream_key TEXT,
      looping INTEGER,
      duration INTEGER,
      status TEXT DEFAULT 'stopped'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'user'
    )
  `);
});

// AUTH ROUTES
app.post('/auth/register', async (req, res) => {
  const { username, password, secretCode } = req.body;
  if (secretCode !== process.env.SECRET_CODE) return res.status(403).json({ error: 'Kode rahasia salah' });
  const hashed = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashed], function (err) {
    if (err) return res.status(400).json({ error: 'Username sudah digunakan' });
    res.json({ message: 'Registrasi berhasil' });
  });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'User tidak ditemukan' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(403).json({ error: 'Password salah' });
    req.session.userId = user.id;
    res.json({ message: 'Login berhasil' });
  });
});

app.post('/auth/change-password', authMiddleware, async (req, res) => {
  const { newPassword, secretCode } = req.body;
  if (secretCode !== process.env.SECRET_CODE) return res.status(403).json({ error: 'Kode rahasia salah' });
  const hashed = await bcrypt.hash(newPassword, 10);
  db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, req.session.userId], function (err) {
    if (err) return res.status(500).json({ error: 'Gagal mengganti password' });
    res.json({ message: 'Password berhasil diganti' });
  });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logout berhasil' }));
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ userId: req.session.userId });
});

// PROTECTED ROUTES BELOW THIS LINE

app.get('/api/videos', authMiddleware, (req, res) => {
  fs.readdir('./videos', (err, files) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(files.filter(f => f.endsWith('.mp4')));
  });
});

const videosDir = './videos';

app.delete('/api/videos/:filename', authMiddleware, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(videosDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  fs.unlink(filePath, err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: filename });
  });
});

app.put('/api/videos/:filename', authMiddleware, (req, res) => {
  const oldName = req.params.filename;
  const { newName } = req.body;
  if (!newName || !/^[\w\-. ]+\.mp4$/i.test(newName)) {
    return res.status(400).json({ error: 'Nama file tidak valid' });
  }
  const oldPath = path.join(videosDir, oldName);
  const newPath = path.join(videosDir, newName);
  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' });
  if (fs.existsSync(newPath)) return res.status(400).json({ error: 'Nama file sudah digunakan' });
  fs.rename(oldPath, newPath, err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ renamed: { from: oldName, to: newName } });
  });
});

app.get('/api/streams', authMiddleware, (req, res) => {
  db.all('SELECT * FROM streams', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    rows.forEach(row => {
      row.status = getFFmpegStatus(row.id) || row.status;
    });
    res.json(rows);
  });
});

app.post('/api/streams', authMiddleware, (req, res) => {
  const { title, video, rtmp_url, stream_key, looping, duration } = req.body;
  db.run(
    'INSERT INTO streams (title, video, rtmp_url, stream_key, looping, duration) VALUES (?, ?, ?, ?, ?, ?)',
    [title, video, rtmp_url, stream_key, looping ? 1 : 0, duration],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/streams/:id', authMiddleware, (req, res) => {
  const { title, video, rtmp_url, stream_key, looping, duration } = req.body;
  db.run(
    'UPDATE streams SET title = ?, video = ?, rtmp_url = ?, stream_key = ?, looping = ?, duration = ? WHERE id = ?',
    [title, video, rtmp_url, stream_key, looping ? 1 : 0, duration, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

app.delete('/api/streams/:id', authMiddleware, (req, res) => {
  stopFFmpeg(Number(req.params.id));
  db.run('DELETE FROM streams WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

app.post('/api/streams/:id/start', authMiddleware, (req, res) => {
  db.get('SELECT * FROM streams WHERE id = ?', [req.params.id], (err, stream) => {
    if (err || !stream) return res.status(404).json({ error: 'Stream not found' });
    startFFmpeg(stream.id, stream.video, stream.rtmp_url, stream.stream_key, !!stream.looping, stream.duration);
    db.run('UPDATE streams SET status = ? WHERE id = ?', ['running', stream.id]);
    res.json({ status: 'running' });
  });
});

app.post('/api/streams/:id/stop', authMiddleware, (req, res) => {
  stopFFmpeg(Number(req.params.id));
  db.run('UPDATE streams SET status = ? WHERE id = ?', ['stopped', req.params.id]);
  res.json({ status: 'stopped' });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './videos'),
  filename: (req, file, cb) => {
    let orig = file.originalname.replace(/\s+/g, '_');
    let final = orig;
    let i = 1;
    while (fs.existsSync(path.join('./videos', final))) {
      final = `${i}_${orig}`;
      i++;
    }
    cb(null, final);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) return cb(new Error('File must be a video'));
    cb(null, true);
  }
});

app.post('/api/videos/upload', authMiddleware, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');
  res.json({ filename: req.file.filename });
});

app.post('/api/videos/drive', authMiddleware, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });
  try {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return res.status(400).json({ error: 'Invalid Google Drive URL' });
    const fileId = match[1];
    const apiKey = process.env.GOOGLE_API_KEY || 'AIzaSyDpxWagZdCDKfs6uJYZehm6gAp1UGAkhRc';
    const drive = google.drive({ version: 'v3', auth: apiKey });
    const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
    if (!meta.data.mimeType.startsWith('video/')) return res.status(400).json({ error: 'File is not a video' });
    let filename = meta.data.name.replace(/\s+/g, '_');
    let savePath = path.join('./videos', filename);
    let i = 1;
    while (fs.existsSync(savePath)) {
      filename = `${i}_${meta.data.name.replace(/\s+/g, '_')}`;
      savePath = path.join('./videos', filename);
      i++;
    }
    const dest = fs.createWriteStream(savePath);
    const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      driveRes.data.pipe(dest);
      driveRes.data.on('end', resolve);
      driveRes.data.on('error', reject);
    });
    res.json({ filename });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});



const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
