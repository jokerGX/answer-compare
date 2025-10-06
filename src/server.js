require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const cors = require('cors');

const {
  getOrCreateUser,
  findOrCreateGroupForQuestion,
  storeOptions,
  storeAnswer,
  listGroupsWithDetails,
  normalizeQuestionText,
  clearAllData
} = require('./db');

const { extractQAFromImage, getEmbedding } = require('./openai');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigin = process.env.FRONTEND_ORIGIN || true; // true for local dev
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

const uploadsDir = path.resolve(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${unique}${ext}`);
  }
});
const upload = multer({ storage });

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

app.post('/api/login', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const user = getOrCreateUser(name);
    req.session.user = { id: user.id, name: user.name };
    res.json({ user: req.session.user });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Login failed' });
  }
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post('/api/upload', requireAuth, upload.array('screenshots', 10), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const user = req.session.user;
  const results = [];
  try {
    for (const file of files) {
      const { items } = await extractQAFromImage(file.path);
      for (const item of items) {
        const questionText = normalizeQuestionText(item.questionText);
        const embedding = await getEmbedding(questionText);
        const groupId = findOrCreateGroupForQuestion({ questionText, embedding, userId: user.id });
        if (Array.isArray(item.options) && item.options.length > 0) {
          storeOptions(groupId, item.options);
        }
        storeAnswer(groupId, user.id, item.chosenAnswers);
        results.push({ groupId, questionText, chosenAnswers: item.chosenAnswers });
      }
    }
    res.json({ ok: true, processed: results.length, items: results });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Extraction failed' });
  }
});

app.get('/api/groups', (_req, res) => {
  const groups = listGroupsWithDetails();
  res.json({ groups });
});

app.post('/api/clear-all', (_req, res) => {
  clearAllData();
  res.json({ ok: true });
});

const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


