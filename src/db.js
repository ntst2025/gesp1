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
CREATE TABLE IF NOT EXISTS baidu_push(url TEXT PRIMARY KEY, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS class_members(
  level INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(level, user_id)
);
CREATE TABLE IF NOT EXISTS assignments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL,
  type TEXT NOT NULL,                 -- 'resource' 课程资源 | 'homework' 作业
  title TEXT NOT NULL,
  body TEXT,
  payload TEXT,                       -- JSON
  due_at TEXT,
  target TEXT,                        -- NULL/'class'=全班; 否则 JSON 数组 [user_id,...] 指定学生
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignment_progress(
  assignment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',  -- assigned|done
  score INTEGER,                      -- 作业自动批改得分
  detail TEXT,                        -- JSON:逐题对错
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(assignment_id, user_id)
);
CREATE TABLE IF NOT EXISTS teacher_prog(
  pid TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  solution TEXT NOT NULL,
  time_limit REAL DEFAULT 1.0,
  samples TEXT,                       -- JSON [{in,out}]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teacher_prog_tc(
  pid TEXT NOT NULL,
  ord INTEGER NOT NULL,
  input TEXT NOT NULL,
  expected TEXT NOT NULL,
  PRIMARY KEY(pid, ord)
);
CREATE TABLE IF NOT EXISTS prog_submissions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid TEXT NOT NULL, user_id INTEGER NOT NULL,
  code TEXT NOT NULL, verdict TEXT NOT NULL, passed INTEGER, total INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS question_reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qid TEXT NOT NULL, user_id INTEGER, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mock_results(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, level INTEGER NOT NULL, paper TEXT NOT NULL,
  score INTEGER NOT NULL, total_score INTEGER NOT NULL, correct INTEGER NOT NULL, total_q INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS question_overrides(
  qid TEXT PRIMARY KEY,
  answer TEXT, stem TEXT, code TEXT, options_json TEXT, explanation TEXT, difficulty REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS redeem_codes(
  code TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'vip',
  days INTEGER NOT NULL DEFAULT 0,
  batch TEXT,
  status TEXT NOT NULL DEFAULT 'unused',
  used_by INTEGER, used_at TEXT,
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
  await applyAllOverrides();   // 重灌后把后台对题目的修改重新覆盖回去(编辑不丢失)
  console.log('[db] content rebuilt:', n, 'questions across levels');
  return n;
}

// 把 question_overrides 里的修改应用到 questions 表(仅覆盖非空字段)
async function applyAllOverrides() {
  let rows = [];
  try { rows = await all('SELECT * FROM question_overrides'); } catch (e) { return 0; }
  let cnt = 0;
  for (const o of rows) {
    const sets = [], args = [];
    for (const f of ['answer', 'stem', 'code', 'options_json', 'explanation', 'difficulty']) {
      if (o[f] !== null && o[f] !== undefined) { sets.push(`${f} = ?`); args.push(o[f]); }
    }
    if (sets.length) { args.push(o.qid); await run(`UPDATE questions SET ${sets.join(', ')} WHERE qid = ?`, args); cnt++; }
  }
  return cnt;
}

// 启动:建表 + 必要时自动迁移/更新内容
async function initDb() {
  await client.executeMultiple(USER_SCHEMA);
  // 迁移:为老库补充 avatar 列(已存在则忽略报错)
  try { await run("ALTER TABLE redeem_codes ADD COLUMN note TEXT"); } catch (e) { /* 列已存在 */ }
  try { await run("ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0"); } catch (e) { /* 列已存在 */ }
  try { await run("ALTER TABLE assignments ADD COLUMN target TEXT"); } catch (e) { /* 列已存在 */ }
  try { await run("ALTER TABLE assignment_progress ADD COLUMN comment TEXT"); } catch (e) { /* 列已存在 */ }
  try { await run("ALTER TABLE users ADD COLUMN avatar TEXT"); } catch (e) { /* 列已存在 */ }
  try { await run("ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free'"); } catch (e) { /* 列已存在 */ }
  try { await run("ALTER TABLE users ADD COLUMN vip_until TEXT"); } catch (e) { /* 列已存在 */ }
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
  createUser: (u, e, h, av) => run('INSERT INTO users(username,email,password_hash,avatar) VALUES(?,?,?,?)', [u, e, h, av || null]),
  userByName: (u) => get('SELECT * FROM users WHERE username = ?', [u]),
  userById: (id) => get('SELECT id,username,email,avatar,tier,vip_until,created_at,disabled FROM users WHERE id = ?', [id]),
  setTier: (id, tier, until) => run('UPDATE users SET tier = ?, vip_until = ? WHERE id = ?', [tier, until, id]),

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
  sectionById: (sid) => get('SELECT * FROM sections WHERE id = ?', [sid]),
  questionsByLevelPaper: (lv, paper) => all("SELECT qid, type, num FROM questions WHERE level = ? AND paper = ? ORDER BY (type='tf'), num", [lv, paper]),
  allQuestionRefs: () => all('SELECT qid, level, paper, type, num FROM questions ORDER BY level, paper, (type=\'tf\'), num'),
  setAvatar: (uid, av) => run('UPDATE users SET avatar = ? WHERE id = ?', [av, uid]),
  setDisabled: (uid, v) => run('UPDATE users SET disabled = ? WHERE id = ?', [v ? 1 : 0, uid]),
  // ---- 教师编程题 ----
  createTeacherProg: (pid,level,title,statement,solution,tl,samples) => run('INSERT INTO teacher_prog(pid,level,title,statement,solution,time_limit,samples) VALUES(?,?,?,?,?,?,?)', [pid,level,title,statement,solution,tl,samples]),
  teacherProgByPid: (pid) => get('SELECT * FROM teacher_prog WHERE pid=?', [pid]),
  teacherProgByLevel: (level) => all('SELECT pid,level,title,time_limit,created_at FROM teacher_prog WHERE level=? ORDER BY created_at DESC', [level]),
  deleteTeacherProg: (pid) => run('DELETE FROM teacher_prog WHERE pid=?', [pid]),
  addTeacherTc: (pid,ord,input,expected) => run('INSERT INTO teacher_prog_tc(pid,ord,input,expected) VALUES(?,?,?,?)', [pid,ord,input,expected]),
  clearTeacherTc: (pid) => run('DELETE FROM teacher_prog_tc WHERE pid=?', [pid]),
  teacherTc: (pid) => all('SELECT ord,input,expected FROM teacher_prog_tc WHERE pid=? ORDER BY ord', [pid]),
  // ---- 班级 ----
  joinClass: (level, uid) => run('INSERT OR IGNORE INTO class_members(level,user_id) VALUES(?,?)', [level, uid]),
  leaveClass: (level, uid) => run('DELETE FROM class_members WHERE level=? AND user_id=?', [level, uid]),
  myClasses: (uid) => all('SELECT level FROM class_members WHERE user_id=? ORDER BY level', [uid]),
  classRoster: (level) => all(`SELECT u.id,u.username,u.avatar,m.joined_at,
      COUNT(a.id) attempts,
      COALESCE(SUM(CASE WHEN a.correct=1 THEN 1 ELSE 0 END),0) correct
    FROM class_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN attempts a ON a.user_id=u.id
    WHERE m.level=? GROUP BY u.id ORDER BY m.joined_at DESC`, [level]),
  classCounts: () => all('SELECT level, COUNT(*) n FROM class_members GROUP BY level'),
  // ---- 作业/资源 ----
  createAssignment: (level,type,title,body,payload,due,target) => run('INSERT INTO assignments(level,type,title,body,payload,due_at,target) VALUES(?,?,?,?,?,?,?)', [level,type,title,body,payload,due,target||null]),
  listAssignments: (level) => all('SELECT * FROM assignments WHERE level=? ORDER BY id DESC', [level]),
  assignmentById: (id) => get('SELECT * FROM assignments WHERE id=?', [id]),
  deleteAssignment: (id) => run('DELETE FROM assignments WHERE id=?', [id]),
  // 学生侧:本人所在班级的作业/资源 + 自己的完成状态
  myAssignments: (uid) => all(`SELECT a.*, p.status, p.score, p.comment, p.updated_at done_at
    FROM assignments a
    JOIN class_members m ON m.level=a.level AND m.user_id=?
    LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.user_id=?
    WHERE a.target IS NULL OR a.target='class' OR a.target LIKE ?
    ORDER BY a.id DESC`, [uid, uid, '%,' + uid + ',%']),
  setAssignmentProgress: (aid,uid,status,score,detail) => run(`INSERT INTO assignment_progress(assignment_id,user_id,status,score,detail,updated_at)
    VALUES(?,?,?,?,?,datetime('now'))
    ON CONFLICT(assignment_id,user_id) DO UPDATE SET status=excluded.status,score=excluded.score,detail=excluded.detail,updated_at=datetime('now')`, [aid,uid,status,score,detail]),
  setComment: (aid,uid,comment) => run(`INSERT INTO assignment_progress(assignment_id,user_id,status,comment,updated_at)
    VALUES(?,?,'assigned',?,datetime('now'))
    ON CONFLICT(assignment_id,user_id) DO UPDATE SET comment=excluded.comment,updated_at=datetime('now')`, [aid,uid,comment]),
  assignmentStats: (aid) => all('SELECT status, COUNT(*) n, AVG(score) avg FROM assignment_progress WHERE assignment_id=? GROUP BY status', [aid]),
  // 单个学生学情(老师查看用)
  studentOverview: (uid) => get(`SELECT
      COUNT(a.id) attempts,
      COALESCE(SUM(CASE WHEN a.correct=1 THEN 1 ELSE 0 END),0) correct,
      COUNT(DISTINCT a.qid) distinct_q,
      MAX(a.created_at) last_active
    FROM attempts a WHERE a.user_id=?`, [uid]),
  studentByChapter: (uid, level) => all(`SELECT c.id chapter_id, c.name,
      COUNT(DISTINCT q.qid) total,
      COUNT(DISTINCT CASE WHEN a.correct=1 THEN a.qid END) mastered,
      COUNT(DISTINCT a.qid) tried
    FROM chapters c
    JOIN sections sec ON sec.chapter_id=c.id
    JOIN questions q ON q.section_id=sec.id
    LEFT JOIN attempts a ON a.qid=q.qid AND a.user_id=?
    WHERE c.level=? GROUP BY c.id ORDER BY c.ord`, [uid, level]),
  studentRecent: (uid, lim) => all(`SELECT a.qid, a.correct, a.created_at, q.type, q.level
    FROM attempts a LEFT JOIN questions q ON q.qid=a.qid
    WHERE a.user_id=? ORDER BY a.id DESC LIMIT ?`, [uid, lim]),
  studentAssignments: (uid, level) => all(`SELECT a.id,a.title,a.type,a.due_at,p.status,p.score,p.updated_at
    FROM assignments a
    LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.user_id=?
    WHERE a.level=? ORDER BY a.id DESC`, [uid, level]),
  studentProgCount: (uid) => get("SELECT COUNT(DISTINCT pid) ac FROM prog_submissions WHERE user_id=? AND verdict='AC'", [uid]),
  userBasic: (uid) => get('SELECT id,username,avatar,tier,vip_until,created_at FROM users WHERE id=?', [uid]),
  assignmentRoster: (aid, level) => all(`SELECT u.id,u.username,u.avatar,p.status,p.score,p.updated_at
    FROM class_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN assignment_progress p ON p.assignment_id=? AND p.user_id=u.id
    WHERE m.level=? ORDER BY p.score DESC NULLS LAST, u.username`, [aid, level]),
  addSubmission: (pid, uid, code, verdict, passed, total) => run('INSERT INTO prog_submissions(pid,user_id,code,verdict,passed,total) VALUES(?,?,?,?,?,?)', [pid, uid, code, verdict, passed, total]),
  mySubmissions: (uid, pid) => all('SELECT id, verdict, passed, total, created_at FROM prog_submissions WHERE user_id=? AND pid=? ORDER BY id DESC LIMIT 20', [uid, pid]),
  myLastCode: (uid, pid) => get('SELECT code FROM prog_submissions WHERE user_id=? AND pid=? ORDER BY id DESC LIMIT 1', [uid, pid]),
  myProgStatus: (uid) => all("SELECT pid, MAX(verdict='AC') ac, COUNT(*) tries FROM prog_submissions WHERE user_id=? GROUP BY pid", [uid]),
  submissionCountToday: (uid) => get("SELECT COUNT(*) n FROM prog_submissions WHERE user_id=? AND created_at >= datetime('now','-1 day')", [uid]),
  addReport: (qid, uid, reason) => run('INSERT INTO question_reports(qid, user_id, reason) VALUES(?,?,?)', [qid, uid, reason]),
  reportCountToday: (uid) => get("SELECT COUNT(*) n FROM question_reports WHERE user_id = ? AND created_at >= datetime('now','-1 day')", [uid]),
  listReports: (status) => all(`SELECT r.*, u.username FROM question_reports r LEFT JOIN users u ON u.id = r.user_id ${status ? "WHERE r.status = ?" : ''} ORDER BY r.id DESC LIMIT 200`, status ? [status] : []),
  setReportStatus: (id, st) => run('UPDATE question_reports SET status = ? WHERE id = ?', [st, id]),
  baiduPushedUrls: () => all('SELECT url FROM baidu_push'),
  baiduPushCount: () => get('SELECT COUNT(*) n FROM baidu_push'),
  baiduMarkPushed: async (urls) => { for (const u of urls) await run('INSERT OR IGNORE INTO baidu_push(url, ts) VALUES(?, ?)', [u, new Date().toISOString()]); },
  randomByLevel: (lv, n) => all('SELECT * FROM questions WHERE level = ? ORDER BY RANDOM() LIMIT ?', [lv, n]),
  randomBySection: (sid, n) => all('SELECT * FROM questions WHERE section_id = ? ORDER BY RANDOM() LIMIT ?', [sid, n]),
  randomByChapter: (cid, n) => all('SELECT * FROM questions WHERE chapter_id = ? ORDER BY RANDOM() LIMIT ?', [cid, n]),
  qidsByChapter: (cid) => all('SELECT qid FROM questions WHERE chapter_id = ? ORDER BY ord', [cid]),
  qidsBySection: (sid) => all('SELECT qid FROM questions WHERE section_id = ? ORDER BY ord', [sid]),
  qidsByPaper: (level, paper) => all('SELECT qid FROM questions WHERE level=? AND paper=? ORDER BY type DESC, num', [level, paper]),
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
  // 错题带题目信息(老师查看 + 个性化用)
  wrongbookDetailed: (uid, level) => all(`SELECT w.qid, w.wrong_count, q.chapter_id, q.section_id, q.type, q.level
    FROM wrongbook w JOIN questions q ON q.qid=w.qid
    WHERE w.user_id=? AND w.mastered=0 AND q.level=? ORDER BY w.wrong_count DESC, w.updated_at DESC`, [uid, level]),
  // 个性化:按章节集合抽未做过/做错的同类新题,排除已在错题里的原题
  sampleByChapters: (uid, chapterIds, n) => {
    if (!chapterIds.length) return Promise.resolve([]);
    const ph = chapterIds.map(() => '?').join(',');
    return all(`SELECT q.* FROM questions q
      WHERE q.chapter_id IN (${ph})
        AND q.qid NOT IN (SELECT qid FROM wrongbook WHERE user_id=? AND mastered=0)
      ORDER BY RANDOM() LIMIT ?`, [...chapterIds, uid, n]);
  },
  // 班级共性弱点:全班错题按章节聚合
  classWeakness: (level) => all(`SELECT q.chapter_id, c.name, COUNT(*) wrong_total, COUNT(DISTINCT w.user_id) students
    FROM wrongbook w
    JOIN class_members m ON m.user_id=w.user_id AND m.level=?
    JOIN questions q ON q.qid=w.qid AND q.level=?
    JOIN chapters c ON c.id=q.chapter_id
    WHERE w.mastered=0 GROUP BY q.chapter_id ORDER BY wrong_total DESC`, [level, level]),
  addBookmark: (uid, qid) => run('INSERT OR IGNORE INTO bookmarks(user_id,qid) VALUES(?,?)', [uid, qid]),
  delBookmark: (uid, qid) => run('DELETE FROM bookmarks WHERE user_id = ? AND qid = ?', [uid, qid]),
  bookmarkQids: (uid) => all('SELECT qid FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC', [uid]),

  // ---- 积分 / 排行 / 打卡(全局,跨级) ---- 积分:每条正确作答 单选+2、判断+1
  leaderboard: (lim) => all(`
    SELECT u.id, u.username, u.avatar,
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
  mockCountForLevel: (uid, lv) => get('SELECT COUNT(*) c FROM mock_results WHERE user_id = ? AND level = ?', [uid, lv]),

  // ===== 管理后台 · 题目编辑 =====
  questionsForAdmin: (lv) => all(`SELECT q.qid,q.level,q.chapter_id,q.section_id,q.type,q.paper,q.num,q.answer,q.difficulty,
      (CASE WHEN q.explanation IS NOT NULL AND q.explanation <> '' THEN 1 ELSE 0 END) has_exp,
      (CASE WHEN o.qid IS NOT NULL THEN 1 ELSE 0 END) overridden
    FROM questions q LEFT JOIN question_overrides o ON o.qid = q.qid
    WHERE q.level = ? ORDER BY q.section_id, q.ord`, [lv]),
  updateQuestion: (qid, p) => run(`UPDATE questions SET
      answer=COALESCE(?,answer), stem=COALESCE(?,stem), code=COALESCE(?,code),
      options_json=COALESCE(?,options_json), explanation=COALESCE(?,explanation), difficulty=COALESCE(?,difficulty)
    WHERE qid=?`, [p.answer ?? null, p.stem ?? null, p.code ?? null, p.options_json ?? null, p.explanation ?? null, p.difficulty ?? null, qid]),
  setQuestionOverride: (qid, p) => run(`INSERT INTO question_overrides(qid,answer,stem,code,options_json,explanation,difficulty,updated_at)
      VALUES(?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(qid) DO UPDATE SET
        answer=COALESCE(excluded.answer,question_overrides.answer),
        stem=COALESCE(excluded.stem,question_overrides.stem),
        code=COALESCE(excluded.code,question_overrides.code),
        options_json=COALESCE(excluded.options_json,question_overrides.options_json),
        explanation=COALESCE(excluded.explanation,question_overrides.explanation),
        difficulty=COALESCE(excluded.difficulty,question_overrides.difficulty),
        updated_at=datetime('now')`,
    [qid, p.answer ?? null, p.stem ?? null, p.code ?? null, p.options_json ?? null, p.explanation ?? null, p.difficulty ?? null]),
  delQuestionOverride: (qid) => run('DELETE FROM question_overrides WHERE qid = ?', [qid]),

  // ===== 管理后台 · 用户 =====
  adminListUsers: (like, lim) => all(`SELECT u.id,u.username,u.avatar,u.email,u.tier,u.vip_until,u.created_at,u.disabled,
      COALESCE(SUM(CASE WHEN a.correct=1 THEN (CASE WHEN q.type='mc' THEN 2 ELSE 1 END) ELSE 0 END),0) points,
      COUNT(a.id) attempts
    FROM users u LEFT JOIN attempts a ON a.user_id=u.id LEFT JOIN questions q ON q.qid=a.qid
    WHERE u.username LIKE ? GROUP BY u.id ORDER BY u.created_at DESC LIMIT ?`, [like, lim]),
  adminUserDetail: (uid) => get(`SELECT
      (SELECT COUNT(*) FROM attempts WHERE user_id=?) attempts,
      (SELECT COUNT(*) FROM mock_results WHERE user_id=?) mocks,
      (SELECT COUNT(*) FROM wrongbook WHERE user_id=? AND mastered=0) wrongs`, [uid, uid, uid]),

  // ===== 管理后台 · 兑换码 =====
  createCode: (code, tier, days, batch, note) => run('INSERT INTO redeem_codes(code,tier,days,batch,note) VALUES(?,?,?,?,?)', [code, tier, days, batch || null, note || null]),
  setCodeNote: (code, note) => run('UPDATE redeem_codes SET note = ? WHERE code = ?', [note, code]),
  listCodes: (lim) => all(`SELECT c.code,c.tier,c.days,c.batch,c.note,c.status,c.used_by,c.used_at,c.created_at,u.username used_name
    FROM redeem_codes c LEFT JOIN users u ON u.id=c.used_by ORDER BY c.created_at DESC LIMIT ?`, [lim]),
  getCode: (code) => get('SELECT * FROM redeem_codes WHERE code = ?', [code]),
  useCode: (code, uid) => run("UPDATE redeem_codes SET status='used', used_by=?, used_at=datetime('now') WHERE code=? AND status='unused'", [uid, code]),
  disableCode: (code) => run("UPDATE redeem_codes SET status='disabled' WHERE code=? AND status='unused'", [code]),

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

async function deleteUserCascade(uid) {
  for (const t of ['attempts', 'wrongbook', 'bookmarks', 'mock_results']) await run(`DELETE FROM ${t} WHERE user_id = ?`, [uid]);
  await run('DELETE FROM users WHERE id = ?', [uid]);
}
async function adminStats() {
  const one = async (sql, a = []) => Number(((await get(sql, a)) || {}).c || 0);
  const users = await one('SELECT COUNT(*) c FROM users');
  const vip = await one("SELECT COUNT(*) c FROM users WHERE tier='vip' AND (vip_until IS NULL OR vip_until > datetime('now'))");
  const attempts = await one('SELECT COUNT(*) c FROM attempts');
  const mocks = await one('SELECT COUNT(*) c FROM mock_results');
  const byLevel = await all("SELECT level, COUNT(*) c, SUM(CASE WHEN explanation<>'' THEN 1 ELSE 0 END) exp FROM questions GROUP BY level ORDER BY level");
  const codes = await all('SELECT status, COUNT(*) c FROM redeem_codes GROUP BY status');
  const recent = await all('SELECT id,username,avatar,tier,created_at FROM users ORDER BY created_at DESC LIMIT 8');
  return {
    users, vip, free: Math.max(0, users - vip), attempts, mocks,
    levels: byLevel.map(r => ({ level: Number(r.level), count: Number(r.c), exp: Number(r.exp || 0) })),
    codes: Object.fromEntries(codes.map(r => [r.status, Number(r.c)])),
    recent: recent.map(r => ({ id: Number(r.id), username: r.username, avatar: r.avatar, tier: r.tier, created_at: r.created_at })),
  };
}

module.exports = { client, Q, initDb, reseedAll, loadAllLevels, questionsByQids, shapeQuestion, deleteUserCascade, adminStats, applyAllOverrides, DB_PATH };
