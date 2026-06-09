'use strict';
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Q, initDb, questionsByQids, shapeQuestion } = require('./src/db');
const { register, login, authRequired } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  res.status(err.status || 500).json({ error: err.message || '服务器错误' });
});
const N = v => Number(v || 0);
const LV = req => Number(req.query.level) || 1;

/* ===== 认证 ===== */
app.post('/api/auth/register', wrap(async (req, res) => res.json(await register(req.body || {}))));
app.post('/api/auth/login',    wrap(async (req, res) => res.json(await login(req.body || {}))));
app.get('/api/auth/me', authRequired, (req, res) => res.json({ user: req.user }));

/* ===== 级别列表(门户/级别切换用) ===== */
app.get('/api/levels', authRequired, wrap(async (req, res) => {
  const rows = await Q.levelsList();
  res.json({ levels: rows.map(r => ({ level: N(r.level), name: r.name, total: N(r.total), mc: N(r.mc), tf: N(r.tf), chapters: N(r.chapters) })) });
}));

/* ===== 题库目录(按级别) ===== */
app.get('/api/catalog', authRequired, wrap(async (req, res) => {
  const lv = LV(req);
  const [level, chapters, sections, chAgg, secAgg, papers] = await Promise.all([
    Q.levelById(lv), Q.chaptersByLevel(lv), Q.sectionsByLevel(lv),
    Q.countChaptersByLevel(lv), Q.countSectionsByLevel(lv), Q.distinctPapersByLevel(lv),
  ]);
  const chMap = Object.fromEntries(chAgg.map(r => [r.chapter_id, r]));
  const secMap = Object.fromEntries(secAgg.map(r => [r.section_id, r]));
  const secByCh = {};
  sections.forEach(s => { (secByCh[s.chapter_id] ||= []).push(s); });
  const out = chapters.map(c => {
    const cc = chMap[c.id] || {};
    const secs = (secByCh[c.id] || []).map(s => {
      const sc = secMap[s.id] || {};
      return { id: s.id, name: s.name, req: s.req, freq: s.freq, difficulty: s.difficulty,
               count: N(sc.c), mc: N(sc.mc), tf: N(sc.tf) };
    });
    return { id: c.id, name: c.name, req: c.req, freq: c.freq, difficulty: c.difficulty,
             count: N(cc.c), mc: N(cc.mc), tf: N(cc.tf),
             kp: secs.filter(s => s.count > 0).length, explained: N(cc.explained), sections: secs };
  });
  const total = out.reduce((a, c) => a + c.count, 0);
  res.json({
    level: lv, level_name: level ? level.name : ('C++ ' + lv + '级'),
    meta: { total, mc: out.reduce((a, c) => a + c.mc, 0), tf: out.reduce((a, c) => a + c.tf, 0), papers: papers.map(r => r.paper) },
    chapters: out,
  });
}));

// 某节全部真题(含答案+解析)
app.get('/api/sections/:sid/questions', authRequired, wrap(async (req, res) => {
  const [rows, marks] = await Promise.all([
    Q.questionsBySection(req.params.sid), Q.bookmarkQids(req.user.id),
  ]);
  const by_paper = {};
  rows.forEach(r => { by_paper[r.paper] = (by_paper[r.paper] || 0) + 1; });
  const marked = new Set(marks.map(b => b.qid));
  res.json({ questions: rows.map(r => ({ ...shapeQuestion(r), bookmarked: marked.has(r.qid) })), by_paper });
}));

// 搜索(按级别)
app.get('/api/search', authRequired, wrap(async (req, res) => {
  const kw = (req.query.q || '').trim();
  if (!kw) return res.json({ questions: [], count: 0 });
  const like = '%' + kw.replace(/[%_]/g, m => '\\' + m) + '%';
  const rows = await Q.search(like, LV(req));
  res.json({ questions: rows.map(r => shapeQuestion(r)), count: rows.length });
}));

/* ===== 做题 / 判分 ===== */
app.post('/api/practice/start', authRequired, wrap(async (req, res) => {
  const { mode = 'random', id, count = 10, level = 1 } = req.body || {};
  const n = Math.max(1, Math.min(50, count | 0));
  let rows;
  if (mode === 'section')      rows = await Q.randomBySection(id, n);
  else if (mode === 'chapter') rows = await Q.randomByChapter(id, n);
  else if (mode === 'wrongbook') {
    const qids = (await Q.wrongbookQids(req.user.id)).map(w => w.qid);
    rows = (await questionsByQids(qids)).sort(() => Math.random() - 0.5).slice(0, n);
  } else rows = await Q.randomByLevel(Number(level) || 1, n);
  res.json({ questions: rows.map(r => shapeQuestion(r, { withAnswer: false })) });
}));

app.post('/api/attempts', authRequired, wrap(async (req, res) => {
  const { qid, chosen } = req.body || {};
  const row = await Q.questionByQid(qid);
  if (!row) return res.status(404).json({ error: '题目不存在' });
  const correct = String(chosen) === String(row.answer) ? 1 : 0;
  await Q.addAttempt(req.user.id, qid, String(chosen ?? ''), correct);
  if (correct) await Q.clearWrongOnCorrect(req.user.id, qid);
  else         await Q.upsertWrong(req.user.id, qid);
  res.json({ correct: !!correct, answer: row.answer, explanation: row.explanation });
}));

app.get('/api/attempts/recent', authRequired, wrap(async (req, res) => {
  res.json({ attempts: await Q.attemptsByUser(req.user.id, 50) });
}));

/* ===== 错题本 ===== */
app.get('/api/wrongbook', authRequired, wrap(async (req, res) => {
  const items = await Q.wrongbookQids(req.user.id);
  const byQid = Object.fromEntries((await questionsByQids(items.map(i => i.qid))).map(r => [r.qid, r]));
  const questions = items.filter(i => byQid[i.qid]).map(i => ({ ...shapeQuestion(byQid[i.qid]), wrong_count: N(i.wrong_count) }));
  res.json({ questions, count: questions.length });
}));
app.post('/api/wrongbook/:qid/master', authRequired, wrap(async (req, res) => {
  await Q.setMastered(1, req.user.id, req.params.qid); res.json({ ok: true });
}));

/* ===== 收藏 ===== */
app.get('/api/bookmarks', authRequired, wrap(async (req, res) => {
  const qids = (await Q.bookmarkQids(req.user.id)).map(b => b.qid);
  res.json({ questions: (await questionsByQids(qids)).map(r => ({ ...shapeQuestion(r), bookmarked: true })) });
}));
app.post('/api/bookmarks/:qid', authRequired, wrap(async (req, res) => {
  await Q.addBookmark(req.user.id, req.params.qid); res.json({ ok: true });
}));
app.delete('/api/bookmarks/:qid', authRequired, wrap(async (req, res) => {
  await Q.delBookmark(req.user.id, req.params.qid); res.json({ ok: true });
}));

/* ===== 学习进度(按级别) ===== */
app.get('/api/progress', authRequired, wrap(async (req, res) => {
  const uid = req.user.id, lv = LV(req);
  const [progRows, ta, answered, wbc, bms, chapters, chAgg] = await Promise.all([
    Q.progressByChapter(uid, lv), Q.totalAttempts(uid, lv), Q.totalAnswered(uid, lv),
    Q.wrongbookCount(uid), Q.bookmarkQids(uid), Q.chaptersByLevel(lv), Q.countChaptersByLevel(lv),
  ]);
  const progMap = Object.fromEntries(progRows.map(r => [r.chapter_id, r]));
  const totMap = Object.fromEntries(chAgg.map(r => [r.chapter_id, N(r.c)]));
  const by_chapter = chapters.map(c => {
    const p = progMap[c.id] || {};
    return { id: c.id, name: c.name, total: totMap[c.id] || 0, answered: N(p.answered), correct: N(p.correct) };
  });
  const taC = N(ta.c), taOk = N(ta.ok);
  res.json({
    level: lv, answered: N(answered.c), total_questions: by_chapter.reduce((a, c) => a + c.total, 0),
    attempts: taC, correct_attempts: taOk, accuracy: taC ? Math.round((taOk / taC) * 100) : 0,
    wrongbook_count: N(wbc.c), bookmark_count: bms.length, by_chapter,
  });
}));

/* ===== 前端兜底 ===== */
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ===== 启动 ===== */
(async () => {
  const r = await initDb();
  app.listen(PORT, () => console.log(`\n✅ GESP 多级别学习平台已启动: http://localhost:${PORT}  (内容版本 ${r.version}${r.migrated ? ', 已迁移/更新' : ''})\n`));
})().catch(err => { console.error('❌ 启动失败:', err); process.exit(1); });
