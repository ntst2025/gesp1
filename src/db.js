'use strict';
/**
 * 数据访问层 —— 全站唯一直接接触数据库的文件(libSQL / Turso)。
 * 多级别:级别(level) → 章(chapter) → 节(section) → 题(question)。
 *   - 章/节 id 按级别加前缀("L{level}:{id}")避免跨级冲突;qid 保持各级别自身唯一。
 *   - data/levels.json 为级别清单(含 version);加级别 = 加一行 + 丢一个数据文件。
 *   - 启动时:若库结构旧 或 内容版本变化 → 自动重建"题库内容表"并重新导入(用户表不动)。
 */
const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEVELS_PATH = process.env.LEVELS_PATH || path.join(DATA_DIR, 'levels.json');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'gesp.db');
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

const client = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  : createClient({ url: 'file:' + DB_PATH });
console.log('[db] backend:', TURSO_URL ? 'Turso (' + TURSO_URL.replace(/\?.*$/, '') + ')' : 'local file (' + DB_PATH + ')');

async function run(sql, args = []) { return client.execute({ sql, args }); }
async function get(sql, args = []) { const r = await client.execute({ sql, args }); return r.rows[0]; }
async function all(sql, args = []) { const r = await client.execute({ sql, args }); return r.rows; }

// 用户表(users/attempts/wrongbook/bookmarks)与 meta 永不随内容重建而删除。
// 启动时只创建这些"稳定表",绝不在此处触碰内容表/内容索引。
const USER_SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL, email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS mock_results(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, level INTEGER NOT NULL, paper TEXT NOT NULL,
  score INTEGER NOT NULL, total_score INTEGER NOT NULL, correct INTEGER NOT NULL, total_q INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, qid);
CREATE INDEX IF NOT EXISTS idx_mock_paper ON mock_results(level, paper);
`;
// 内容表(levels/chapters/sections/questions)及其索引:只在 reseedAll 里(DROP 旧表之后)整体重建,
// 保证索引一定建在含 level 列的新表上,避免旧 schema 残留导致 "no such column: level"。
const CONTENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS levels(level INTEGER PRIMARY KEY, name TEXT NOT NULL, ord INTEGER);
CREATE TABLE IF NOT EXISTS chapters(
  id TEXT PRIMARY KEY, level INTEGER NOT NULL, name TEXT NOT NULL, req TEXT, freq TEXT, difficulty REAL, ord INTEGER
);
CREATE TABLE IF NOT EXISTS sections(
  id TEXT PRIMARY KEY, level INTEGER NOT NULL, chapter_id TEXT NOT NULL, name TEXT NOT NULL, req TEXT, freq TEXT, difficulty REAL, ord INTEGER
);
CREATE TABLE IF NOT EXISTS questions(
  qid TEXT PRIMARY KEY, level INTEGER NOT NULL, chapter_id TEXT NOT NULL, section_id TEXT NOT NULL,
  type TEXT NOT NULL, paper TEXT NOT NULL, num INTEGER,
  answer TEXT, stem TEXT, code TEXT, options_json TEXT, explanation TEXT, difficulty REAL, ord INTEGER
);
CREATE INDEX IF NOT EXISTS idx_q_level ON questions(level);
CREATE INDEX IF NOT EXISTS idx_q_section ON questions(section_id);
CREATE INDEX IF NOT EXISTS idx_q_chapter ON questions(chapter_id);
`;

function readManifest() {
  return JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf-8'));
}

// 从清单把所有级别导入"内容表"
async function loadAllLevels(manifest) {
  manifest = manifest || readManifest();
  const stmts = [];
  manifest.levels.forEach((lv, li) => {
    stmts.push({ sql: 'INSERT OR REPLACE INTO levels(level,name,ord) VALUES(?,?,?)', args: [lv.level, lv.name, li] });
    const file = path.join(DATA_DIR, lv.file);
    if (!fs.existsSync(file)) { console.warn('[db] level file missing:', file); return; }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const px = (id) => 'L' + lv.level + ':' + id;       // 章/节 id 加级别前缀
    (data.chapters || []).forEach((c, ci) => {
      stmts.push({ sql: 'INSERT OR REPLACE INTO chapters(id,level,name,req,freq,difficulty,ord) VALUES(?,?,?,?,?,?,?)',
        args: [px(c.id), lv.level, c.name, c.req, c.freq, c.difficulty, ci] });
      (c.sections || []).forEach((s, si) => {
        stmts.push({ sql: 'INSERT OR REPLACE INTO sections(id,level,chapter_id,name,req,freq,difficulty,ord) VALUES(?,?,?,?,?,?,?,?)',
          args: [px(s.id), lv.level, px(c.id), s.name, s.req, s.freq, s.difficulty, si] });
        (s.questions || []).forEach((q, qi) => {
          stmts.push({ sql: `INSERT OR REPLACE INTO questions
            (qid,level,chapter_id,section_id,type,paper,num,answer,stem,code,options_json,explanation,difficulty,ord)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [q.qid, lv.level, px(c.id), px(s.id), q.type, q.paper, q.num, q.answer, q.stem, q.code,
                   JSON.stringify(q.options || {}), q.explanation || '', q.difficulty, qi] });
        });
      });
    });
  });
  // 分批写入(libSQL 单 batch 语句过多可能受限,按 400 条一批)
  for (let i = 0; i < stmts.length; i += 400) {
    await client.batch(stmts.slice(i, i + 400), 'write');
  }
  return Number((await get('SELECT COUNT(*) c FROM questions')).c);
}

// 重建"内容表"(章/节/题/级别),用户表与 meta 不动
async function reseedAll(manifest) {
  await client.executeMultiple('DROP TABLE IF EXISTS questions; DROP TABLE IF EXISTS sections; DROP TABLE IF EXISTS chapters; DROP TABLE IF EXISTS levels;');
  await client.executeMultiple(CONTENT_SCHEMA);
  const n = await loadAllLevels(manifest);
  console.log('[db] content rebuilt:', n, 'questions across levels');
  return n;
}

// 启动:建表 + 必要时自动迁移/更新内容
async function initDb() {
  await client.executeMultiple(USER_SCHEMA);
  const manifest = readManifest();
  const wantVer = String(manifest.version || 1);
  let schemaOld = false, curVer = null;
  // 探测内容表是否为含 level 列的新结构;旧结构残留或表不存在都触发整体重建
  try { await get('SELECT level FROM chapters LIMIT 1'); await get('SELECT level FROM questions LIMIT 1'); } catch (e) { schemaOld = true; }
  try { const r = await get("SELECT v FROM meta WHERE k='content_version'"); curVer = r ? r.v : null; } catch (e) {}
  if (schemaOld || curVer !== wantVer) {
    console.log(`[db] (re)loading content: schemaOld=${schemaOld}, ver ${curVer} -> ${wantVer} (user data preserved)`);
    await reseedAll(manifest);
    await run("INSERT OR REPLACE INTO meta(k,v) VALUES('content_version',?)", [wantVer]);
    return { migrated: true, version: wantVer };
  }
  return { migrated: false, version: wantVer };
}

// ---- 查询集合 ----
const Q = {
  // users
  createUser: (u, e, h) => run('INSERT INTO users(username,email,password_hash) VALUES(?,?,?)', [u, e, h]),
  userByName: (u) => get('SELECT * FROM users WHERE username = ?', [u]),
  userById: (id) => get('SELECT id,username,email,created_at FROM users WHERE id = ?', [id]),

  // levels
  levelsList: () => all(`SELECT l.level, l.name, l.ord,
      (SELECT COUNT(*) FROM questions q WHERE q.level = l.level) total,
      (SELECT COALESCE(SUM(q.type='mc'),0) FROM questions q WHERE q.level = l.level) mc,
      (SELECT COALESCE(SUM(q.type='tf'),0) FROM questions q WHERE q.level = l.level) tf,
      (SELECT COUNT(*) FROM chapters c WHERE c.level = l.level) chapters
    FROM levels l ORDER BY l.ord`),
  levelById: (lv) => get('SELECT * FROM levels WHERE level = ?', [lv]),

  // catalog(按级别)
  chaptersByLevel: (lv) => all('SELECT * FROM chapters WHERE level = ? ORDER BY ord', [lv]),
  sectionsByLevel: (lv) => all('SELECT * FROM sections WHERE level = ? ORDER BY chapter_id, ord', [lv]),
  countChaptersByLevel: (lv) => all("SELECT chapter_id, COUNT(*) c, SUM(type='mc') mc, SUM(type='tf') tf, SUM(CASE WHEN explanation<>'' THEN 1 ELSE 0 END) explained FROM questions WHERE level = ? GROUP BY chapter_id", [lv]),
  countSectionsByLevel: (lv) => all("SELECT section_id, COUNT(*) c, SUM(type='mc') mc, SUM(type='tf') tf FROM questions WHERE level = ? GROUP BY section_id", [lv]),
  distinctPapersByLevel: (lv) => all('SELECT DISTINCT paper FROM questions WHERE level = ? AND paper <> \'\' ORDER BY paper', [lv]),

  // questions
  questionsBySection: (sid) => all('SELECT * FROM questions WHERE section_id = ? ORDER BY ord', [sid]),
  questionByQid: (qid) => get('SELECT * FROM questions WHERE qid = ?', [qid]),
  randomByLevel: (lv, n) => all('SELECT * FROM questions WHERE level = ? ORDER BY RANDOM() LIMIT ?', [lv, n]),
  randomBySection: (sid, n) => all('SELECT * FROM questions WHERE section_id = ? ORDER BY RANDOM() LIMIT ?', [sid, n]),
  randomByChapter: (cid, n) => all('SELECT * FROM questions WHERE chapter_id = ? ORDER BY RANDOM() LIMIT ?', [cid, n]),
  search: (like, lv) => all(`SELECT * FROM questions
    WHERE level = ? AND (stem LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR options_json LIKE ? ESCAPE '\\')
    ORDER BY chapter_id, ord LIMIT 80`, [lv, like, like, like]),

  // attempts(qid 全局唯一,跨级通用)
  addAttempt: (uid, qid, chosen, correct) => run('INSERT INTO attempts(user_id,qid,chosen,correct) VALUES(?,?,?,?)', [uid, qid, chosen, correct]),
  attemptsByUser: (uid, lim) => all('SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [uid, lim]),
  totalAnswered: (uid, lv) => get('SELECT COUNT(DISTINCT a.qid) c FROM attempts a JOIN questions q ON q.qid=a.qid WHERE a.user_id = ? AND q.level = ?', [uid, lv]),
  totalAttempts: (uid, lv) => get('SELECT COUNT(*) c, SUM(a.correct) ok FROM attempts a JOIN questions q ON q.qid=a.qid WHERE a.user_id = ? AND q.level = ?', [uid, lv]),
  progressByChapter: (uid, lv) => all(`
    WITH latest AS (
      SELECT a.qid, a.correct, ROW_NUMBER() OVER (PARTITION BY a.qid ORDER BY a.id DESC) rn
      FROM attempts a WHERE a.user_id = ?)
    SELECT q.chapter_id, COUNT(*) answered, SUM(l.correct) correct
    FROM latest l JOIN questions q ON q.qid = l.qid
    WHERE l.rn = 1 AND q.level = ? GROUP BY q.chapter_id`, [uid, lv]),

  // wrongbook / bookmarks(全局,跨级统一)
  upsertWrong: (uid, qid) => run(`INSERT INTO wrongbook(user_id,qid,wrong_count,mastered,updated_at)
    VALUES(?,?,1,0,datetime('now'))
    ON CONFLICT(user_id,qid) DO UPDATE SET wrong_count = wrong_count + 1, mastered = 0, updated_at = datetime('now')`, [uid, qid]),
  clearWrongOnCorrect: (uid, qid) => run(`UPDATE wrongbook SET mastered = 1, updated_at = datetime('now') WHERE user_id = ? AND qid = ?`, [uid, qid]),
  setMastered: (m, uid, qid) => run(`UPDATE wrongbook SET mastered = ?, updated_at = datetime('now') WHERE user_id = ? AND qid = ?`, [m, uid, qid]),
  wrongbookQids: (uid) => all('SELECT qid, wrong_count, mastered FROM wrongbook WHERE user_id = ? AND mastered = 0 ORDER BY updated_at DESC', [uid]),
  wrongbookCount: (uid) => get('SELECT COUNT(*) c FROM wrongbook WHERE user_id = ? AND mastered = 0', [uid]),
  addBookmark: (uid, qid) => run('INSERT OR IGNORE INTO bookmarks(user_id,qid) VALUES(?,?)', [uid, qid]),
  delBookmark: (uid, qid) => run('DELETE FROM bookmarks WHERE user_id = ? AND qid = ?', [uid, qid]),
  bookmarkQids: (uid) => all('SELECT qid FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC', [uid]),

  // ---- 积分 / 排行 / 打卡(全局,跨级) ---- 积分:每条正确作答 单选+2、判断+1
  leaderboard: (lim) => all(`
    SELECT u.id, u.username,
      COALESCE(SUM(CASE WHEN a.correct=1 THEN (CASE WHEN q.type='mc' THEN 2 ELSE 1 END) ELSE 0 END),0) points,
      COUNT(a.id) attempts
    FROM users u
    LEFT JOIN attempts a ON a.user_id = u.id
    LEFT JOIN questions q ON q.qid = a.qid
    GROUP BY u.id HAVING attempts > 0
    ORDER BY points DESC, attempts DESC LIMIT ?`, [lim]),
  userPointsRow: (uid) => get(`
    SELECT COALESCE(SUM(CASE WHEN a.correct=1 THEN (CASE WHEN q.type='mc' THEN 2 ELSE 1 END) ELSE 0 END),0) points,
      COUNT(a.id) attempts, COALESCE(SUM(a.correct),0) correct
    FROM attempts a JOIN questions q ON q.qid = a.qid WHERE a.user_id = ?`, [uid]),
  attemptDates: (uid) => all("SELECT DISTINCT date(created_at) d FROM attempts WHERE user_id = ? ORDER BY d DESC", [uid]),
  activityByDate: (uid) => all("SELECT date(created_at) d, COUNT(*) c FROM attempts WHERE user_id = ? GROUP BY date(created_at)", [uid]),

  // ---- 模考(按整套真题) ----
  questionsByPaper: (lv, paper) => all("SELECT * FROM questions WHERE level = ? AND paper = ? ORDER BY (type='tf'), num", [lv, paper]),
  addMockResult: (uid, lv, paper, score, ts, correct, totq) =>
    run("INSERT INTO mock_results(user_id,level,paper,score,total_score,correct,total_q) VALUES(?,?,?,?,?,?,?)", [uid, lv, paper, score, ts, correct, totq]),
  mockBestForPaper: (lv, paper) => all("SELECT user_id, MAX(score) best FROM mock_results WHERE level = ? AND paper = ? GROUP BY user_id ORDER BY best DESC", [lv, paper]),
  mockHistory: (uid) => all("SELECT level,paper,score,total_score,correct,total_q,created_at FROM mock_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", [uid]),

  // ---- 个性化推荐(按知识点/节统计 + 取题) ----
  sectionStatsByLevel: (uid, lv) => all(`
    WITH latest AS (
      SELECT a.qid, a.correct, ROW_NUMBER() OVER (PARTITION BY a.qid ORDER BY a.id DESC) rn
      FROM attempts a WHERE a.user_id = ?)
    SELECT q.section_id, q.chapter_id, COUNT(*) answered, COALESCE(SUM(l.correct),0) correct
    FROM latest l JOIN questions q ON q.qid = l.qid
    WHERE l.rn = 1 AND q.level = ? GROUP BY q.section_id`, [uid, lv]),
  seenQidsByLevel: (uid, lv) => all("SELECT DISTINCT a.qid FROM attempts a JOIN questions q ON q.qid=a.qid WHERE a.user_id = ? AND q.level = ?", [uid, lv]),
  questionsBySectionIds: (sids) => {
    if (!sids.length) return Promise.resolve([]);
    const ph = sids.map(() => '?').join(',');
    return all(`SELECT * FROM questions WHERE section_id IN (${ph})`, sids);
  },
};

async function questionsByQids(qids) {
  if (!qids.length) return [];
  const ph = qids.map(() => '?').join(',');
  return all(`SELECT * FROM questions WHERE qid IN (${ph})`, qids);
}

function shapeQuestion(row, { withAnswer = true } = {}) {
  if (!row) return null;
  const out = {
    qid: row.qid, level: row.level, chapter_id: row.chapter_id, section_id: row.section_id,
    type: row.type, paper: row.paper, num: row.num, stem: row.stem, code: row.code,
    options: JSON.parse(row.options_json || '{}'), difficulty: row.difficulty,
  };
  if (withAnswer) { out.answer = row.answer; out.explanation = row.explanation; }
  return out;
}

module.exports = { client, Q, initDb, reseedAll, loadAllLevels, questionsByQids, shapeQuestion, DB_PATH };
