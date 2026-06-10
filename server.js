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

/* ===== 成就 / 积分 / 打卡(全局) ===== */
function tierOf(points) {
  const tiers = [[1500, '宗师', '👑'], [700, '大师', '🏆'], [350, '高手', '🏅'], [150, '进阶', '📘'], [50, '见习', '📗'], [0, '入门', '🌱']];
  for (const [min, name, icon] of tiers) if (points >= min) return { name, icon, min };
  return { name: '入门', icon: '🌱', min: 0 };
}
function streakOf(dateRows) {
  const set = new Set(dateRows.map(r => r.d));
  const total = set.size;
  if (!total) return { current: 0, total: 0, today: false };
  const fmt = d => d.toISOString().slice(0, 10);
  const today = new Date(); const todayStr = fmt(today);
  const todayDone = set.has(todayStr);
  let cur = 0; const cursor = new Date(today);
  if (!set.has(todayStr)) { cursor.setDate(cursor.getDate() - 1); if (!set.has(fmt(cursor))) return { current: 0, total, today: false }; }
  while (set.has(fmt(cursor))) { cur++; cursor.setDate(cursor.getDate() - 1); }
  return { current: cur, total, today: todayDone };
}
app.get('/api/stats/me', authRequired, wrap(async (req, res) => {
  const uid = req.user.id;
  const [pr, dates] = await Promise.all([Q.userPointsRow(uid), Q.attemptDates(uid)]);
  const points = N(pr.points), attempts = N(pr.attempts), correct = N(pr.correct);
  const tier = tierOf(points), st = streakOf(dates);
  const next = [50, 150, 350, 700, 1500].find(x => x > points);
  res.json({
    points, attempts, correct, accuracy: attempts ? Math.round(correct / attempts * 100) : 0,
    tier: tier.name, tier_icon: tier.icon, next_at: next || null, to_next: next ? next - points : 0,
    streak: st.current, streak_total: st.total, today_done: st.today,
  });
}));
app.get('/api/leaderboard', authRequired, wrap(async (req, res) => {
  const rows = await Q.leaderboard(50);
  const top = rows.map((r, i) => { const t = tierOf(N(r.points)); return { rank: i + 1, username: r.username, points: N(r.points), attempts: N(r.attempts), tier: t.name, icon: t.icon, me: r.id === req.user.id }; });
  let me = top.find(x => x.me);
  if (!me) { const pr = await Q.userPointsRow(req.user.id); const t = tierOf(N(pr.points)); me = { rank: null, username: req.user.username, points: N(pr.points), tier: t.name, icon: t.icon, me: true }; }
  res.json({ top, me });
}));

app.get('/api/activity', authRequired, wrap(async (req, res) => {
  const rows = await Q.activityByDate(req.user.id);
  res.json({ days: rows.map(r => ({ d: r.d, c: N(r.c) })) });
}));

/* ===== 限时模考(整套真题 · 客观题) ===== */
app.get('/api/mock/papers', authRequired, wrap(async (req, res) => {
  const lv = LV(req);
  const [papers, secAgg] = await Promise.all([Q.distinctPapersByLevel(lv), null]);
  const rows = await Promise.all(papers.map(async p => {
    const qs = await Q.questionsByPaper(lv, p.paper);
    const mc = qs.filter(q => q.type === 'mc').length, tf = qs.filter(q => q.type === 'tf').length;
    return { paper: p.paper, mc, tf, total: qs.length };
  }));
  const hist = await Q.mockHistory(req.user.id);
  res.json({ level: lv, papers: rows, history: hist.map(h => ({ level: N(h.level), paper: h.paper, score: N(h.score), total_score: N(h.total_score), correct: N(h.correct), total_q: N(h.total_q), created_at: h.created_at })) });
}));
app.post('/api/mock/start', authRequired, wrap(async (req, res) => {
  const { level = 1, paper } = req.body || {};
  const rows = await Q.questionsByPaper(Number(level) || 1, paper);
  if (!rows.length) return res.status(404).json({ error: '未找到该套真题' });
  const mc = rows.filter(r => r.type === 'mc').length, tf = rows.filter(r => r.type === 'tf').length;
  res.json({ level: Number(level) || 1, paper, mc, tf, total: rows.length, duration_sec: 40 * 60,
    questions: rows.map(r => shapeQuestion(r, { withAnswer: false })) });
}));
app.post('/api/mock/submit', authRequired, wrap(async (req, res) => {
  const { level = 1, paper, answers = {} } = req.body || {};
  const lv = Number(level) || 1;
  const rows = await Q.questionsByPaper(lv, paper);
  if (!rows.length) return res.status(404).json({ error: '未找到该套真题' });
  let correct = 0, mc_correct = 0, tf_correct = 0, mc_total = 0, tf_total = 0;
  const details = [];
  for (const r of rows) {
    const chosen = answers[r.qid];
    const answered = chosen != null && chosen !== '';
    const ok = answered && String(chosen) === String(r.answer) ? 1 : 0;
    if (r.type === 'mc') { mc_total++; if (ok) mc_correct++; } else { tf_total++; if (ok) tf_correct++; }
    if (ok) correct++;
    if (answered) {  // 仅作答过的计入进度/错题本
      await Q.addAttempt(req.user.id, r.qid, String(chosen), ok);
      if (ok) await Q.clearWrongOnCorrect(req.user.id, r.qid); else await Q.upsertWrong(req.user.id, r.qid);
    }
    details.push({ qid: r.qid, type: r.type, num: r.num, correct: !!ok, your: chosen == null ? '' : String(chosen),
      answer: r.answer, explanation: r.explanation, stem: r.stem, code: r.code, options: JSON.parse(r.options_json || '{}') });
  }
  const total_q = rows.length, total_score = (mc_total + tf_total) * 2, score = correct * 2;
  await Q.addMockResult(req.user.id, lv, paper, score, total_score, correct, total_q);
  const best = await Q.mockBestForPaper(lv, paper);
  res.json({ score, total_score, correct, total_q, mc_correct, mc_total, tf_correct, tf_total,
    takers: best.length, rank: best.filter(b => N(b.best) > score).length + 1, details });
}));

/* ===== AI 个性化推荐(基于错题与各知识点掌握度) ===== */
app.get('/api/recommend', authRequired, wrap(async (req, res) => {
  const uid = req.user.id, lv = LV(req);
  const [stats, wrongs, seen, sections, secAgg, chapters] = await Promise.all([
    Q.sectionStatsByLevel(uid, lv), Q.wrongbookQids(uid), Q.seenQidsByLevel(uid, lv),
    Q.sectionsByLevel(lv), Q.countSectionsByLevel(lv), Q.chaptersByLevel(lv),
  ]);
  const secCount = Object.fromEntries(secAgg.map(r => [r.section_id, N(r.c)]));
  const statMap = Object.fromEntries(stats.map(r => [r.section_id, r]));
  const chName = Object.fromEntries(chapters.map(c => [c.id, c.name]));
  const seenSet = new Set(seen.map(r => r.qid));
  const wrongSet = new Set(wrongs.map(w => w.qid));
  const wrongQ = await questionsByQids([...wrongSet]);
  const wrongBySec = {};
  wrongQ.forEach(q => { if (q.level === lv) wrongBySec[q.section_id] = (wrongBySec[q.section_id] || 0) + 1; });
  const cand = [];
  sections.forEach(s => {
    const total = secCount[s.id] || 0; if (total === 0) return;
    const st = statMap[s.id] || {}; const answered = N(st.answered), correct = N(st.correct);
    const wrongN = wrongBySec[s.id] || 0; const acc = answered ? correct / answered : null;
    let weak;
    if (wrongN > 0) weak = 100 + wrongN * 10 + (acc != null ? (1 - acc) * 20 : 0);
    else if (answered > 0) weak = (1 - acc) * 80 + 1;
    else weak = 30;
    cand.push({ section_id: s.id, chapter_id: s.chapter_id, chapter: chName[s.chapter_id] || '', name: s.name,
      total, answered, correct, wrong: wrongN, accuracy: acc == null ? null : Math.round(acc * 100), weak });
  });
  cand.sort((a, b) => b.weak - a.weak);
  const withSignal = cand.filter(c => c.wrong > 0 || c.answered > 0);
  const personalized = withSignal.length > 0;
  const pool = (personalized ? withSignal : cand).slice(0, 6);
  const sids = pool.map(p => p.section_id);
  const qs = await Q.questionsBySectionIds(sids);
  const tagged = qs.map(q => ({ q, pr: wrongSet.has(q.qid) ? 0 : (!seenSet.has(q.qid) ? 1 : 2), rnd: Math.random() }));
  tagged.sort((a, b) => a.pr - b.pr || a.rnd - b.rnd);
  const pick = tagged.slice(0, 12).map(t => t.q);
  res.json({
    level: lv, personalized,
    weak_points: pool.slice(0, 5),
    set_size: pick.length,
    from_wrongbook: tagged.slice(0, 12).filter(t => t.pr === 0).length,
    questions: pick.map(r => shapeQuestion(r, { withAnswer: false })),
  });
}));

/* ===== SEO + 法务页(干净 URL) ===== */
function siteBase(req){ const proto=(req.headers['x-forwarded-proto']||req.protocol||'https').split(',')[0]; return proto+'://'+req.headers.host; }
app.get('/sitemap.xml',(req,res)=>{
  const b=siteBase(req);
  const urls=['/','/app?level=1','/app?level=6','/app?level=7','/app?level=8','/about','/terms','/privacy'];
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
    urls.map(u=>`  <url><loc>${b}${u.replace(/&/g,'&amp;')}</loc></url>`).join('\n')+'\n</urlset>';
  res.type('application/xml').send(xml);
});
app.get('/robots.txt',(req,res)=>{ res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${siteBase(req)}/sitemap.xml\n`); });
app.get('/about',(req,res)=>res.sendFile(path.join(__dirname,'public','about.html')));
app.get('/terms',(req,res)=>res.sendFile(path.join(__dirname,'public','terms.html')));
app.get('/privacy',(req,res)=>res.sendFile(path.join(__dirname,'public','privacy.html')));

/* ===== 前端兜底 ===== */
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ===== 启动 ===== */
(async () => {
  const r = await initDb();
  app.listen(PORT, () => console.log(`\n✅ GESP 多级别学习平台已启动: http://localhost:${PORT}  (内容版本 ${r.version}${r.migrated ? ', 已迁移/更新' : ''})\n`));
})().catch(err => { console.error('❌ 启动失败:', err); process.exit(1); });
