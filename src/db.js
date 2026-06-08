'use strict';
/**
 * 数据访问层 —— 全站唯一直接接触数据库的文件。
 * 使用 libSQL 客户端(@libsql/client):
 *   - 本地开发:不设 TURSO_DATABASE_URL 时,自动落到本地 file: 文件(等同 SQLite)。
 *   - 生产/免费托管:设置 TURSO_DATABASE_URL + TURSO_AUTH_TOKEN,数据存在 Turso 云端(持久、免费档够用)。
 * libSQL 即 SQLite 方言,所有 SQL 与本地一致;接口全异步(await)。
 * 将来要换 PostgreSQL,只需改本文件。
 */
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'gesp.db');
const SEED_PATH = process.env.SEED_PATH || path.join(__dirname, '..', 'data', 'site_data.json');
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

const client = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  : createClient({ url: 'file:' + DB_PATH });           // 本地回退
console.log('[db] backend:', TURSO_URL ? 'Turso (' + TURSO_URL.replace(/\?.*$/, '') + ')' : 'local file (' + DB_PATH + ')');

// ---- 基础异步 helper ----
async function run(sql, args = []) { return client.execute({ sql, args }); }
async function get(sql, args = []) { const r = await client.execute({ sql, args }); return r.rows[0]; }
async function all(sql, args = []) { const r = await client.execute({ sql, args }); return r.rows; }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL, email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chapters(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, req TEXT, freq TEXT, difficulty REAL, ord INTEGER
);
CREATE TABLE IF NOT EXISTS sections(
  id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, name TEXT NOT NULL, req TEXT, freq TEXT, difficulty REAL, ord INTEGER
);
CREATE TABLE IF NOT EXISTS questions(
  qid TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, section_id TEXT NOT NULL,
  type TEXT NOT NULL, paper TEXT NOT NULL, num INTEGER,
  answer TEXT, stem TEXT, code TEXT, options_json TEXT, explanation TEXT, difficulty REAL, ord INTEGER
);
CREATE TABLE IF NOT EXISTS attempts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, qid TEXT NOT NULL, chosen TEXT, correct INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wrongbook(
  user_id INTEGER NOT NULL, qid TEXT NOT NULL,
  wrong_count INTEGER NOT NULL DEFAULT 0, mastered INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id, qid)
);
CREATE TABLE IF NOT EXISTS bookmarks(
  user_id INTEGER NOT NULL, qid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id, qid)
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, qid);
CREATE INDEX IF NOT EXISTS idx_q_section ON questions(section_id);
CREATE INDEX IF NOT EXISTS idx_q_chapter ON questions(chapter_id);
`;

// 首次运行:建表 + 导入题库
async function initDb() {
  await client.executeMultiple(SCHEMA);
  return seedIfEmpty();
}

async function seedIfEmpty() {
  const n = Number((await get('SELECT COUNT(*) c FROM questions')).c);
  if (n > 0) return { seeded: false, count: n };
  if (!fs.existsSync(SEED_PATH)) { console.warn('[db] seed file not found:', SEED_PATH); return { seeded: false, count: 0 }; }
  const data = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  const stmts = [];
  data.chapters.forEach((c, ci) => {
    stmts.push({ sql: 'INSERT OR REPLACE INTO chapters(id,name,req,freq,difficulty,ord) VALUES(?,?,?,?,?,?)',
      args: [c.id, c.name, c.req, c.freq, c.difficulty, ci] });
    c.sections.forEach((s, si) => {
      stmts.push({ sql: 'INSERT OR REPLACE INTO sections(id,chapter_id,name,req,freq,difficulty,ord) VALUES(?,?,?,?,?,?,?)',
        args: [s.id, c.id, s.name, s.req, s.freq, s.difficulty, si] });
      s.questions.forEach((q, qi) => {
        stmts.push({ sql: `INSERT OR REPLACE INTO questions
          (qid,chapter_id,section_id,type,paper,num,answer,stem,code,options_json,explanation,difficulty,ord)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [q.qid, c.id, s.id, q.type, q.paper, q.num, q.answer, q.stem, q.code,
                 JSON.stringify(q.options || {}), q.explanation || '', q.difficulty, qi] });
      });
    });
  });
  await client.batch(stmts, 'write');                 // 单事务批量导入(生产仅一次往返)
  const count = Number((await get('SELECT COUNT(*) c FROM questions')).c);
  console.log(`[db] seeded ${count} questions from ${path.basename(SEED_PATH)}`);
  return { seeded: true, count };
}

// ---- 查询集合(每项均为返回 Promise 的函数) ----
const Q = {
  // users
  createUser: (u, e, h) => run('INSERT INTO users(username,email,password_hash) VALUES(?,?,?)', [u, e, h]),
  userByName: (u) => get('SELECT * FROM users WHERE username = ?', [u]),
  userById: (id) => get('SELECT id,username,email,created_at FROM users WHERE id = ?', [id]),

  // catalog(聚合,几条查询搞定整棵树)
  chapters: () => all('SELECT * FROM chapters ORDER BY ord'),
  allSections: () => all('SELECT * FROM sections ORDER BY chapter_id, ord'),
  countAllChapters: () => all("SELECT chapter_id, COUNT(*) c, SUM(type='mc') mc, SUM(type='tf') tf, SUM(CASE WHEN explanation<>'' THEN 1 ELSE 0 END) explained FROM questions GROUP BY chapter_id"),
  countAllSections: () => all("SELECT section_id, COUNT(*) c, SUM(type='mc') mc, SUM(type='tf') tf FROM questions GROUP BY section_id"),
  countQByChapter: (cid) => get("SELECT COUNT(*) c FROM questions WHERE chapter_id = ?", [cid]),
  distinctPapers: () => all('SELECT DISTINCT paper FROM questions ORDER BY paper'),

  // questions
  questionsBySection: (sid) => all('SELECT * FROM questions WHERE section_id = ? ORDER BY ord', [sid]),
  questionByQid: (qid) => get('SELECT * FROM questions WHERE qid = ?', [qid]),
  randomQuestions: (n) => all('SELECT * FROM questions ORDER BY RANDOM() LIMIT ?', [n]),
  randomBySection: (sid, n) => all('SELECT * FROM questions WHERE section_id = ? ORDER BY RANDOM() LIMIT ?', [sid, n]),
  randomByChapter: (cid, n) => all('SELECT * FROM questions WHERE chapter_id = ? ORDER BY RANDOM() LIMIT ?', [cid, n]),
  search: (like) => all(`SELECT * FROM questions
    WHERE stem LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR options_json LIKE ? ESCAPE '\\'
    ORDER BY chapter_id, ord LIMIT 80`, [like, like, like]),

  // attempts
  addAttempt: (uid, qid, chosen, correct) => run('INSERT INTO attempts(user_id,qid,chosen,correct) VALUES(?,?,?,?)', [uid, qid, chosen, correct]),
  attemptsByUser: (uid, lim) => all('SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [uid, lim]),
  totalAnswered: (uid) => get('SELECT COUNT(DISTINCT qid) c FROM attempts WHERE user_id = ?', [uid]),
  totalAttempts: (uid) => get('SELECT COUNT(*) c, SUM(correct) ok FROM attempts WHERE user_id = ?', [uid]),
  progressByChapter: (uid) => all(`
    WITH latest AS (
      SELECT a.qid, a.correct, ROW_NUMBER() OVER (PARTITION BY a.qid ORDER BY a.id DESC) rn
      FROM attempts a WHERE a.user_id = ?)
    SELECT q.chapter_id, COUNT(*) answered, SUM(l.correct) correct
    FROM latest l JOIN questions q ON q.qid = l.qid
    WHERE l.rn = 1 GROUP BY q.chapter_id`, [uid]),

  // wrongbook
  upsertWrong: (uid, qid) => run(`INSERT INTO wrongbook(user_id,qid,wrong_count,mastered,updated_at)
    VALUES(?,?,1,0,datetime('now'))
    ON CONFLICT(user_id,qid) DO UPDATE SET wrong_count = wrong_count + 1, mastered = 0, updated_at = datetime('now')`, [uid, qid]),
  clearWrongOnCorrect: (uid, qid) => run(`UPDATE wrongbook SET mastered = 1, updated_at = datetime('now') WHERE user_id = ? AND qid = ?`, [uid, qid]),
  setMastered: (m, uid, qid) => run(`UPDATE wrongbook SET mastered = ?, updated_at = datetime('now') WHERE user_id = ? AND qid = ?`, [m, uid, qid]),
  wrongbookQids: (uid) => all('SELECT qid, wrong_count, mastered FROM wrongbook WHERE user_id = ? AND mastered = 0 ORDER BY updated_at DESC', [uid]),
  wrongbookCount: (uid) => get('SELECT COUNT(*) c FROM wrongbook WHERE user_id = ? AND mastered = 0', [uid]),

  // bookmarks
  addBookmark: (uid, qid) => run('INSERT OR IGNORE INTO bookmarks(user_id,qid) VALUES(?,?)', [uid, qid]),
  delBookmark: (uid, qid) => run('DELETE FROM bookmarks WHERE user_id = ? AND qid = ?', [uid, qid]),
  bookmarkQids: (uid) => all('SELECT qid FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC', [uid]),
};

async function questionsByQids(qids) {
  if (!qids.length) return [];
  const ph = qids.map(() => '?').join(',');
  return all(`SELECT * FROM questions WHERE qid IN (${ph})`, qids);
}

function shapeQuestion(row, { withAnswer = true } = {}) {
  if (!row) return null;
  const out = {
    qid: row.qid, chapter_id: row.chapter_id, section_id: row.section_id,
    type: row.type, paper: row.paper, num: row.num, stem: row.stem, code: row.code,
    options: JSON.parse(row.options_json || '{}'), difficulty: row.difficulty,
  };
  if (withAnswer) { out.answer = row.answer; out.explanation = row.explanation; }
  return out;
}

module.exports = { client, Q, initDb, seedIfEmpty, questionsByQids, shapeQuestion, DB_PATH };
