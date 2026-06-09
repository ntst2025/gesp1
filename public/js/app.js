'use strict';
/* ===================== 鉴权 + API ===================== */
const TOKEN = localStorage.getItem('gesp_token');
const USER  = localStorage.getItem('gesp_user') || '同学';
if (!TOKEN) location.href = '/';
const LEVEL = new URLSearchParams(location.search).get('level') || '1';
function logout(){ localStorage.removeItem('gesp_token'); localStorage.removeItem('gesp_user'); location.href='/'; }

async function api(path, opts={}){
  const r = await fetch(path, { ...opts,
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+TOKEN, ...(opts.headers||{}) } });
  if (r.status===401){ localStorage.removeItem('gesp_token'); location.href='/'; throw new Error('未登录'); }
  const d = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(d.error || '请求失败');
  return d;
}

/* ===================== 通用 helper ===================== */
const PALETTE = ['#d92332','#3498db','#e67e22','#9b59b6','#16a085','#1abc9c','#f39c12','#34495e','#2ecc71','#e84393'];
const REQ_CLS = {'了解':'req-low','熟悉':'req-mid','掌握':'req-high'};
let PAPERS = [];
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function short(id){return String(id).split(':').pop();}  // 'L1:c1'->'c1', 'L8:1.1'->'1.1'
function papLabel(p){const [y,m]=p.split('-');return y.slice(2)+'.'+parseInt(m);}
function papFull(p){const [y,m]=p.split('-');return y+'年'+parseInt(m)+'月';}
function hl(code){
  let s=esc(code);
  s=s.replace(/(\/\/[^\n]*)/g,'<span class="hl-cm">$1</span>');
  s=s.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|"[^"\n]*"|'[^'\n]*')/g,'<span class="hl-str">$1</span>');
  s=s.replace(/\b(\d+\.?\d*)\b/g,'<span class="hl-num">$1</span>');
  s=s.replace(/\b(for|while|do|if|else|switch|case|break|continue|return|const|unsigned|namespace|using|include|std|cin|cout|endl|printf|scanf|main)\b/g,'<span class="hl-kw">$1</span>');
  s=s.replace(/\b(int|long|float|double|char|bool|void)\b/g,'<span class="hl-ty">$1</span>');
  return s;
}
function hlInline(t){ let s=esc(t); s=s.replace(/`([^`]+)`/g,(m,p)=>`<code>${p}</code>`); return s; }
function stars(n){ let h=''; for(let i=1;i<=5;i++){ if(n>=i)h+='★'; else if(n>=i-0.5)h+='<span style="position:relative;display:inline-block"><span class="empty">★</span><span style="position:absolute;left:0;width:50%;overflow:hidden">★</span></span>'; else h+='<span class="empty">★</span>'; } return '<span class="stars">'+h+'</span>'; }
function badge(req){return `<span class="badge ${REQ_CLS[req]||''}">${req}</span>`;}
function freqB(f){return `<span class="b-freq freq-${f}">${f}</span>`;}

function pie(items){
  items=items.filter(d=>d.value>0);
  const total=items.reduce((a,b)=>a+b.value,0)||1; const cx=90,cy=90,r=80; let a0=-Math.PI/2,paths='';
  items.forEach((d,i)=>{ const ang=d.value/total*Math.PI*2,a1=a0+ang;
    const x0=cx+r*Math.cos(a0),y0=cy+r*Math.sin(a0),x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
    const large=ang>Math.PI?1:0,color=d.color||PALETTE[i%PALETTE.length];
    if(items.length===1)paths+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
    else paths+=`<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
    a0=a1; });
  const legend=items.map((d,i)=>{const color=d.color||PALETTE[i%PALETTE.length];const pct=(d.value/total*100).toFixed(0);
    return `<div class="lg"><span class="sw" style="background:${color}"></span><span class="lg-n">${esc(d.name)}</span><span class="lg-v">${d.value} · ${pct}%</span></div>`;}).join('');
  return `<div class="chart-wrap"><svg width="180" height="180" viewBox="0 0 180 180">${paths}</svg><div class="legend">${legend}</div></div>`;
}
function bar(byPaper){
  const W=720,H=240,padL=34,padB=42,padT=16,padR=10;
  const vals=PAPERS.map(p=>byPaper[p]||0),maxV=Math.max(1,...vals),niceMax=Math.ceil(maxV);
  const plotW=W-padL-padR,plotH=H-padT-padB,bw=plotW/PAPERS.length; let bars='',xlab='',ylab='';
  for(let i=0;i<=niceMax;i++){ if(niceMax>6&&i%2)continue; const y=padT+plotH-(i/niceMax)*plotH;
    ylab+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#eef1f4"/><text x="${padL-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#95a5a6">${i}</text>`;}
  vals.forEach((v,i)=>{ const bh=(v/niceMax)*plotH,x=padL+i*bw+bw*0.18,y=padT+plotH-bh,w=bw*0.64;
    if(v>0)bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="#5b8def"/><text x="${(x+w/2).toFixed(1)}" y="${(y-4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#5b8def" font-weight="600">${v}</text>`;
    xlab+=`<text x="${(padL+i*bw+bw/2).toFixed(1)}" y="${H-padB+16}" text-anchor="middle" font-size="9.5" fill="#7f8c8d">${papLabel(PAPERS[i])}</text>`; });
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="max-width:760px">${ylab}<line x1="${padL}" y1="${padT+plotH}" x2="${W-padR}" y2="${padT+plotH}" stroke="#ccd1d6"/>${bars}${xlab}</svg>`;
}

/* ===================== 状态 + 路由 ===================== */
let CATALOG=null;
let view={tab:'browse',sub:'overview',cid:null,sid:null};
let browsePage={};
const sectionCache={};
const C = ()=>document.getElementById('content');

function setActiveTab(tab){ ['browse','practice','recommend','mock','wrong','progress','rank','mark'].forEach(t=>{
  const el=document.getElementById('tab-'+t); if(el) el.classList.toggle('on',t===tab); }); }

async function go(tab){
  setActiveTab(tab); document.getElementById('q').value='';
  if(tab==='browse'){ view={tab:'browse',sub:'overview'}; await ensureCatalog(); renderBrowse(); }
  else if(tab==='practice'){ await ensureCatalog(); renderPracticeSetup(); }
  else if(tab==='recommend'){ await ensureCatalog(); await renderRecommend(); }
  else if(tab==='mock'){ await ensureCatalog(); await renderMock(); }
  else if(tab==='wrong'){ await renderWrong(); }
  else if(tab==='progress'){ await renderProgress(); }
  else if(tab==='rank'){ await renderRank(); }
  else if(tab==='mark'){ await renderMark(); }
  window.scrollTo(0,0);
}

async function ensureCatalog(){
  if(CATALOG) return CATALOG;
  C().innerHTML='<div class="empty"><div class="big">⏳</div>加载题库中…</div>';
  CATALOG=await api('/api/catalog?level='+LEVEL); PAPERS=CATALOG.meta.papers; document.querySelectorAll('.badge-sub').forEach(e=>{e.textContent=CATALOG.level_name;}); return CATALOG;
}

/* ===================== 题库浏览 ===================== */
function browseLayout(mainHtml){
  return `<div class="layout"><aside class="side"><div class="card" id="sidebar"></div></aside><main class="main" id="bmain">${mainHtml}</main></div>`;
}
function renderSidebar(){
  const rows=CATALOG.chapters.map(c=>{
    const act=(view.cid===c.id)?'active':'';
    return `<div class="nav-item ${act}" onclick="goBrowse('chapter','${c.id}')">
      <span class="ni-name"><span class="caret">▶</span><span class="ch">第${short(c.id).slice(1)}章</span> ${c.name}</span>
      <span class="ni-x"><span class="badge ${REQ_CLS[c.req]}" style="transform:scale(.86)">${c.req}</span></span>
      <span class="ni-x ni-kp">${c.kp}</span><span class="ni-x ni-q">${c.count}</span></div>`;}).join('');
  const ov=view.sub==='overview'?'active':'';
  const el=document.getElementById('sidebar'); if(!el)return;
  el.innerHTML=`<div class="nav-title">分章知识真题</div>
    <div class="nav-cols"><span class="nc-name">章节</span><span class="nc-x">要求</span><span class="nc-x">知识点</span><span class="nc-x">真题</span></div>
    <div class="nav-item ov ${ov}" onclick="goBrowse('overview')"><span class="ni-name" style="padding-left:16px">总览</span><span class="ni-x"></span><span class="ni-x"></span><span class="ni-x"></span></div>${rows}`;
}
function renderBrowse(){ // overview
  const items=CATALOG.chapters.map((c,i)=>({name:c.name,value:c.count,color:PALETTE[i%PALETTE.length]}));
  const rows=CATALOG.chapters.map(c=>`<tr class="clk" onclick="goBrowse('chapter','${c.id}')">
    <td class="sec-name"><span class="sid">第${short(c.id).slice(1)}章</span>${c.name}</td>
    <td class="num">${badge(c.req)}</td><td class="num t-kp">${c.kp}</td><td class="num t-q">${c.count}</td></tr>`).join('');
  const main=`<div class="card"><div class="card-h">历年真题 · 各章分布<span class="sub">单位：真题数量</span></div><div class="card-b">${pie(items)}</div></div>
    <div class="card"><div class="card-h">分章真题一览</div>
    <table><thead><tr><th>章节</th><th class="num">要求</th><th class="num">知识点</th><th class="num">真题</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="notice">第 1 章已逐题精解(32 题);第 2–7 章真题已对照大纲分类入库、标注答案,解析按章补充中。子节归类第 1 章为人工核定,其余为自动归类。</div></div>`;
  C().innerHTML=browseLayout(main); renderSidebar();
}
async function goBrowse(sub,cid,sid){
  view={tab:'browse',sub,cid,sid}; setActiveTab('browse');
  if(sub==='overview'){ renderBrowse(); }
  else if(sub==='chapter'){ renderChapter(cid); }
  else if(sub==='section'){
    C().innerHTML=browseLayout('<div class="empty"><div class="big">⏳</div>加载中…</div>'); renderSidebar();
    try{ const data=sectionCache[sid] || (sectionCache[sid]=await api(`/api/sections/${sid}/questions`));
      renderSection(cid,sid,data);
    }catch(e){ document.getElementById('bmain').innerHTML=`<div class="empty">加载失败：${esc(e.message)}</div>`; }
  }
  window.scrollTo(0,0);
}
function renderChapter(cid){
  const c=CATALOG.chapters.find(x=>x.id===cid); const secs=c.sections.filter(s=>s.count>0);
  const items=secs.map((s,i)=>({name:short(s.id)+' '+s.name,value:s.count,color:PALETTE[i%PALETTE.length]}));
  const rows=secs.map(s=>`<tr class="clk" onclick="goBrowse('section','${cid}','${s.id}')">
    <td class="sec-name"><span class="sid">${short(s.id)}</span>${s.name}</td>
    <td class="num">${badge(s.req)}</td><td class="num">${stars(s.difficulty)}</td>
    <td class="num t-q">${s.count}</td><td class="num" style="color:#888">${s.mc}/${s.tf}</td></tr>`).join('');
  const main=`<div class="crumb"><a onclick="goBrowse('overview')">首页</a> › <span>第${short(cid).slice(1)}章 ${c.name}</span></div>
    <div class="card"><div class="card-h">第${short(cid).slice(1)}章　${c.name}</div><div class="card-b"><div class="stats">
      <div class="stat"><span class="lab">被考次数</span><span class="val red">${c.count}</span><span class="lab">题</span></div>
      <div class="stat"><span class="lab">题型构成</span><span class="val">单选 ${c.mc} / 判断 ${c.tf}</span></div>
      <div class="stat"><span class="lab">被考频率</span>${freqB(c.freq)}</div>
      <div class="stat"><span class="lab">知识难度</span>${stars(c.difficulty)}</div>
      <div class="stat"><span class="lab">考试要求</span>${badge(c.req)}</div></div></div></div>
    <div class="card"><div class="chart-title">第${short(cid).slice(1)}章 历年真题 · 子节分布</div><div class="chart-sub">单位：真题数量</div><div class="card-b">${pie(items)}</div></div>
    <div class="card"><div class="card-h">本章知识子节</div>
    <table><thead><tr><th>子节</th><th class="num">要求</th><th class="num">难度</th><th class="num">真题</th><th class="num">选/判</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  C().innerHTML=browseLayout(main); renderSidebar();
}
const PAGE=8;
function renderSection(cid,sid,data){
  const c=CATALOG.chapters.find(x=>x.id===cid); const s=c.sections.find(x=>x.id===sid);
  const qs=data.questions; const key=sid; if(browsePage[key]==null)browsePage[key]=0;
  const pages=Math.max(1,Math.ceil(qs.length/PAGE)); const pg=Math.min(browsePage[key],pages-1);
  const slice=qs.slice(pg*PAGE,pg*PAGE+PAGE);
  const qhtml=slice.map((q,i)=>qCard(q,pg*PAGE+i,{review:true})).join('');
  let pager=''; if(pages>1){ pager='<div class="pager">'+`<button ${pg===0?'disabled':''} onclick="setBrowsePage('${key}',${pg-1})">‹</button>`;
    for(let i=0;i<pages;i++)pager+=`<button class="${i===pg?'on':''}" onclick="setBrowsePage('${key}',${i})">${i+1}</button>`;
    pager+=`<button ${pg===pages-1?'disabled':''} onclick="setBrowsePage('${key}',${pg+1})">›</button></div>`; }
  const main=`<div class="crumb"><a onclick="goBrowse('overview')">首页</a> › <a onclick="goBrowse('chapter','${cid}')">第${short(cid).slice(1)}章 ${c.name}</a> › <span>${short(s.id)} ${s.name}</span></div>
    <div class="card"><div class="card-h">${short(s.id)}　${s.name}</div><div class="card-b"><div class="stats">
      <div class="stat"><span class="lab">被考次数</span><span class="val red">${s.count}</span><span class="lab">题</span></div>
      <div class="stat"><span class="lab">题型</span><span class="val">单选 ${s.mc} / 判断 ${s.tf}</span></div>
      <div class="stat"><span class="lab">被考频率</span>${freqB(s.freq)}</div>
      <div class="stat"><span class="lab">知识难度</span>${stars(s.difficulty)}</div>
      <div class="stat"><span class="lab">考试要求</span>${badge(s.req)}</div></div></div></div>
    <div class="card"><div class="chart-title">历年题目数量</div><div class="chart-sub">横轴：考试场次(年.月)</div><div class="card-b" style="text-align:center">${bar(data.by_paper)}</div></div>
    <div class="card"><div class="card-b"><div class="qtools"><span class="cnt">共 <b>${qs.length}</b> 题　第 ${pg+1}/${pages} 页</span>
      <span class="btn" onclick="expandAll(true)">展开全部</span><span class="btn gray" onclick="expandAll(false)">收起全部</span>
      <span class="btn solid" onclick="go('practice')">🎯 练这一节</span>${pager}</div>
      <div id="qlist">${qhtml}</div><div class="qtools" style="margin-top:8px;margin-bottom:0">${pager}</div></div></div>`;
  const el=document.getElementById('bmain'); if(el)el.innerHTML=main; else { C().innerHTML=browseLayout(main); renderSidebar(); }
}
function setBrowsePage(key,p){ browsePage[key]=p; renderSection(view.cid,view.sid,sectionCache[view.sid]); window.scrollTo(0,0); }

/* ===================== 题目卡(浏览/复习) ===================== */
function qCard(q,idx,opts={}){
  const isMC=q.type==='mc';
  let optsHtml='';
  if(isMC) optsHtml='<div class="q-opts">'+['A','B','C','D'].filter(k=>q.options[k]!=null).map(k=>
    `<div class="opt ${k===q.answer?'correct':''}"><span class="ok">${k}</span><span>${hlInline(q.options[k])}</span></div>`).join('')+'</div>';
  const code=q.code?`<pre class="q-code">${hl(q.code)}</pre>`:'';
  let exp; if(q.explanation){ let e=esc(q.explanation).replace(/💡(.*)$/,'<span class="tip">💡$1</span>'); exp=`<div class="exp">${e}</div>`; }
  else exp='<div class="exp todo">解析待补充(本题已分类入库,解析按章补写中)</div>';
  const star=`<span class="q-star ${q.bookmarked?'on':''}" id="star${idx}" title="收藏" onclick="event.stopPropagation();toggleStar('${q.qid}',${idx})">${q.bookmarked?'★':'☆'}</span>`;
  const masterBtn=opts.wrong?`<span class="btn teal" style="margin-left:auto" onclick="event.stopPropagation();masterQ('${q.qid}',${idx})">✓ 已掌握</span>`:'';
  return `<div class="q" id="q${idx}">
    <div class="q-head" onclick="toggleQ(${idx})">
      <span class="qtype type-${q.type}">${isMC?'单选':'判断'}</span>
      <span class="q-src">${papFull(q.paper)} · 第${q.num}题</span>
      <span class="q-diff">${'★'.repeat(Math.round(q.difficulty))}</span>
      ${opts.wrong?`<span style="color:var(--red);font-size:11px">错 ${q.wrong_count||1} 次</span>`:''}
      ${masterBtn||'<span class="q-toggle" style="margin-left:auto">展开解析 ▾</span>'}${opts.wrong?'':star}</div>
    <div class="q-body"><div class="q-stem">${hlInline(q.stem)}</div>${code}${optsHtml}
      <div class="ans"><div class="a-line">正确答案：<span class="ansv">${q.answer}</span></div>${exp}</div></div></div>`;
}
function toggleQ(i){const el=document.getElementById('q'+i);if(!el)return;el.classList.toggle('open');
  const t=el.querySelector('.q-toggle');if(t)t.innerHTML=el.classList.contains('open')?'收起解析 ▴':'展开解析 ▾';}
function expandAll(open){document.querySelectorAll('#qlist .q, #content .q').forEach(el=>{el.classList.toggle('open',open);
  const t=el.querySelector('.q-toggle');if(t)t.innerHTML=open?'收起解析 ▴':'展开解析 ▾';});}
async function toggleStar(qid,idx){
  const el=document.getElementById('star'+idx); const on=el.classList.contains('on');
  try{ if(on){await api('/api/bookmarks/'+qid,{method:'DELETE'});el.classList.remove('on');el.textContent='☆';}
       else{await api('/api/bookmarks/'+qid,{method:'POST'});el.classList.add('on');el.textContent='★';}
    if(sectionCache[view.sid]){const qq=sectionCache[view.sid].questions.find(x=>x.qid===qid);if(qq)qq.bookmarked=!on;}
  }catch(e){ alert(e.message); }
}

/* ===================== 刷题自测 ===================== */
let quizCfg={mode:'random',id:null,count:10,level:LEVEL};
let quiz=null;
function renderPracticeSetup(){
  const chapterChips=CATALOG.chapters.map(c=>`<span class="chip" data-mode="chapter" data-id="${c.id}" onclick="pickScope(this)">第${short(c.id).slice(1)}章 ${c.name}<span style="opacity:.6">(${c.count})</span></span>`).join('');
  C().innerHTML=`<div class="card"><div class="card-h">🎯 刷题自测 · 组卷</div><div class="card-b quiz-setup">
    <div><div class="field-label">出题范围</div><div class="opt-group">
      <span class="chip on" data-mode="random" onclick="pickScope(this)">全部随机</span>
      <span class="chip" data-mode="wrongbook" onclick="pickScope(this)">📕 错题重练</span></div></div>
    <div><div class="field-label">按章节出题</div><div class="opt-group">${chapterChips}</div></div>
    <div><div class="field-label">题量</div><div class="opt-group">
      <span class="chip" data-n="5" onclick="pickCount(this)">5 题</span>
      <span class="chip on" data-n="10" onclick="pickCount(this)">10 题</span>
      <span class="chip" data-n="20" onclick="pickCount(this)">20 题</span>
      <span class="chip" data-n="30" onclick="pickCount(this)">30 题</span></div></div>
    <div><button class="btn solid" style="padding:12px 28px;font-size:15px" onclick="startQuiz()">开始练习 ›</button></div>
    <div class="notice">系统随机抽题、即时判分并显示解析;答错自动进错题本,答对则移出。</div>
  </div></div>`;
}
function pickScope(el){ document.querySelectorAll('.opt-group .chip[data-mode]').forEach(c=>c.classList.remove('on'));
  el.classList.add('on'); quizCfg.mode=el.dataset.mode; quizCfg.id=el.dataset.id||null; }
function pickCount(el){ document.querySelectorAll('.chip[data-n]').forEach(c=>c.classList.remove('on')); el.classList.add('on'); quizCfg.count=+el.dataset.n; }
async function startQuiz(){
  C().innerHTML='<div class="empty"><div class="big">⏳</div>组卷中…</div>';
  try{
    const d=await api('/api/practice/start',{method:'POST',body:JSON.stringify(quizCfg)});
    if(!d.questions.length){ C().innerHTML=`<div class="card"><div class="card-b empty"><div class="big">🤔</div>没有可练的题目${quizCfg.mode==='wrongbook'?'——你的错题本是空的,先去刷题吧!':''}<br><br><button class="btn solid" onclick="renderPracticeSetup()">返回</button></div></div>`; return; }
    quiz={questions:d.questions,idx:0,results:[],correct:0,kind:'practice'}; renderQuiz();
  }catch(e){ C().innerHTML=`<div class="empty">组卷失败：${esc(e.message)}</div>`; }
}
function renderQuiz(){
  const q=quiz.questions[quiz.idx]; const n=quiz.questions.length; const isMC=q.type==='mc';
  const pct=Math.round(quiz.idx/n*100);
  let optsHtml; if(isMC){ optsHtml=['A','B','C','D'].filter(k=>q.options[k]!=null).map(k=>
      `<div class="opt sel" data-val="${k}" onclick="pickAns(this,'${k}')"><span class="ok">${k}</span><span>${hlInline(q.options[k])}</span></div>`).join(''); }
  else { optsHtml=[['√','正确'],['×','错误']].map(([v,t])=>
      `<div class="opt sel" data-val="${v}" onclick="pickAns(this,'${v}')"><span class="ok">${v}</span><span>${t}</span></div>`).join(''); }
  C().innerHTML=`<div class="card"><div class="card-b">
    <div class="quiz-progress"><span>第 ${quiz.idx+1}/${n} 题</span><div class="bar"><span style="width:${pct}%"></span></div><span class="quiz-score">✓ ${quiz.correct}</span></div>
    <div class="q" style="border:none"><div class="q-body" style="padding:6px 2px">
      <div style="margin-bottom:8px"><span class="qtype type-${q.type}">${isMC?'单选':'判断'}</span> <span class="q-src">${papFull(q.paper)} · 第${q.num}题</span> <span class="q-diff">${'★'.repeat(Math.round(q.difficulty))}</span></div>
      <div class="q-stem" style="font-size:15px">${hlInline(q.stem)}</div>
      ${q.code?`<pre class="q-code">${hl(q.code)}</pre>`:''}
      <div class="q-opts" id="quizopts">${optsHtml}</div>
      <div id="quizfb"></div>
      <div style="margin-top:16px;display:flex;gap:10px"><button class="btn solid" id="submitbtn" onclick="submitAns()" disabled>提交</button>
        <button class="btn gray" onclick="renderPracticeSetup()">退出练习</button></div>
    </div></div></div></div>`;
  quiz.picked=null;
}
function pickAns(el,val){ if(quiz.answered)return; document.querySelectorAll('#quizopts .opt').forEach(o=>o.classList.remove('pick'));
  el.classList.add('pick'); quiz.picked=val; document.getElementById('submitbtn').disabled=false; }
async function submitAns(){
  if(quiz.picked==null||quiz.answered)return; quiz.answered=true;
  const q=quiz.questions[quiz.idx];
  document.getElementById('submitbtn').disabled=true;
  try{
    const d=await api('/api/attempts',{method:'POST',body:JSON.stringify({qid:q.qid,chosen:quiz.picked})});
    quiz.results.push({qid:q.qid,correct:d.correct}); if(d.correct)quiz.correct++;
    document.querySelectorAll('#quizopts .opt').forEach(o=>{ o.classList.remove('sel','pick'); o.onclick=null;
      if(o.dataset.val===d.answer)o.classList.add('correct','show');
      else if(o.dataset.val===quiz.picked)o.classList.add('wrongpick'); });
    let e=d.explanation?esc(d.explanation).replace(/💡(.*)$/,'<span class="tip">💡$1</span>'):'<span class="todo">本题暂未提供解析(已分类入库,解析按章补写中)</span>';
    const last=quiz.idx>=quiz.questions.length-1;
    document.getElementById('quizfb').innerHTML=
      `<div class="fb ${d.correct?'ok':'no'}">${d.correct?'✓ 回答正确':'✗ 回答错误,正确答案：'+d.answer}</div>
       <div class="ans show"><div class="exp">${e}</div></div>`;
    document.getElementById('submitbtn').outerHTML=`<button class="btn solid" onclick="${last?'finishQuiz()':'nextQ()'}">${last?'查看结果 ›':'下一题 ›'}</button>`;
  }catch(err){ alert(err.message); quiz.answered=false; document.getElementById('submitbtn').disabled=false; }
}
function nextQ(){ quiz.idx++; quiz.answered=false; renderQuiz(); window.scrollTo(0,0); }
function finishQuiz(){
  const n=quiz.questions.length,c=quiz.correct,acc=Math.round(c/n*100);
  const emoji=acc>=90?'🏆':acc>=70?'👍':acc>=50?'💪':'📖';
  C().innerHTML=`<div class="card"><div class="card-b summary"><div class="big" style="font-size:40px">${emoji}</div>
    <div class="ring">${c} / ${n}</div><div style="color:var(--gray);margin-bottom:6px">正确率 ${acc}%</div>
    <div style="margin:20px 0;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <button class="btn solid" onclick="${quiz.kind==='recommend'?'go(\'recommend\')':'startQuiz()'}">${quiz.kind==='recommend'?'🤖 再推一组':'再来一组'}</button>
      <button class="btn" onclick="renderPracticeSetup()">换个范围</button>
      ${n-c>0?'<button class="btn teal" onclick="go(\'wrong\')">看错题本</button>':''}</div>
    <div style="color:var(--gray);font-size:12.5px">本次做题记录已保存,可在「我的进度」查看</div></div></div>`;
  window.scrollTo(0,0);
}

/* ===================== 错题本 ===================== */
async function renderWrong(){
  C().innerHTML='<div class="empty"><div class="big">⏳</div>加载错题本…</div>';
  const d=await api('/api/wrongbook');
  if(!d.questions.length){ C().innerHTML=`<div class="card"><div class="card-b empty"><div class="big">🎉</div>错题本是空的——继续保持!<br><br><button class="btn solid" onclick="go('practice')">去刷题</button></div></div>`; return; }
  const qhtml=d.questions.map((q,i)=>qCard(q,i,{review:true,wrong:true})).join('');
  C().innerHTML=`<div class="card"><div class="card-h">📕 我的错题本<span class="sub">共 ${d.count} 题</span></div><div class="card-b">
    <div class="qtools"><span class="cnt">答对一次即自动移出;也可手动标记「已掌握」</span>
      <span class="btn" onclick="expandAll(true)">展开全部</span><span class="btn gray" onclick="expandAll(false)">收起全部</span>
      <span class="btn solid" style="margin-left:auto" onclick="quizCfg={mode:'wrongbook',count:Math.min(30,${d.count})};startQuiz()">🎯 错题重练</span></div>
    <div id="qlist">${qhtml}</div></div></div>`;
}
async function masterQ(qid,idx){ try{ await api('/api/wrongbook/'+qid+'/master',{method:'POST'});
  const el=document.getElementById('q'+idx); if(el){el.style.transition='.3s';el.style.opacity='0';setTimeout(()=>el.remove(),300);} }catch(e){alert(e.message);} }

/* ===================== 我的进度 ===================== */
async function renderProgress(){
  C().innerHTML='<div class="empty"><div class="big">⏳</div>统计中…</div>';
  const [d,st]=await Promise.all([api('/api/progress?level='+LEVEL), api('/api/stats/me')]);
  const rows=d.by_chapter.map(c=>{
    const acc=c.answered?Math.round(c.correct/c.answered*100):0;
    const cov=Math.round(c.answered/c.total*100);
    return `<div class="prog-row"><span class="pname">第${short(c.id).slice(1)}章 ${c.name}</span>
      <div class="pbar"><span class="done" style="width:${cov}%"></span></div>
      <span class="pval">已做 ${c.answered}/${c.total} · 正确率 ${c.answered?acc+'%':'—'}</span></div>`;}).join('');
  C().innerHTML=`<div class="card"><div class="card-h">📊 我的学习进度<span class="sub">${st.tier_icon} ${st.tier} · ${st.points} 积分 · 连续打卡 ${st.streak} 天</span></div><div class="card-b">
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${d.answered}</div><div class="lab">已做题数 / ${d.total_questions}</div></div>
      <div class="stat-card teal"><div class="num">${d.accuracy}%</div><div class="lab">累计正确率</div></div>
      <div class="stat-card blue"><div class="num">${d.attempts}</div><div class="lab">总作答次数</div></div>
      <div class="stat-card amber"><div class="num">${d.wrongbook_count}</div><div class="lab">错题本待巩固</div></div>
    </div>
    <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn solid" onclick="go('recommend')">🤖 智能推题(攻克薄弱点)</button>
      <button class="btn teal" onclick="go('mock')">📝 来一套限时模考</button></div>
    </div></div>
    <div class="card"><div class="card-h">各章覆盖与正确率<span class="sub">进度条＝已做覆盖率</span></div><div class="card-b">${rows}
      <div class="notice" style="margin-top:14px">覆盖率＝本章已作答的不同题目占比;正确率按每题最近一次作答计算。多刷多练,数字会动起来 📈</div></div></div>
    <div style="text-align:center;margin-bottom:16px"><button class="btn solid" onclick="go('practice')">🎯 继续刷题</button></div>`;
}

/* ===================== 我的收藏 ===================== */
async function renderMark(){
  C().innerHTML='<div class="empty"><div class="big">⏳</div>加载收藏…</div>';
  const d=await api('/api/bookmarks');
  if(!d.questions.length){ C().innerHTML=`<div class="card"><div class="card-b empty"><div class="big">⭐</div>还没有收藏的题目<br><span style="font-size:12.5px">在题库浏览中点题目右上角的 ☆ 即可收藏</span><br><br><button class="btn solid" onclick="go('browse')">去浏览题库</button></div></div>`; return; }
  const qhtml=d.questions.map((q,i)=>qCard(q,i,{review:true})).join('');
  C().innerHTML=`<div class="card"><div class="card-h">⭐ 我的收藏<span class="sub">共 ${d.questions.length} 题</span></div><div class="card-b">
    <div class="qtools"><span class="cnt">点 ★ 可取消收藏</span><span class="btn" onclick="expandAll(true)">展开全部</span><span class="btn gray" onclick="expandAll(false)">收起全部</span></div>
    <div id="qlist">${qhtml}</div></div></div>`;
}

/* ===================== 🤖 AI 智能推题 ===================== */
let REC_QUESTIONS=[];
async function renderRecommend(){
  C().innerHTML='<div class="empty"><div class="big">🤖</div>正在分析你的错题与各知识点掌握度…</div>';
  const d=await api('/api/recommend?level='+LEVEL);
  REC_QUESTIONS=d.questions;
  const wp=d.weak_points.map(w=>{
    const tag = w.wrong>0 ? `<span style="color:var(--red);font-weight:600">错 ${w.wrong} 题</span>`
      : (w.answered>0 ? `正确率 ${w.accuracy}%` : '<span style="color:#aaa">未练习</span>');
    return `<div class="wp-row"><span class="wp-name">${esc(w.chapter)} · ${esc(w.name)}</span>
      <span class="wp-stat">已做 ${w.answered}/${w.total} · ${tag}</span></div>`;
  }).join('');
  const intro = d.personalized
    ? `系统根据你的<b>错题分布</b>与<b>各知识点掌握度</b>,锁定了下面 ${d.weak_points.length} 个最薄弱的知识点,并精选 <b>${d.set_size}</b> 道针对性真题（含 <b>${d.from_wrongbook}</b> 道你做错过的）为你强化。`
    : `你在本级别还没有足够的作答数据。先做一组打基础,系统会据此为你<b>个性化</b>推送最薄弱知识点的题目。`;
  C().innerHTML=`<div class="card"><div class="card-h">🤖 AI 个性化推题<span class="sub">${CATALOG.level_name} · ${d.personalized?'已按你的数据生成':'通用入门组'}</span></div>
    <div class="card-b">
      <div class="ai-intro">${intro}</div>
      ${d.weak_points.length?`<div class="wp-box"><div class="wp-title">📌 为你重点突破的知识点</div>${wp}</div>`:''}
      <div style="margin-top:18px;text-align:center">
        <button class="btn solid" style="padding:12px 30px;font-size:15px" ${d.set_size?'':'disabled'} onclick="startRecommended()">🎯 开始个性化练习（${d.set_size} 题）›</button></div>
      <div class="notice" style="margin-top:14px">练得越多,推荐越准。做错的题会自动进错题本,并在下次优先推送给你。</div>
    </div></div>`;
}
function startRecommended(){
  if(!REC_QUESTIONS.length)return;
  quiz={questions:REC_QUESTIONS.slice(),idx:0,results:[],correct:0,kind:'recommend'}; renderQuiz(); window.scrollTo(0,0);
}

/* ===================== 📝 限时模考 ===================== */
let MOCK=null;
async function renderMock(){
  C().innerHTML='<div class="empty"><div class="big">📝</div>加载真题套卷…</div>';
  const d=await api('/api/mock/papers?level='+LEVEL);
  const papers=d.papers.filter(p=>p.total>0);
  const best={}; d.history.forEach(h=>{ if(Number(h.level)===Number(LEVEL)){ if(best[h.paper]==null||h.score>best[h.paper])best[h.paper]=h.score; } });
  const rows=papers.map(p=>{
    const b=best[p.paper];
    return `<tr class="clk" onclick="startMock('${p.paper}')">
      <td class="sec-name"><span class="sid">${papFull(p.paper)}</span></td>
      <td class="num">单选${p.mc}+判断${p.tf}</td><td class="num">${p.total*2} 分</td>
      <td class="num">${b!=null?`<b style="color:var(--teal)">${b} 分</b>`:'<span style="color:#bbb">未考</span>'}</td>
      <td class="num"><span class="go" style="color:var(--red);font-weight:700">开始 ›</span></td></tr>`;}).join('');
  let hist=''; if(d.history.length){ hist=`<div class="card"><div class="card-h">📜 最近模考记录</div><div class="card-b"><table>
    <thead><tr><th>套卷</th><th class="num">得分</th><th class="num">答对</th><th class="num">时间</th></tr></thead><tbody>${
    d.history.slice(0,10).map(h=>`<tr><td class="sec-name">L${h.level} ${papFull(h.paper)}</td><td class="num"><b>${h.score}</b>/${h.total_score}</td><td class="num">${h.correct}/${h.total_q}</td><td class="num" style="color:#888;font-size:12px">${(h.created_at||'').slice(5,16)}</td></tr>`).join('')
    }</tbody></table></div></div>`; }
  C().innerHTML=`<div class="card"><div class="card-h">📝 限时模考 · ${CATALOG.level_name}<span class="sub">整套真题客观题 · 限时 40 分钟</span></div>
    <div class="card-b">
      <div class="notice" style="margin-bottom:14px">选一套历年真题进入限时模考,交卷后自动算分(每题 2 分)、给出排名与逐题解析。模考成绩同样计入你的进度与错题本。</div>
      ${rows?`<table><thead><tr><th>真题套卷</th><th class="num">题量</th><th class="num">满分</th><th class="num">我的最佳</th><th class="num"></th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">本级别暂无可模考的整套真题</div>'}
    </div></div>${hist}`;
}
async function startMock(paper){
  C().innerHTML='<div class="empty"><div class="big">⏳</div>组卷中…</div>';
  try{
    const d=await api('/api/mock/start',{method:'POST',body:JSON.stringify({level:Number(LEVEL),paper})});
    MOCK={level:Number(LEVEL),paper,questions:d.questions,answers:{},remain:d.duration_sec,timer:null,submitted:false};
    renderMockExam(); MOCK.timer=setInterval(tickMock,1000);
  }catch(e){ C().innerHTML=`<div class="empty">组卷失败：${esc(e.message)}</div>`; }
}
function renderMockExam(){
  const qs=MOCK.questions;
  const items=qs.map((q,i)=>{
    const isMC=q.type==='mc';
    const opts = isMC
      ? ['A','B','C','D'].filter(k=>q.options[k]!=null).map(k=>`<div class="opt sel ${MOCK.answers[q.qid]===k?'pick':''}" onclick="pickMock('${q.qid}','${k}',this)"><span class="ok">${k}</span><span>${hlInline(q.options[k])}</span></div>`).join('')
      : [['√','正确'],['×','错误']].map(([v,t])=>`<div class="opt sel ${MOCK.answers[q.qid]===v?'pick':''}" onclick="pickMock('${q.qid}','${v}',this)"><span class="ok">${v}</span><span>${t}</span></div>`).join('');
    return `<div class="mq" id="mq-${i}"><div class="mq-h"><span class="qtype type-${q.type}">${isMC?'单选':'判断'}</span> <b>第 ${i+1} 题</b> <span class="q-src">(${papFull(q.paper)} · 原第${q.num}题)</span></div>
      <div class="q-stem">${hlInline(q.stem)}</div>${q.code?`<pre class="q-code">${hl(q.code)}</pre>`:''}<div class="q-opts">${opts}</div></div>`;
  }).join('');
  C().innerHTML=`<div class="mock-bar"><span class="mb-t">📝 ${papFull(MOCK.paper)} 模考</span><span class="mock-timer" id="mocktimer">--:--</span><span class="mock-prog" id="mockprog">已答 0/${qs.length}</span><button class="btn solid" onclick="submitMock(false)">交卷</button></div>
    <div class="card"><div class="card-b"><div id="mqlist">${items}</div>
      <div style="text-align:center;margin-top:16px"><button class="btn solid" style="padding:12px 36px;font-size:15px" onclick="submitMock(false)">提交试卷 ›</button>
      <button class="btn gray" style="margin-left:10px" onclick="quitMock()">放弃</button></div></div></div>`;
  updateMockProg(); window.scrollTo(0,0);
}
function pickMock(qid,val,el){ if(MOCK.submitted)return; MOCK.answers[qid]=val;
  el.parentElement.querySelectorAll('.opt').forEach(o=>o.classList.remove('pick')); el.classList.add('pick'); updateMockProg(); }
function updateMockProg(){ const e=document.getElementById('mockprog'); if(e)e.textContent=`已答 ${Object.keys(MOCK.answers).length}/${MOCK.questions.length}`; }
function tickMock(){ if(!MOCK)return; MOCK.remain--; const m=Math.floor(MOCK.remain/60),s=MOCK.remain%60;
  const e=document.getElementById('mocktimer'); if(e){ e.textContent=`${m}:${String(s).padStart(2,'0')}`; if(MOCK.remain<=120)e.classList.add('warn'); }
  if(MOCK.remain<=0) submitMock(true); }
function quitMock(){ if(MOCK&&MOCK.timer)clearInterval(MOCK.timer); MOCK=null; renderMock(); }
async function submitMock(auto){
  if(!MOCK||MOCK.submitted)return;
  const un=MOCK.questions.length-Object.keys(MOCK.answers).length;
  if(!auto && un>0 && !confirm(`还有 ${un} 题未作答,确定交卷?`))return;
  MOCK.submitted=true; if(MOCK.timer)clearInterval(MOCK.timer);
  C().innerHTML='<div class="empty"><div class="big">⏳</div>判分中…</div>';
  try{ const d=await api('/api/mock/submit',{method:'POST',body:JSON.stringify({level:MOCK.level,paper:MOCK.paper,answers:MOCK.answers})}); renderMockResult(d); }
  catch(e){ C().innerHTML=`<div class="empty">交卷失败：${esc(e.message)}</div>`; }
}
function renderMockResult(d){
  const pct=d.total_score?Math.round(d.score/d.total_score*100):0; const emoji=pct>=85?'🏆':pct>=60?'👍':pct>=40?'💪':'📖';
  const details=d.details.map((q,i)=>{
    const isMC=q.type==='mc';
    const optsHtml = isMC?'<div class="q-opts">'+['A','B','C','D'].filter(k=>q.options[k]!=null).map(k=>{
        let cls=''; if(k===q.answer)cls='correct show'; else if(k===q.your&&!q.correct)cls='wrongpick';
        return `<div class="opt ${cls}"><span class="ok">${k}</span><span>${hlInline(q.options[k])}</span></div>`;}).join('')+'</div>':'';
    const e=q.explanation?esc(q.explanation):'<span class="todo">本题暂未提供解析</span>';
    return `<div class="q open" id="q${i}"><div class="q-head"><span class="qtype type-${q.type}">${isMC?'单选':'判断'}</span>
      <span class="q-src">第${i+1}题</span> <span style="margin-left:auto;font-weight:600" class="${q.correct?'fb-ok':'fb-no'}">${q.correct?'✓ 正确':'✗ 你答'+(q.your||'未答')+' / 应'+q.answer}</span></div>
      <div class="q-body"><div class="q-stem">${hlInline(q.stem)}</div>${q.code?`<pre class="q-code">${hl(q.code)}</pre>`:''}${optsHtml}
      <div class="ans show"><div class="a-line">正确答案：<span class="ansv">${q.answer}</span></div><div class="exp">${e}</div></div></div></div>`;
  }).join('');
  C().innerHTML=`<div class="card"><div class="card-b summary"><div class="big" style="font-size:40px">${emoji}</div>
    <div class="ring">${d.score} / ${d.total_score}</div>
    <div style="color:var(--gray);margin-bottom:4px">答对 ${d.correct}/${d.total_q} · 单选 ${d.mc_correct}/${d.mc_total} · 判断 ${d.tf_correct}/${d.tf_total}</div>
    <div style="margin:8px 0 16px"><span class="rank-badge">本套排名 ${d.rank} / ${d.takers}</span></div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <button class="btn solid" onclick="go('mock')">再考一套</button>
      ${d.correct<d.total_q?'<button class="btn teal" onclick="go(\'wrong\')">看错题本</button>':''}
      <button class="btn" onclick="go('recommend')">🤖 针对性练习</button></div>
    <div style="color:var(--gray);font-size:12px;margin-top:10px">满分为客观题(选择+判断,每题 2 分);编程题不在本平台模考范围。成绩已计入进度与错题本。</div></div></div>
    <div class="card"><div class="card-h">📋 逐题解析<span class="sub">共 ${d.details.length} 题</span></div><div class="card-b"><div id="qlist">${details}</div></div></div>`;
  MOCK=null; window.scrollTo(0,0);
}

/* ===================== 🏆 排行榜 + 打卡积分 ===================== */
async function renderRank(){
  C().innerHTML='<div class="empty"><div class="big">🏆</div>加载成就与排行…</div>';
  const [st,lb]=await Promise.all([api('/api/stats/me'),api('/api/leaderboard')]);
  const rows=lb.top.map(u=>`<div class="lb-row ${u.me?'me':''}">
    <span class="lb-rank ${u.rank<=3?'top':''}">${u.rank<=3?['🥇','🥈','🥉'][u.rank-1]:u.rank}</span>
    <span class="lb-name">${esc(u.username)}${u.me?' · 我':''}</span>
    <span class="lb-tier">${u.icon} ${u.tier}</span><span class="lb-pts">${u.points} 分</span></div>`).join('');
  const checkin = st.today_done ? `<div class="ci ci-done">✅ 今日已打卡 · 连续 ${st.streak} 天,继续保持!</div>`
    : `<div class="ci ci-todo">📅 今天还没练习——做一道题即可自动打卡</div>`;
  C().innerHTML=`<div class="card"><div class="card-h">🏆 我的成就</div><div class="card-b">
    <div class="ach-grid">
      <div class="ach-card"><div class="ach-ic">${st.tier_icon}</div><div class="ach-v">${st.tier}</div><div class="ach-l">当前段位</div></div>
      <div class="ach-card amber"><div class="ach-v">${st.points}</div><div class="ach-l">积分</div></div>
      <div class="ach-card teal"><div class="ach-v">${st.streak}</div><div class="ach-l">连续打卡(天)</div></div>
      <div class="ach-card blue"><div class="ach-v">${st.streak_total}</div><div class="ach-l">累计打卡(天)</div></div>
    </div>
    ${checkin}
    ${st.next_at?`<div class="lvl-progress"><div class="lp-bar"><span style="width:${Math.min(100,Math.round(st.points/st.next_at*100))}%"></span></div><div class="lp-txt">距下一段位还需 <b>${st.to_next}</b> 分</div></div>`:'<div class="lp-txt" style="text-align:center;margin-top:12px">已达最高段位 👑 宗师</div>'}
    <div class="notice" style="margin-top:10px">积分规则:答对单选 +2、判断 +1;每天做题即自动打卡。</div></div></div>
  <div class="card"><div class="card-h">🏆 积分排行榜<span class="sub">全站 Top ${lb.top.length}</span></div><div class="card-b">
    ${lb.me.rank?'':`<div class="ai-intro">你还没上榜,做几道题就能进入排行榜啦!当前 ${lb.me.points} 分。</div>`}
    <div class="lb">${rows||'<div class="empty">暂无排行数据,快来抢第一!</div>'}</div></div></div>`;
}

/* ===================== 搜索 ===================== */
async function doSearch(kw){ kw=(kw||'').trim(); if(!kw)return;
  setActiveTab(''); C().innerHTML='<div class="empty"><div class="big">🔍</div>搜索中…</div>';
  try{ const d=await api('/api/search?q='+encodeURIComponent(kw)+'&level='+LEVEL);
    const qhtml=d.questions.map((q,i)=>qCard(q,i,{review:true})).join('');
    C().innerHTML=`<div class="card"><div class="card-h">搜索结果<span class="sub">命中 ${d.count} 题${d.count>=80?'(显示前80)':''}</span></div>
      <div class="card-b">${d.count?'<div class="qtools"><span class="btn" onclick="expandAll(true)">展开全部</span><span class="btn gray" onclick="expandAll(false)">收起全部</span></div><div id="qlist">'+qhtml+'</div>':'<div class="empty">未找到匹配「'+esc(kw)+'」的真题</div>'}</div></div>`;
  }catch(e){ C().innerHTML=`<div class="empty">搜索失败：${esc(e.message)}</div>`; }
  window.scrollTo(0,0);
}

/* ===================== 启动 ===================== */
document.getElementById('uname').textContent=USER;
go('browse');
