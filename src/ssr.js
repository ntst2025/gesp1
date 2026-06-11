'use strict';
/*
 * 服务端渲染:为每道题输出一个独立、免登录、可被百度/中国大陆大模型抓取的静态 HTML 单题页。
 * 设计目标:
 *  - 纯服务端 HTML(不依赖 JS 渲染),百度蜘蛛/LLM 抓取友好。
 *  - 语义化结构 + <title>/description/keywords + schema.org(QAPage) 结构化数据。
 *  - 分层:一~三级整篇解析公开(吃搜题流量+引流);四~八级题干+答案公开、解析上锁(保护 VIP)。
 */

const LEVEL_CN = { 1: '一级', 2: '二级', 3: '三级', 4: '四级', 5: '五级', 6: '六级', 7: '七级', 8: '八级' };

function esc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function paperCN(p) { const [y, m] = String(p).split('-'); return `${y}年${parseInt(m, 10)}月`; }
function typeCN(t) { return t === 'mc' ? '单选题' : '判断题'; }
function ansCN(q) { return q.type === 'tf' ? (q.answer === '√' ? '正确（√）' : '错误（×）') : q.answer; }

// 解析富文本:与前端 fmtExp 一致 —— `code`、**bold**、💡 提示框（先转义，再加标签）
function fmtExp(t) {
  let s = esc(t);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/💡(.*)$/, '<span class="tip">💡$1</span>');
  return s;
}
// 代码块（已转义）
function fmtCode(code) {
  if (!code || !String(code).trim()) return '';
  return `<pre class="code">${esc(code)}</pre>`;
}
// 选项列表（单选）
function fmtOptions(q) {
  if (q.type !== 'mc') return '';
  let opts = {};
  try { opts = JSON.parse(q.options_json || '{}'); } catch (e) { opts = {}; }
  const keys = Object.keys(opts);
  if (!keys.length) return '';
  const li = keys.map(k => {
    const on = (k === q.answer) ? ' class="opt right"' : ' class="opt"';
    return `<li${on}><b>${esc(k)}.</b> ${esc(String(opts[k]))}</li>`;
  }).join('');
  return `<ul class="opts">${li}</ul>`;
}

// 纯文本摘要（用于 meta description / 结构化数据），单行、去富文本标记
function plainText(t, max) {
  let s = String(t || '').replace(/[`*]/g, '').replace(/💡/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = s.slice(0, max) + '…';
  return s;
}

// JSON-LD 安全嵌入（防止 </script> 截断）
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/*
 * 渲染单题页。
 * 入参:{ q, section, prev, next, base, expFree, baiduPush }
 *  - q: 题目行(含 level/paper/type/num/stem/code/options_json/answer/explanation)
 *  - section: 所属知识点(section 行,可空)
 *  - prev/next: 同卷上一题/下一题 {qid, type, num} (可空)
 *  - base: 站点根 URL(用于 canonical/og)
 *  - expFree: 是否公开完整解析(一~三级 true)
 */
function renderQuestionPage({ q, section, prev, next, base, expFree, baiduPush }) {
  const lv = LEVEL_CN[q.level] || `${q.level}级`;
  const pcn = paperCN(q.paper);
  const tcn = typeCN(q.type);
  const numLabel = `第${q.num}题`;
  const h1 = `GESP ${pcn} C++${lv} ${tcn} ${numLabel}`;
  const title = `${h1}答案及解析 | GESPPASS`;
  const url = `${base}/q/${q.qid}`;
  const ans = ansCN(q);
  const stemPlain = plainText(q.stem, 70);
  const desc = `【GESP C++${lv}真题】${pcn}${tcn}${numLabel}：${stemPlain} 答案：${ans}。`
    + (expFree && q.explanation ? plainText(q.explanation, 80) : '完整解析与逐题精讲尽在 GESPPASS。');
  const kw = ['GESP', `C++${lv}`, `GESP${q.paper.replace('-', '年') + '月'}`, 'GESP真题',
    'GESP真题解析', `GESP${lv}真题`, `GESP${lv}解析`, numLabel + '答案', 'CCF GESP', '编程等级认证'].join(',');

  // 结构化数据:QAPage(题干 + 已采纳答案)。锁区不暴露完整解析。
  const answerText = `答案：${ans}。` + (expFree && q.explanation ? plainText(q.explanation, 500) : '');
  const ld = {
    '@context': 'https://schema.org', '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: `${h1}`,
      text: plainText(q.stem, 300) + (q.type === 'mc' ? '' : ''),
      answerCount: 1, educationalLevel: `GESP C++${lv}`, inLanguage: 'zh-CN',
      acceptedAnswer: { '@type': 'Answer', text: answerText, url }
    }
  };

  // 解析区(分层)
  let expBlock;
  if (q.explanation && expFree) {
    expBlock = `<div class="exp"><div class="exp-h">题目解析</div>${fmtExp(q.explanation)}</div>`;
  } else if (q.explanation) {
    const teaser = plainText(q.explanation, 38);
    expBlock = `<div class="exp locked"><div class="exp-h">题目解析</div>`
      + `<p class="teaser">${esc(teaser)}……</p>`
      + `<div class="lock"><b>完整解析为会员内容</b><span>四级及以上的逐题精讲需开通 VIP。一～三级全部免费。</span>`
      + `<a class="btn" href="/app?level=${q.level}">前往 GESPPASS 解锁</a></div></div>`;
  } else {
    expBlock = '';
  }

  // 上一题/下一题
  const nav = `<nav class="qnav">`
    + (prev ? `<a href="/q/${prev.qid}">← 上一题</a>` : `<span class="dim">← 上一题</span>`)
    + `<a href="/app?level=${q.level}" class="mid">本套真题</a>`
    + (next ? `<a href="/q/${next.qid}">下一题 →</a>` : `<span class="dim">下一题 →</span>`)
    + `</nav>`;

  const sectionLine = section
    ? `<p class="meta-line">所属知识点：<a href="/app?level=${q.level}">${esc(section.name)}</a>　难度要求：${esc(section.req || '—')}　考频：${esc(section.freq || '—')}</p>`
    : '';

  // 其他级别内链（增强抓取深度）
  const lvLinks = Object.keys(LEVEL_CN).map(n =>
    `<a href="/app?level=${n}">C++${LEVEL_CN[n]}</a>`).join(' · ');

  const baiduJs = baiduPush
    ? `<script>(function(){var s=document.createElement('script');s.src='https://zz.bdstatic.com/linksubmit/push.js';var t=document.getElementsByTagName('script')[0];t.parentNode.insertBefore(s,t);})();</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(plainText(desc, 150))}">
<meta name="keywords" content="${esc(kw)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(plainText(desc, 150))}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="GESPPASS">
<meta name="robots" content="index,follow">
<meta name="applicable-device" content="pc,mobile">
<script type="application/ld+json">${jsonLd(ld)}</script>
<style>
:root{--ink:#13182e;--ink2:#5b6178;--line:#e6e8f0;--brand:#ef3b57;--pass:#0e9a72;--exp:#1d6753;--gold:#fcf0d8}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:var(--ink);line-height:1.7;background:#f6f7fb}
.wrap{max-width:760px;margin:0 auto;padding:18px 16px 60px}
header.site{display:flex;align-items:center;gap:9px;padding:6px 0 16px;border-bottom:1px solid var(--line);margin-bottom:18px}
header.site .logo{font-weight:800;font-size:20px;color:var(--brand);letter-spacing:.5px}
header.site .slogan{font-size:13px;color:var(--ink2)}
.crumb{font-size:13px;color:var(--ink2);margin-bottom:10px}
.crumb a{color:var(--ink2);text-decoration:none}
h1{font-size:20px;line-height:1.4;margin:0 0 6px}
.tags{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px}
.tags span{font-size:12.5px;padding:2px 9px;border-radius:6px;background:#eef0f6;color:#5b6178}
.tags .t-lv{background:#e6eefc;color:#185fa5}.tags .t-tp{background:#fce9ec;color:#d92f4a}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}
.stem{font-size:17px;margin:0 0 12px}
pre.code{background:#1e2030;color:#cdd6f4;padding:14px 16px;border-radius:10px;overflow-x:auto;font-family:'JetBrains Mono',Consolas,monospace;font-size:14px;line-height:1.75;white-space:pre}
ul.opts{list-style:none;padding:0;margin:8px 0 0;font-family:'JetBrains Mono',Consolas,monospace;font-size:15px}
ul.opts .opt{padding:5px 10px;border-radius:7px;color:#5b6178;margin:3px 0}
ul.opts .opt.right{background:#e3f7ef;color:var(--pass);font-weight:600}
.answer{font-size:16px;margin:14px 0 0}.answer b{color:var(--pass);font-size:18px}
.exp{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin-bottom:16px;color:var(--exp);font-size:16px}
.exp-h{font-weight:700;color:var(--ink);margin-bottom:8px;font-size:15px}
.exp code{font-family:'JetBrains Mono',Consolas,monospace;background:#e3f0eb;color:#0e5a40;padding:1px 5px;border-radius:4px;font-size:14px}
.exp strong{color:#0c5840}
.exp .tip{display:block;margin-top:9px;padding:9px 12px;background:var(--gold);border-radius:7px;color:#8a6d3b;font-size:15px}
.exp .tip code{background:#f5e8cb;color:#7a5a1a}.exp .tip strong{color:#6b521f}
.exp.locked .teaser{color:#5b6178}
.lock{margin-top:10px;background:#fff8ec;border:1px dashed #f0b35b;border-radius:10px;padding:13px 15px}
.lock b{color:#c4560f;display:block}.lock span{font-size:14px;color:#8a5a12;display:block;margin:3px 0 9px}
.lock .btn,.btn{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600}
.meta-line{font-size:13.5px;color:var(--ink2);margin:0 0 14px}.meta-line a{color:#185fa5;text-decoration:none}
.qnav{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:18px 0}
.qnav a{color:var(--brand);text-decoration:none;font-weight:600;font-size:14px}
.qnav .mid{color:var(--ink2);font-weight:500}.qnav .dim{color:#c9cdd8;font-size:14px}
.cta{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 20px;text-align:center;margin:16px 0}
.cta p{margin:0 0 10px;font-size:15px;color:var(--ink2)}
footer{border-top:1px solid var(--line);margin-top:26px;padding-top:16px;font-size:13px;color:var(--ink2)}
footer .lv{margin:6px 0}footer a{color:var(--ink2);text-decoration:none}
footer .links a{color:#185fa5;margin-right:12px}
</style>
</head>
<body>
<div class="wrap">
<header class="site"><span class="logo">GESPPASS</span><span class="slogan">GESP C++ 真题 · 逐题精解</span></header>
<div class="crumb"><a href="/">首页</a> › <a href="/app?level=${q.level}">C++${lv}真题</a> › ${pcn} › ${numLabel}</div>
<h1>${esc(h1)}</h1>
<div class="tags"><span class="t-lv">C++${lv}</span><span class="t-tp">${tcn}</span><span>${pcn}</span><span>${numLabel}</span></div>
${sectionLine}
<article class="card">
<div class="stem">${esc(q.stem)}</div>
${fmtCode(q.code)}
${fmtOptions(q)}
<p class="answer">正确答案：<b>${esc(ans)}</b></p>
</article>
${expBlock}
${nav}
<div class="cta"><p>想系统刷完 GESP C++ 1～8 级真题，并查看每道题的逐题精讲？</p><a class="btn" href="/app?level=${q.level}">进入 GESPPASS 开始练习</a></div>
<footer>
<div class="lv">GESPPASS 收录 CCF GESP C++ 全级别历年真题，逐题精解：${lvLinks}</div>
<div class="links"><a href="/">首页</a><a href="/about">关于</a><a href="/app?level=${q.level}">本级真题</a></div>
<div style="margin-top:8px;color:#9aa0b4">GESPPASS · GESP C++ 真题解析平台</div>
</footer>
</div>
${baiduJs}
</body>
</html>`;
}

module.exports = { renderQuestionPage, LEVEL_CN };
