'use strict';
/* 编程题(OJ)模块:题库文件加载 + 判题
 * 判题后端(环境变量 JUDGE_BACKEND 选择):
 *   piston(默认) — emkc.org 公共 Piston API,免费、无需 Key,限速 5 次/秒
 *                  可用 PISTON_URL 指向自托管实例(将来 HK VPS)
 *   judge0       — 需配 JUDGE0_KEY(RapidAPI);JUDGE0_URL 可选
 *   local        — 仅本地开发自测,禁止生产开启
 */
const fs = require('fs');
const path = require('path');

const PROG_DIR = path.join(__dirname, '..', 'data', 'prog');
const CACHE = {};

function progBank(level) {
  const n = Number(level);
  if (!(n >= 1 && n <= 8)) return null;
  if (!CACHE[n]) {
    try { CACHE[n] = JSON.parse(fs.readFileSync(path.join(PROG_DIR, `level${n}.json`), 'utf8')); }
    catch (e) { return null; }
  }
  return CACHE[n];
}
function progByPid(pid) {
  const m = String(pid).match(/^(\d)-/);
  const bank = m && progBank(m[1]);
  return bank ? bank.questions.find(q => q.pid === pid) || null : null;
}
function testcases(pid) {
  const m = String(pid).match(/^(\d)-/);
  if (!m) return [];
  const dir = path.join(PROG_DIR, 'tc', `level${m[1]}`, pid);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.in')).sort(); } catch (e) { return []; }
  return files.map(f => ({
    name: f.replace('.in', ''),
    input: fs.readFileSync(path.join(dir, f), 'utf8'),
    expected: fs.readFileSync(path.join(dir, f.replace('.in', '.out')), 'utf8'),
  }));
}

/* ---- 输出比较:忽略行尾空白与末尾空行 ---- */
function outEq(got, exp) {
  const norm = s => String(s || '').split('\n').map(l => l.replace(/[ \t\r]+$/, '')).join('\n').replace(/\n+$/, '');
  return norm(got) === norm(exp);
}

/* ---- 判题后端 1:Piston 公共 API(默认,免费无Key,限速5次/秒) ---- */
let PISTON_VER = null; // c++ 运行时版本缓存
async function pistonVersion(base) {
  if (PISTON_VER) return PISTON_VER;
  try {
    const r = await fetch(`${base}/runtimes`);
    const list = await r.json();
    const cpp = (list || []).find(x => x.language === 'c++' || (x.aliases || []).includes('c++'));
    PISTON_VER = cpp ? cpp.version : '10.2.0';
  } catch (e) { PISTON_VER = '10.2.0'; }
  return PISTON_VER;
}
async function pistonRun(code, input, timeLimit) {
  const base = (process.env.PISTON_URL || 'https://emkc.org/api/v2/piston').replace(/\/+$/, '');
  const version = await pistonVersion(base);
  const r = await fetch(`${base}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: 'c++', version,
      files: [{ name: 'main.cpp', content: code }],
      stdin: input,
      compile_timeout: 10000,
      run_timeout: Math.min(Math.max((timeLimit || 1) * 1000, 1000), 5000),
    }),
  });
  if (r.status === 429) { await new Promise(s => setTimeout(s, 600)); return pistonRun(code, input, timeLimit); }
  if (!r.ok) throw new Error(`判题服务响应 ${r.status}`);
  const d = await r.json();
  if (d.compile && d.compile.code !== 0) return { kind: 'CE', detail: String(d.compile.stderr || d.compile.output || '').slice(0, 1500) };
  const run = d.run || {};
  if (run.signal === 'SIGKILL') return { kind: 'TLE' };
  if (run.code !== 0) return { kind: 'RE', detail: String(run.stderr || '').slice(0, 800) };
  return { kind: 'OK', output: String(run.stdout || '') };
}

/* ---- 判题后端 2:Judge0 (可选,JUDGE_BACKEND=judge0 时启用) ---- */
async function judge0Run(code, input, timeLimit) {
  const base = process.env.JUDGE0_URL || 'https://judge0-ce.p.rapidapi.com';
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.JUDGE0_KEY) {
    headers['X-RapidAPI-Key'] = process.env.JUDGE0_KEY;
    headers['X-RapidAPI-Host'] = base.replace(/^https?:\/\//, '');
  }
  const r = await fetch(`${base}/submissions?base64_encoded=true&wait=true`, {
    method: 'POST', headers,
    body: JSON.stringify({
      language_id: 54, // C++ (GCC 9+)
      source_code: Buffer.from(code).toString('base64'),
      stdin: Buffer.from(input).toString('base64'),
      cpu_time_limit: Math.min(Math.max(timeLimit || 1, 1), 5),
      memory_limit: 256000,
    }),
  });
  if (!r.ok) throw new Error(`判题服务响应 ${r.status}`);
  const d = await r.json();
  const dec = s => (s ? Buffer.from(s, 'base64').toString('utf8') : '');
  const sid = d.status && d.status.id;
  // Judge0 状态:3=Accepted(运行成功) 5=TLE 6=CE 7-12=RE 等
  if (sid === 6) return { kind: 'CE', detail: dec(d.compile_output).slice(0, 1500) };
  if (sid === 5) return { kind: 'TLE' };
  if (sid >= 7 && sid <= 12) return { kind: 'RE', detail: (dec(d.stderr) || d.status.description || '').slice(0, 800) };
  if (sid === 3 || sid === 4) return { kind: 'OK', output: dec(d.stdout) };
  return { kind: 'RE', detail: (d.status && d.status.description) || '未知状态' };
}

/* ---- 判题后端 2:本地(仅开发自测) ---- */
async function localRun(code, input, timeLimit) {
  const os = require('os');
  const cp = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-'));
  const src = path.join(dir, 'a.cpp'), bin = path.join(dir, 'a.out');
  fs.writeFileSync(src, code);
  const c = cp.spawnSync('g++', ['-O2', '-o', bin, src], { timeout: 15000, encoding: 'utf8' });
  if (c.status !== 0) { fs.rmSync(dir, { recursive: true, force: true }); return { kind: 'CE', detail: (c.stderr || '').slice(0, 1500) }; }
  const r = cp.spawnSync(bin, [], { input, timeout: (timeLimit || 1) * 1000 + 500, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.error && r.error.code === 'ETIMEDOUT') return { kind: 'TLE' };
  if (r.status !== 0) return { kind: 'RE', detail: (r.stderr || '').slice(0, 800) };
  return { kind: 'OK', output: r.stdout };
}

// 后端选择:JUDGE_BACKEND = piston(默认) | judge0 | local
function pickBackend() {
  const b = (process.env.JUDGE_BACKEND || '').toLowerCase();
  if (b === 'local' || process.env.LOCAL_JUDGE === '1') return localRun;
  if (b === 'judge0') return judge0Run;
  return pistonRun; // 默认:Piston 公共 API,免费无需配置
}
function judgeAvailable() {
  const b = (process.env.JUDGE_BACKEND || '').toLowerCase();
  if (b === 'judge0') return !!process.env.JUDGE0_KEY;
  return true; // piston/local 无需密钥
}

/* ---- 评测一份提交:逐测试点,遇到非 AC 停止 ---- */
async function judgeSubmission(pid, code) {
  const q = progByPid(pid);
  if (!q) return { error: '题目不存在' };
  const tcs = testcases(pid);
  if (!tcs.length) return { error: '本题测试数据暂缺' };
  const run = pickBackend();
  const results = [];
  let verdict = 'AC';
  for (const tc of tcs) {
    let r;
    if (results.length && run === pistonRun) await new Promise(s => setTimeout(s, 250)); // 公共API限速保险
    try { r = await run(code, tc.input, q.time_limit); }
    catch (e) { return { error: '判题服务暂时不可用:' + e.message }; }
    if (r.kind === 'CE') return { verdict: 'CE', compile_output: r.detail, results: [] };
    if (r.kind === 'OK' && outEq(r.output, tc.expected)) {
      results.push({ name: tc.name, status: 'AC' });
    } else {
      const st = r.kind === 'TLE' ? 'TLE' : r.kind === 'RE' ? 'RE' : 'WA';
      results.push({ name: tc.name, status: st, detail: r.detail || '' });
      verdict = st;
      break; // 首个失败点即停,节省判题配额
    }
  }
  return { verdict, results, passed: results.filter(x => x.status === 'AC').length, total: tcs.length };
}

module.exports = { progBank, progByPid, testcases, judgeSubmission, judgeAvailable };
