const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.resolve(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_groups (
  id INTEGER PRIMARY KEY,
  canonical_question TEXT NOT NULL,
  canonical_embedding TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_variants (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(group_id) REFERENCES question_groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS answer_options (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  option_text TEXT NOT NULL,
  UNIQUE(group_id, option_text),
  FOREIGN KEY(group_id) REFERENCES question_groups(id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  chosen_answer TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id) ON CONFLICT REPLACE,
  FOREIGN KEY(group_id) REFERENCES question_groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

function normalizeQuestionText(text) {
  if (!text) return '';
  const withoutNumbers = String(text).replace(/^\s*\d+\s*[\).:-]\s*/i, '');
  return withoutNumbers.trim().toLowerCase();
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const stmts = {
  insertUser: db.prepare('INSERT OR IGNORE INTO users (name) VALUES (?)'),
  getUserByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  insertGroup: db.prepare('INSERT INTO question_groups (canonical_question, canonical_embedding) VALUES (?, ?)'),
  getAllGroups: db.prepare('SELECT * FROM question_groups'),
  insertVariant: db.prepare('INSERT INTO question_variants (group_id, user_id, question_text) VALUES (?, ?, ?)'),
  insertOption: db.prepare('INSERT OR IGNORE INTO answer_options (group_id, option_text) VALUES (?, ?)'),
  upsertAnswer: db.prepare('INSERT INTO answers (group_id, user_id, chosen_answer) VALUES (?, ?, ?) ON CONFLICT(group_id, user_id) DO UPDATE SET chosen_answer=excluded.chosen_answer'),
  getGroupsJoined: db.prepare(`
    SELECT g.id as group_id, g.canonical_question, g.canonical_embedding,
           a.user_id as answer_user_id, u.name as user_name, a.chosen_answer,
           v.user_id as variant_user_id, v.question_text as variant_text,
           o.option_text
    FROM question_groups g
    LEFT JOIN answers a ON a.group_id = g.id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN question_variants v ON v.group_id = g.id AND v.user_id = a.user_id
    LEFT JOIN answer_options o ON o.group_id = g.id
    ORDER BY g.id ASC
  `)
};

function getOrCreateUser(name) {
  const trimmed = String(name || '').trim();
  if (trimmed.length === 0) {
    throw new Error('Name required');
  }
  stmts.insertUser.run(trimmed);
  const user = stmts.getUserByName.get(trimmed);
  return user;
}

function findOrCreateGroupForQuestion({ questionText, embedding, userId }) {
  const normalized = normalizeQuestionText(questionText);
  const all = stmts.getAllGroups.all();
  let best = { id: null, score: -1 };
  for (const row of all) {
    try {
      const emb = JSON.parse(row.canonical_embedding);
      const score = cosineSimilarity(embedding, emb);
      if (score > best.score) best = { id: row.id, score };
    } catch (_) {
      // ignore parse errors
    }
  }
  let groupId;
  if (best.id && best.score >= 0.97) {
    groupId = best.id;
  } else {
    const info = stmts.insertGroup.run(normalized, JSON.stringify(embedding));
    groupId = info.lastInsertRowid;
  }
  if (userId) {
    stmts.insertVariant.run(groupId, userId, normalized);
  }
  return groupId;
}

function storeOptions(groupId, options) {
  if (!Array.isArray(options)) return;
  for (const opt of options) {
    const cleaned = String(opt || '').trim();
    if (cleaned) stmts.insertOption.run(groupId, cleaned);
  }
}

function storeAnswer(groupId, userId, chosenAnswers) {
  let value;
  if (Array.isArray(chosenAnswers)) {
    const parts = chosenAnswers.map(s => String(s || '').trim()).filter(Boolean).sort();
    value = parts.join(' | ');
  } else {
    value = String(chosenAnswers || '').trim();
  }
  stmts.upsertAnswer.run(groupId, userId, value);
}

function listGroupsWithDetails() {
  const rows = stmts.getGroupsJoined.all();
  const byId = new Map();
  for (const r of rows) {
    let g = byId.get(r.group_id);
    if (!g) {
      g = {
        id: r.group_id,
        canonicalQuestion: r.canonical_question,
        options: new Set(),
        answersByUserId: new Map(),
        variantByUserId: new Map()
      };
      byId.set(r.group_id, g);
    }
    if (r.option_text) g.options.add(r.option_text);
    if (r.answer_user_id && r.user_name) {
      g.answersByUserId.set(r.answer_user_id, { userName: r.user_name, chosenAnswer: r.chosen_answer });
    }
    if (r.variant_user_id && r.user_name && r.variant_text) {
      const matchesCanonical = String(r.variant_text || '') === String(g.canonicalQuestion || '');
      g.variantByUserId.set(r.variant_user_id, { userName: r.user_name, questionText: r.variant_text, matchesCanonical });
    }
  }
  const result = [];
  for (const g of byId.values()) {
    const opts = Array.from(g.options);
    const answers = Array.from(g.answersByUserId.values());
    const variants = Array.from(g.variantByUserId.values());
    const uniques = new Map();
    for (const a of answers) {
      const key = a.chosenAnswer || '';
      if (!uniques.has(key)) uniques.set(key, []);
      uniques.get(key).push(a.userName);
    }
    const conflict = uniques.size > 1;
    const differingUsers = conflict ? Array.from(uniques.values()).flat() : [];
    result.push({
      id: g.id,
      canonicalQuestion: g.canonicalQuestion,
      options: opts,
      answers,
      variants,
      conflict,
      differingUsers
    });
  }
  return result;
}

function clearAllData() {
  const trx = db.transaction(() => {
    db.exec('DELETE FROM answers');
    db.exec('DELETE FROM question_variants');
    db.exec('DELETE FROM answer_options');
    db.exec('DELETE FROM question_groups');
  });
  trx();
}

module.exports = {
  db,
  getOrCreateUser,
  findOrCreateGroupForQuestion,
  storeOptions,
  storeAnswer,
  listGroupsWithDetails,
  normalizeQuestionText,
  clearAllData
};


