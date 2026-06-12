'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { Q, initDb, questionsByQids, shapeQuestion, deleteUserCascade, adminStats } = require('./src/db');
const { register, login, authRequired, signAdminToken, adminRequired } = require('./src/auth');
const { renderQuestionPage } = require('./src/ssr');
const PROG = require('./src/prog');
let TRAPS = null;
try { TRAPS = require('./data/traps.json'); } catch (e) { TRAPS = { categories: [] }; }

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
app.get('/api/auth/me', authRequired, (req, res) => res.json({ user: { ...req.user, vip: vipActive(req.user) } }));

// 管理员手动开通/取消 VIP(线下收款后手动发放;需在环境变量 ADMIN_KEY 配置一个随机密钥)
app.post('/api/admin/set-tier', adminRequired, wrap(async (req, res) => {
  const { username, tier = 'vip', days } = req.body || {};
  const u = await Q.userByName((username || '').trim());
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const isVip = tier === 'vip';
  const until = (isVip && days && Number(days) > 0) ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null;
  await Q.setTier(u.id, isVip ? 'vip' : 'free', isVip ? until : null);
  res.json({ ok: true, username: u.username, tier: isVip ? 'vip' : 'free', vip_until: until });
}));

/* ===== 级别列表(门户/级别切换用) ===== */
app.get('/api/levels', authRequired, wrap(async (req, res) => {
  const rows = await Q.levelsList();
  res.json({ levels: rows.map(r => ({ level: N(r.level), name: r.name, total: N(r.total), mc: N(r.mc), tf: N(r.tf), chapters: N(r.chapters) })) });
}));

/* ===== 题库目录(按级别) ===== */
// 陷阱通关手册(公开,免费一级内容)
app.get('/api/traps', (req, res) => { res.json(TRAPS || { categories: [] }); });

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
  res.json({ questions: rows.map(r => { const q = { ...shapeQuestion(r), bookmarked: marked.has(r.qid) }; if (expLocked(r.level, req.user) && r.explanation) { q.explanation = ''; q.locked = true; } return q; }), by_paper });
}));

// 搜索(按级别)
app.get('/api/search', authRequired, wrap(async (req, res) => {
  const kw = (req.query.q || '').trim();
  if (!kw) return res.json({ questions: [], count: 0 });
  const like = '%' + kw.replace(/[%_]/g, m => '\\' + m) + '%';
  const rows = await Q.search(like, LV(req));
  res.json({ questions: rows.map(r => { const q = shapeQuestion(r); if (expLocked(r.level, req.user) && r.explanation) { q.explanation = ''; q.locked = true; } return q; }), count: rows.length });
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
  const locked = expLocked(row.level, req.user) && !!row.explanation;
  res.json({ correct: !!correct, answer: row.answer, explanation: locked ? '' : row.explanation, locked });
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
// ===== 会员(免费 / VIP)=====
function vipActive(u) {
  if (!u || u.tier !== 'vip') return false;
  if (!u.vip_until) return true;            // 永久 VIP
  return new Date(u.vip_until).getTime() > Date.now();
}
// 免费用户:仅一级解析免费(引流);二级及以上解析为 VIP 专享(题目与答案仍对所有人可见)
// 2026-06 起:一至八级真题与解析全部免费(降低真题版权敏感度;VIP 转向讲义等自研增值内容)
function expLocked(level, user) { return false; }
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
// 平台初期的「示例对手」——让本周排行榜更有竞争氛围(真人会按积分插入其中并逐步超越)
const DEMO_RIVALS = [
  { username: '编程小王子',   avatar: 'a1', points: 1280, attempts: 156 },
  { username: '代码键盘侠',   avatar: 'a2', points: 1150, attempts: 138 },
  { username: '循环不打烊',   avatar: 'a9', points: 990,  attempts: 121 },
  { username: '二叉树观察员', avatar: 'a4', points: 935,  attempts: 110 },
  { username: '指针没指空',   avatar: 'a7', points: 905,  attempts: 104 },
  { username: '递归不打草稿', avatar: 'a6', points: 860,  attempts: 98  },
  { username: '摸鱼也能AC',   avatar: 'a5', points: 790,  attempts: 90  },
  { username: '数组越界君',   avatar: 'a11', points: 760,  attempts: 85  },
  { username: '变量起名废',   avatar: '🐹', points: 720,  attempts: 80  },
  { username: '一遍过选手',   avatar: '🦄', points: 690,  attempts: 74  },
  { username: '调试到天亮',   avatar: '🐸', points: 655,  attempts: 69  },
  { username: '栈里有乾坤',   avatar: '🐵', points: 610,  attempts: 63  },
];
app.get('/api/leaderboard', authRequired, wrap(async (req, res) => {
  const real = await Q.leaderboard(50);
  const merged = [
    ...real.map(r => ({ id: r.id, username: r.username, avatar: r.avatar || 'a1', points: N(r.points), attempts: N(r.attempts), me: r.id === req.user.id })),
    ...DEMO_RIVALS.map(d => ({ id: null, username: d.username, avatar: d.avatar, points: d.points, attempts: d.attempts, me: false })),
  ];
  // 确保当前用户始终在榜(即便还没答题)
  if (!merged.some(x => x.me)) {
    const pr = await Q.userPointsRow(req.user.id);
    merged.push({ id: req.user.id, username: req.user.username, avatar: req.user.avatar || 'a1', points: N(pr.points), attempts: N(pr.attempts), me: true });
  }
  merged.sort((a, b) => b.points - a.points || b.attempts - a.attempts);
  const top = merged.map((u, i) => { const t = tierOf(u.points); return { rank: i + 1, username: u.username, avatar: u.avatar, points: u.points, attempts: u.attempts, tier: t.name, icon: t.icon, me: u.me }; });
  res.json({ top: top.slice(0, 50), me: top.find(x => x.me) });
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
  const lv = Number(level) || 1;
  const rows = await Q.questionsByPaper(lv, paper);
  if (!rows.length) return res.status(404).json({ error: '未找到该套真题' });
  const mc = rows.filter(r => r.type === 'mc').length, tf = rows.filter(r => r.type === 'tf').length;
  res.json({ level: lv, paper, mc, tf, total: rows.length, duration_sec: 40 * 60,
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
    const _locked = expLocked(r.level, req.user) && !!r.explanation;
    details.push({ qid: r.qid, type: r.type, num: r.num, correct: !!ok, your: chosen == null ? '' : String(chosen),
      answer: r.answer, explanation: _locked ? '' : r.explanation, locked: _locked, stem: r.stem, code: r.code, options: JSON.parse(r.options_json || '{}') });
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

/* ===== 用户:兑换码激活 VIP ===== */
app.post('/api/redeem', authRequired, wrap(async (req, res) => {
  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: '请输入兑换码' });
  const c = await Q.getCode(code);
  if (!c) return res.status(404).json({ error: '兑换码不存在' });
  if (c.status === 'used') return res.status(409).json({ error: '该兑换码已被使用' });
  if (c.status === 'disabled') return res.status(409).json({ error: '该兑换码已失效' });
  const r = await Q.useCode(code, req.user.id);            // 原子占用:仅 unused 可成功
  if (!r || N(r.rowsAffected) === 0) return res.status(409).json({ error: '该兑换码刚刚已被使用' });
  const days = N(c.days);
  const until = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  await Q.setTier(req.user.id, 'vip', until);
  res.json({ ok: true, tier: 'vip', vip_until: until, days });
}));

/* ===================== 管理后台 API ===================== */
app.post('/api/admin/login', wrap(async (req, res) => {
  if (!process.env.ADMIN_KEY) return res.status(403).json({ error: '后台未启用:请在服务器环境变量中配置 ADMIN_KEY' });
  if (((req.body && req.body.key) || '') !== process.env.ADMIN_KEY) return res.status(401).json({ error: '管理员密钥错误' });
  res.json({ token: signAdminToken() });
}));
app.get('/api/admin/stats', adminRequired, wrap(async (req, res) => res.json(await adminStats())));

// --- 题目 ---
app.get('/api/admin/questions', adminRequired, wrap(async (req, res) => {
  res.json({ questions: await Q.questionsForAdmin(N(req.query.level) || 1) });
}));
app.get('/api/admin/question/:qid', adminRequired, wrap(async (req, res) => {
  const r = await Q.questionByQid(req.params.qid);
  if (!r) return res.status(404).json({ error: '题目不存在' });
  res.json({ question: { ...shapeQuestion(r), answer: r.answer, explanation: r.explanation, ord: r.ord } });
}));
app.put('/api/admin/question/:qid', adminRequired, wrap(async (req, res) => {
  const qid = req.params.qid, b = req.body || {};
  if (!(await Q.questionByQid(qid))) return res.status(404).json({ error: '题目不存在' });
  const patch = {
    answer: b.answer != null ? String(b.answer) : null,
    stem: b.stem != null ? String(b.stem) : null,
    code: b.code != null ? String(b.code) : null,
    options_json: b.options != null ? JSON.stringify(b.options) : null,
    explanation: b.explanation != null ? String(b.explanation) : null,
    difficulty: b.difficulty != null ? Number(b.difficulty) : null,
  };
  await Q.updateQuestion(qid, patch);      // 立即生效
  await Q.setQuestionOverride(qid, patch); // 记录覆盖,重灌不丢
  res.json({ ok: true });
}));
app.post('/api/admin/question/:qid/reset', adminRequired, wrap(async (req, res) => {
  await Q.delQuestionOverride(req.params.qid);
  res.json({ ok: true, note: '已移除后台覆盖;该题将在下次内容更新(版本号变化)时恢复为原始题库内容' });
}));

// --- 用户 ---
app.get('/api/admin/users', adminRequired, wrap(async (req, res) => {
  const like = '%' + String(req.query.q || '').replace(/[%_]/g, m => '\\' + m) + '%';
  res.json({ users: await Q.adminListUsers(like, Math.min(200, N(req.query.limit) || 100)) });
}));
app.get('/api/admin/users/:id', adminRequired, wrap(async (req, res) => {
  res.json({ detail: await Q.adminUserDetail(N(req.params.id)) });
}));
app.delete('/api/admin/users/:id', adminRequired, wrap(async (req, res) => {
  await deleteUserCascade(N(req.params.id));
  res.json({ ok: true });
}));

// --- 兑换码 ---
function genCode() {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉易混 I O 0 1
  let s = ''; for (let i = 0; i < 12; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return 'GESP-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}
app.get('/api/admin/codes', adminRequired, wrap(async (req, res) => {
  res.json({ codes: await Q.listCodes(Math.min(500, N(req.query.limit) || 200)) });
}));
app.post('/api/admin/codes', adminRequired, wrap(async (req, res) => {
  const b = req.body || {};
  const qty = Math.max(1, Math.min(200, N(b.qty) || 1));
  const days = Math.max(0, N(b.days) || 0);     // 0 = 永久
  const batch = (b.batch || '').toString().slice(0, 40) || null;
  const made = [];
  for (let i = 0; i < qty; i++) {
    let code, ok = false;
    for (let t = 0; t < 5 && !ok; t++) { code = genCode(); try { await Q.createCode(code, 'vip', days, batch); ok = true; } catch (e) { /* 撞码重试 */ } }
    if (ok) made.push(code);
  }
  res.json({ ok: true, created: made.length, days, codes: made });
}));
app.post('/api/admin/codes/:code/disable', adminRequired, wrap(async (req, res) => {
  await Q.disableCode(req.params.code);
  res.json({ ok: true });
}));

/* ===== 入门讲义(纸质教程电子版) ===== */
// 数据来自 data/lessons/levelN.json(由教程 docx 转换生成);文件级缓存,与题库 DB 无关。
const LESSONS_CACHE = {};
function lessonBook(level) {
  const n = Number(level);
  if (!(n >= 1 && n <= 8)) return null;
  if (!LESSONS_CACHE[n]) {
    try { LESSONS_CACHE[n] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'lessons', `level${n}.json`), 'utf8')); }
    catch (e) { return null; }
  }
  return LESSONS_CACHE[n];
}
// 门槛与解析一致(方案A):一级全免费;二至八级「前言 + 第 1 章」免费试读,其余 VIP 专享。
function lessonLocked(level, chapterId, user) {
  if (Number(level) === 1) return false;
  if (chapterId === 'c0' || chapterId === 'c1') return false;
  return !vipActive(user);
}
app.get('/api/lessons', authRequired, wrap(async (req, res) => {
  const level = Number(req.query.level || 1);
  const book = lessonBook(level);
  if (!book) return res.status(404).json({ error: '本级别讲义暂未上线' });
  res.json({
    level, title: book.title, brand: book.brand,
    chapters: book.chapters.map(c => ({
      id: c.id, num: c.num, title: c.title, sections: c.sections,
      locked: lessonLocked(level, c.id, req.user),
    })),
  });
}));
app.get('/api/lessons/chapter', authRequired, wrap(async (req, res) => {
  const level = Number(req.query.level || 1);
  const book = lessonBook(level);
  if (!book) return res.status(404).json({ error: '本级别讲义暂未上线' });
  const idx = book.chapters.findIndex(c => c.id === String(req.query.id || ''));
  if (idx < 0) return res.status(404).json({ error: '章节不存在' });
  const c = book.chapters[idx];
  const locked = lessonLocked(level, c.id, req.user);
  res.json({
    id: c.id, num: c.num, title: c.title, sections: c.sections, locked,
    html: locked ? '' : c.html,
    prev: book.chapters[idx - 1] ? { id: book.chapters[idx - 1].id, title: book.chapters[idx - 1].title } : null,
    next: book.chapters[idx + 1] ? { id: book.chapters[idx + 1].id, title: book.chapters[idx + 1].title } : null,
  });
}));

/* ===== 编程题(在线评测) ===== */
app.get('/api/prog', authRequired, wrap(async (req, res) => {
  const bank = PROG.progBank(req.query.level || 1);
  if (!bank) return res.status(404).json({ error: '本级别编程题暂未上线' });
  const st = {}; (await Q.myProgStatus(req.user.id)).forEach(r => st[r.pid] = r);
  res.json({
    level: bank.level, judge: PROG.judgeAvailable(),
    questions: bank.questions.map(q => ({
      pid: q.pid, paper: q.paper, num: q.num, title: q.title,
      ac: !!(st[q.pid] && st[q.pid].ac), tries: st[q.pid] ? st[q.pid].tries : 0,
    })),
  });
}));
app.get('/api/prog/:pid', authRequired, wrap(async (req, res) => {
  const q = PROG.progByPid(req.params.pid);
  if (!q) return res.status(404).json({ error: '题目不存在' });
  const last = await Q.myLastCode(req.user.id, q.pid);
  res.json({
    pid: q.pid, paper: q.paper, num: q.num, title: q.title,
    time_limit: q.time_limit, mem_limit: q.mem_limit,
    statement: q.statement, samples: q.samples, solution: q.solution, solution_zh: q.solution_zh || '',
    kps: q.kps || [], analysis: q.analysis || '',
    judge: PROG.judgeAvailable(), last_code: last ? last.code : '',
    submissions: await Q.mySubmissions(req.user.id, q.pid),
  });
}));
app.post('/api/prog/:pid/submit', authRequired, wrap(async (req, res) => {
  const code = String((req.body || {}).code || '');
  if (code.trim().length < 10) return res.status(400).json({ error: '请先写好代码再提交' });
  if (code.length > 20000) return res.status(400).json({ error: '代码过长(上限 20000 字符)' });
  if (!PROG.judgeAvailable()) return res.status(503).json({ error: '在线评测暂未开通,请稍后再试' });
  const today = (await Q.submissionCountToday(req.user.id)).n;
  if (today >= 100) return res.status(429).json({ error: "今日提交次数已达上限(100 次),明天再来吧" });
  const r = await PROG.judgeSubmission(req.params.pid, code);
  if (r.error) return res.status(502).json({ error: r.error });
  await Q.addSubmission(req.params.pid, req.user.id, code, r.verdict, r.passed || 0, r.total || 0);
  res.json(r);
}));

/* ===== 题目报错 ===== */
app.post('/api/questions/:qid/report', authRequired, wrap(async (req, res) => {
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 2 || reason.length > 300) return res.status(400).json({ error: '请用 2–300 字描述问题' });
  let q = await Q.questionByQid(req.params.qid);
  if (!q) q = PROG.progByPid(req.params.qid); // 编程题题号也可报错
  if (!q) return res.status(404).json({ error: '题目不存在' });
  const today = (await Q.reportCountToday(req.user.id)).n;
  if (today >= 20) return res.status(429).json({ error: '今日反馈次数已达上限,感谢你的热心!' });
  await Q.addReport(req.params.qid, req.user.id, reason);
  res.json({ ok: true });
}));
app.get('/api/admin/reports', adminRequired, wrap(async (req, res) => {
  res.json({ reports: await Q.listReports(req.query.status || null) });
}));
app.post('/api/admin/reports/:id/status', adminRequired, wrap(async (req, res) => {
  const st = String((req.body || {}).status || 'closed');
  if (!['open', 'closed'].includes(st)) return res.status(400).json({ error: 'status 取值 open/closed' });
  await Q.setReportStatus(Number(req.params.id), st);
  res.json({ ok: true });
}));

/* ===== 用户头像 ===== */
// 接受:预设 id(a1-a12) / 短 emoji / 自定义图片 dataURL(客户端已压到 128px,≤60KB 串长)
app.post('/api/me/avatar', authRequired, wrap(async (req, res) => {
  const av = String((req.body || {}).avatar || '').trim();
  const okPreset = /^a([1-9]|1[0-2])$/.test(av);
  const okEmoji = av && av.length <= 8 && !av.startsWith('data:');
  const okData = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(av) && av.length <= 60000;
  if (!okPreset && !okEmoji && !okData) return res.status(400).json({ error: '头像格式不支持或图片过大' });
  await Q.setAvatar(req.user.id, av);
  res.json({ ok: true, avatar: av });
}));

/* ===== 百度主动推送(普通收录 API) ===== */
// 站点前缀必须与百度站长平台登记的完全一致(含 www);token 走环境变量,不入库不入仓库。
const BAIDU_SITE_BASE = (process.env.BAIDU_SITE_BASE || 'https://www.gesppass.com').replace(/\/+$/, '');
function baiduUrlList(refs) {
  const statics = ['/', '/app?level=1', '/app?level=2', '/app?level=3', '/app?level=4', '/app?level=5', '/app?level=6', '/app?level=7', '/app?level=8', '/about', '/terms', '/privacy'];
  // 优先级:静态页 -> 一级单题(解析免费,SEO 价值最高) -> 其余级别
  const l1 = refs.filter(r => Number(r.level) === 1), rest = refs.filter(r => Number(r.level) !== 1);
  return statics.map(u => BAIDU_SITE_BASE + u).concat(l1.concat(rest).map(r => `${BAIDU_SITE_BASE}/q/${r.qid}`));
}
app.get('/api/admin/baidu/status', adminRequired, wrap(async (req, res) => {
  const refs = await Q.allQuestionRefs();
  const total = baiduUrlList(refs).length;
  const pushed = (await Q.baiduPushCount()).n;
  res.json({ total, pushed, pending: total - pushed, site: BAIDU_SITE_BASE, tokenSet: !!process.env.BAIDU_TOKEN });
}));
app.post('/api/admin/baidu/push', adminRequired, wrap(async (req, res) => {
  const token = process.env.BAIDU_TOKEN;
  if (!token) return res.status(400).json({ error: '未配置 BAIDU_TOKEN 环境变量(在 Render 的 Environment 里添加后重启)' });
  const limit = Math.max(1, Math.min(2000, Number((req.body || {}).limit) || 100));
  const refs = await Q.allQuestionRefs();
  const done = new Set((await Q.baiduPushedUrls()).map(r => r.url));
  const pending = baiduUrlList(refs).filter(u => !done.has(u));
  if (!pending.length) return res.json({ ok: true, submitted: 0, success: 0, remain: null, msg: '全部 URL 均已推送过' });
  const batch = pending.slice(0, limit);
  const api = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(BAIDU_SITE_BASE)}&token=${encodeURIComponent(token)}`;
  let data;
  try {
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: batch.join('\n') });
    data = await r.json();
  } catch (e) { return res.status(502).json({ error: '调用百度接口失败:' + e.message }); }
  if (data.error) return res.status(400).json({ error: `百度返回错误 ${data.error}: ${data.message || ''}` });
  const okCount = Number(data.success) || 0;
  if (okCount > 0) await Q.baiduMarkPushed(batch.slice(0, okCount));
  res.json({ ok: true, submitted: batch.length, success: okCount, remain: data.remain, not_same_site: data.not_same_site || [], pending: pending.length - okCount });
}));

/* ===== SEO + 法务页(干净 URL) ===== */
function siteBase(req){ const proto=(req.headers['x-forwarded-proto']||req.protocol||'https').split(',')[0]; return proto+'://'+req.headers.host; }

// 服务端渲染单题页(免登录、可被百度/大模型抓取);分层与 App 一致(复用 expLocked)
app.get('/q/:qid', wrap(async (req, res) => {
  const qid = String(req.params.qid || '');
  const q = await Q.questionByQid(qid);
  if (!q) {
    res.status(404).type('text/html; charset=utf-8').send(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>题目未找到 | GESPPASS</title><body style="font-family:sans-serif;max-width:560px;margin:60px auto;text-align:center;color:#13182e"><h1 style="color:#ef3b57">GESPPASS</h1><p>没有找到这道题。</p><p><a href="/" style="color:#185fa5">返回首页</a></p></body></html>`);
    return;
  }
  const [section, sib] = await Promise.all([
    q.section_id ? Q.sectionById(q.section_id) : null,
    Q.questionsByLevelPaper(q.level, q.paper),
  ]);
  let prev = null, next = null;
  const idx = sib.findIndex(r => r.qid === qid);
  if (idx >= 0) { prev = sib[idx - 1] || null; next = sib[idx + 1] || null; }
  const expFree = !expLocked(q.level, null);
  const html = renderQuestionPage({ q, section, prev, next, base: siteBase(req), expFree, baiduPush: !!process.env.BAIDU_PUSH });
  res.set('Cache-Control', 'public, max-age=3600').type('text/html; charset=utf-8').send(html);
}));

app.get('/sitemap.xml', wrap(async (req, res) => {
  const b = siteBase(req);
  const statics = ['/', '/app?level=1', '/app?level=2', '/app?level=3', '/app?level=4', '/app?level=5', '/app?level=6', '/app?level=7', '/app?level=8', '/about', '/terms', '/privacy'];
  let refs = [];
  try { refs = await Q.allQuestionRefs(); } catch (e) { refs = []; }
  const locs = statics.map(u => b + u.replace(/&/g, '&amp;')).concat(refs.map(r => `${b}/q/${r.qid}`));
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + locs.map(u => `  <url><loc>${u}</loc></url>`).join('\n') + '\n</urlset>';
  res.type('application/xml').send(xml);
}));
app.get('/robots.txt',(req,res)=>{ res.type('text/plain').send(`User-agent: *\nAllow: /\n\nUser-agent: Baiduspider\nAllow: /\n\nUser-agent: Bytespider\nAllow: /\n\nUser-agent: Sogou web spider\nAllow: /\n\nUser-agent: PetalBot\nAllow: /\n\nUser-agent: YisouSpider\nAllow: /\n\nSitemap: ${siteBase(req)}/sitemap.xml\n`); });
app.get('/about',(req,res)=>res.sendFile(path.join(__dirname,'public','about.html')));
app.get('/terms',(req,res)=>res.sendFile(path.join(__dirname,'public','terms.html')));
app.get('/privacy',(req,res)=>res.sendFile(path.join(__dirname,'public','privacy.html')));

/* ===== 前端兜底 ===== */
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ===== 启动 ===== */
(async () => {
  const r = await initDb();
  app.listen(PORT, () => console.log(`\n✅ GESP 多级别学习平台已启动: http://localhost:${PORT}  (内容版本 ${r.version}${r.migrated ? ', 已迁移/更新' : ''})\n`));
})().catch(err => { console.error('❌ 启动失败:', err); process.exit(1); });
