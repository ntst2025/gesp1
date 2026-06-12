'use strict';
/* ===================== 鉴权 + API ===================== */
const TOKEN = localStorage.getItem('gesp_token');
const USER  = localStorage.getItem('gesp_user') || '同学';
const AVATAR = localStorage.getItem('gesp_avatar') || 'a1';
// 头像渲染:预设id -> /avatars/ 图片;dataURL -> 自定义图片;其余按 emoji 文本
function avHtml(av,cls){ av=av||'a1';
  if(/^a([1-9]|1[0-2])$/.test(av)) return `<img class="av-img ${cls||''}" src="/avatars/${av}.svg" alt="">`;
  if(av.startsWith('data:image/')) return `<img class="av-img ${cls||''}" src="${av}" alt="">`;
  return `<span class="av-emoji ${cls||''}">${av}</span>`; }
if (!TOKEN) location.href = '/';
const LEVEL = new URLSearchParams(location.search).get('level') || '1';
function logout(){ localStorage.removeItem('gesp_token'); localStorage.removeItem('gesp_user'); localStorage.removeItem('gesp_avatar'); location.href='/'; }
let IS_VIP=false;
function lockBox(){ return `<div class="exp"><span class="todo">本题解析整理中</span></div>`; }
function updateVipUI(){
  const b=document.getElementById('vipbadge'); if(b) b.innerHTML = IS_VIP ? '<span class="vip-tag">👑 VIP</span>' : '';
  const e=document.getElementById('vip-entry'); if(e) e.style.display = IS_VIP ? 'none' : '';
}
async function loadMe(){ try{ const d=await api('/api/auth/me'); IS_VIP=!!(d.user&&d.user.vip); updateVipUI(); }catch(e){} }
function toast(msg,type){let w=document.getElementById('toast-wrap');if(!w){w=document.createElement('div');w.className='toast-wrap';w.id='toast-wrap';document.body.appendChild(w);}const t=document.createElement('div');t.className='toast'+(type?(' '+type):'');t.textContent=msg;w.appendChild(t);setTimeout(()=>{t.style.transition='.3s';t.style.opacity='0';t.style.transform='translateY(8px)';setTimeout(()=>t.remove(),320);},2600);}

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
  // 占位符法:先把注释/字符串收进令牌(用私有区字符占位),再做关键字高亮,最后回填——
  // 保证后续正则永远不会命中已生成的 <span> 标记本身
  let s=esc(code);
  const toks=[];
  s=s.replace(/(\/\/[^\n]*)|(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;|"[^"\n]*"|'[^'\n]*')/g,function(m,cm,st){
    toks.push(cm?'<span class="hl-cm">'+cm+'</span>':'<span class="hl-str">'+(st||'')+'</span>');
    return String.fromCharCode(0xE100+toks.length-1);
  });
  s=s.replace(/\b(\d+\.?\d*)\b/g,'<span class="hl-num">$1</span>');
  s=s.replace(/\b(for|while|do|if|else|switch|case|break|continue|return|const|unsigned|namespace|using|include|std|cin|cout|endl|printf|scanf|main)\b/g,'<span class="hl-kw">$1</span>');
  s=s.replace(/\b(int|long|float|double|char|bool|void)\b/g,'<span class="hl-ty">$1</span>');
  s=s.replace(/[\uE100-\uE8FF]/g,function(ch){ return toks[ch.charCodeAt(0)-0xE100]||''; });
  return s;
}
function hlInline(t){ let s=esc(t); s=s.replace(/`([^`]+)`/g,(m,p)=>`<code>${p}</code>`); return s; }
function fmtExp(t){ let s=esc(t); s=s.replace(/`([^`]+)`/g,'<code>$1</code>'); s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>'); s=s.replace(/💡(.*)$/,'<span class="tip">💡$1</span>'); return s; }
function stars(n){ let h=''; for(let i=1;i<=5;i++){ if(n>=i)h+='★'; else if(n>=i-0.5)h+='<span style="position:relative;display:inline-block"><span class="empty">★</span><span style="position:absolute;left:0;width:50%;overflow:hidden">★</span></span>'; else h+='<span class="empty">★</span>'; } return '<span class="stars">'+h+'</span>'; }
function badge(req){return `<span class="badge ${REQ_CLS[req]||''}">${req}</span>`;}
function freqB(f){return `<span class="b-freq freq-${f}">${f}</span>`;}

function shade(hex,pct){ hex=String(hex).replace('#',''); if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');
  let r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16); const f=pct/100;
  const adj=c=> pct>0 ? c+(255-c)*f : c*(1+f); const h=c=>Math.max(0,Math.min(255,Math.round(adj(c)))).toString(16).padStart(2,'0');
  return '#'+h(r)+h(g)+h(b); }
let _pieN=0;
function pie(items){
  items=items.filter(d=>d.value>0);
  const total=items.reduce((a,b)=>a+b.value,0)||1, uid='pc'+(_pieN++);
  const cx=104,cy=96,rx=90,ry=68,depth=17;
  const pt=(a,dy)=>[(cx+rx*Math.cos(a)).toFixed(2),(cy+ry*Math.sin(a)+(dy||0)).toFixed(2)];
  let a0=-Math.PI/2; const sl=items.map((d,i)=>{const ang=d.value/total*2*Math.PI,a1=a0+ang,c=d.color||PALETTE[i%PALETTE.length];const o={a0,a1,c,i};a0=a1;return o;});
  const wedge=(s,dy)=>{const[x0,y0]=pt(s.a0,dy),[x1,y1]=pt(s.a1,dy),lg=(s.a1-s.a0)>Math.PI?1:0;return `M${cx},${(cy+(dy||0)).toFixed(2)} L${x0},${y0} A${rx},${ry} 0 ${lg} 1 ${x1},${y1} Z`;};
  let defs=`<filter id="${uid}sh" x="-25%" y="-20%" width="150%" height="165%"><feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#161b33" flood-opacity="0.20"/></filter>`
    +`<radialGradient id="${uid}gl" cx="36%" cy="24%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="42%" stop-color="#fff" stop-opacity=".09"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  sl.forEach(s=>{ defs+=`<linearGradient id="${uid}g${s.i}" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${shade(s.c,18)}"/><stop offset="1" stop-color="${shade(s.c,-6)}"/></linearGradient>`; });
  let body;
  if(sl.length===1){
    const c=sl[0].c;
    body=`<ellipse cx="${cx}" cy="${cy+depth}" rx="${rx}" ry="${ry}" fill="${shade(c,-28)}"/>`
      +`<path d="M${cx-rx},${cy} a${rx},${ry} 0 0 0 ${2*rx},0 l0,${depth} a${rx},${ry} 0 0 1 ${-2*rx},0 Z" fill="${shade(c,-20)}"/>`
      +`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${uid}g0)"/>`;
  } else {
    const base=sl.map(s=>`<path d="${wedge(s,depth)}" fill="${shade(s.c,-28)}"/>`).join('');
    let walls=''; sl.forEach(s=>{const f0=Math.max(s.a0,0),f1=Math.min(s.a1,Math.PI); if(f1>f0){const[x0,y0]=pt(f0,0),[x1,y1]=pt(f1,0),[bx1,by1]=pt(f1,depth),[bx0,by0]=pt(f0,depth),lg=(f1-f0)>Math.PI?1:0;
      walls+=`<path d="M${x0},${y0} A${rx},${ry} 0 ${lg} 1 ${x1},${y1} L${bx1},${by1} A${rx},${ry} 0 ${lg} 0 ${bx0},${by0} Z" fill="${shade(s.c,-19)}"/>`;}});
    const top=sl.map(s=>`<path d="${wedge(s,0)}" fill="url(#${uid}g${s.i})" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`).join('');
    body=base+walls+top;
  }
  const W=2*cx,H=cy+ry+depth+10;
  const gloss=`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${uid}gl)" pointer-events="none"/>`;
  const svg=`<svg class="pie3d" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs><g filter="url(#${uid}sh)">${body}</g>${gloss}</svg>`;
  const legend=sl.map(s=>{const pct=(items[s.i].value/total*100).toFixed(0);
    return `<span class="lg-n"><i class="sw" style="background:${s.c}"></i>${esc(items[s.i].name)}</span><span class="lg-v"><b>${items[s.i].value}</b><em>${pct}%</em></span>`;}).join('');
  return `<div class="chart-wrap">${svg}<div class="legend">${legend}</div></div>`;
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

function setActiveTab(tab){ ['learn','browse','practice','recommend','mock','wrong','progress','rank','mark'].forEach(t=>{
  const el=document.getElementById('tab-'+t); if(el) el.classList.toggle('on',t===tab); }); }

async function go(tab){
  setActiveTab(tab); document.getElementById('q').value='';
  if(tab==='learn'){ view={tab:'learn'}; renderLearn(); }
  else if(tab==='browse'){ view={tab:'browse',sub:'overview'}; await ensureCatalog(); renderBrowse(); }
  else if(tab==='practice'){ await ensureCatalog(); renderPracticeSetup(); }
  else if(tab==='recommend'){ await ensureCatalog(); await renderRecommend(); }
  else if(tab==='mock'){ await ensureCatalog(); await renderMock(); }
  else if(tab==='prog'){ await renderProgList(); }
  else if(tab==='progq'){ /* 由 renderProgQ 直接调用 */ }
  else if(tab==='wrong'){ await renderWrong(); }
  else if(tab==='progress'){ await renderProgress(); }
  else if(tab==='rank'){ await renderRank(); }
  else if(tab==='mark'){ await renderMark(); }
  else if(tab==='upgrade'){ setActiveTab(''); renderUpgrade(); }
  window.scrollTo(0,0);
}

async function ensureCatalog(){
  if(CATALOG) return CATALOG;
  C().innerHTML='<div class="empty"><div class="spinner"></div>加载题库中…</div>';
  CATALOG=await api('/api/catalog?level='+LEVEL); PAPERS=CATALOG.meta.papers; document.querySelectorAll('.badge-sub').forEach(e=>{e.textContent=CATALOG.level_name;}); return CATALOG;
}

/* ===================== 学习板块（先学后练） ===================== */
const LV_CN = {1:'一级',2:'二级',3:'三级',4:'四级',5:'五级',6:'六级',7:'七级',8:'八级'};
// 模块数据驱动：status 'ready'=已上线可进入；'soon'=已预留、内容编写中。后续填内容只需改这里。
const LEARN_MODULES = [
  {icon:'📘', title:'入门讲义', tag:'纸质教程·电子版', key:'lessons', status:'ready', fn:'renderLessons',
   desc:'纸质教程的电子版，按考纲章节讲解。建议先读讲义，再做对应章节的真题。'},
  {icon:'🪤', title:'陷阱通关手册', tag:'高频易错·避坑', key:'traps', l1:true, fn:'renderTraps',
   desc:'历年高频易错点与常见命题陷阱的汇总，按条目核对，适合考前过一遍。'},
  {icon:'📝', title:'限时模拟题', tag:'模考·估分', status:'ready', go:'mock',
   desc:'整套真题限时作答，交卷后自动估分。'},
  {icon:'📚', title:'真题精讲', tag:'逐题解析', status:'ready', go:'browse',
   desc:'按章节浏览全部历年真题，每题附详细解析。'},
  {icon:'🗺️', title:'备考路线图', tag:'学习计划', key:'roadmap', l1:true, fn:'renderRoadmap',
   desc:'本级别的学习顺序、时间规划与各阶段目标。'},
  {icon:'🎬', title:'视频精讲', tag:'重难点讲解', status:'soon',
   desc:'重点题型与难点的视频讲解。'},
  {icon:'📄', title:'知识速查表', tag:'一页速查', key:'cheat', l1:true, fn:'renderCheatsheet',
   desc:'本级别核心语法与概念的速查表，适合考前翻阅。'},
  {icon:'🗓️', title:'报考指南', tag:'报名·考务', key:'guide', l1:true, fn:'renderExamGuide',
   desc:'GESP 报名时间、考试流程、考场注意事项与证书说明。'},
];
function renderLearn(){
  const lv = LV_CN[LEVEL] || (LEVEL+'级');
  const cards = LEARN_MODULES.map(m=>{
    // l1:true 的模块当前仅一级上线;status:'ready' 的模块全级别可用
    const l1Ready = m.l1 && String(LEVEL)==='1';
    const ready = m.status==='ready' || l1Ready;
    const badge = ready ? '' : '<span class="lm-soon">即将上线</span>';
    const onclick = m.fn ? `${m.fn}()` : `go('${m.go}')`;
    const btn = ready
      ? `<button class="lm-btn" onclick="${onclick}">进入 →</button>`
      : `<button class="lm-btn ghost" disabled>敬请期待</button>`;
    return `<div class="lm-card${ready?'':' lm-dim'}">
      <div class="lm-top"><span class="lm-ic">${m.icon}</span>${badge}</div>
      <div class="lm-title">${m.title}<span class="lm-tag">${m.tag}</span></div>
      <p class="lm-desc">${m.desc}</p>
      ${btn}
    </div>`;
  }).join('');
  C().innerHTML = `
    <div class="learn-hero">
      <h2>📖 学习中心 · C++${lv}</h2>
      <p>刷题之外，先把知识学扎实。这里汇集本级别的教程、避坑手册、模拟题与备考资料——<b>先学后练，稳步通关</b>。</p>
    </div>
    <div class="learn-grid">${cards}</div>
    <div class="learn-foot">一级各模块已全部开放。其余级别可使用讲义、真题精讲与模考，其余模块在制作中。</div>`;
}

// 陷阱通关手册（数据来自 /api/traps，由一级解析的💡提示汇总而成）
let TRAPS_CACHE=null;
async function renderTraps(){
  setActiveTab('learn');
  C().innerHTML='<div class="empty"><div class="spinner"></div>正在打开陷阱通关手册…</div>';
  try{
    if(!TRAPS_CACHE){ const r=await fetch('/api/traps'); TRAPS_CACHE=await r.json(); }
  }catch(e){ C().innerHTML='<div class="empty">手册加载失败，请稍后再试。</div>'; return; }
  const data=TRAPS_CACHE; const cats=data.categories||[];
  const total=cats.reduce((s,c)=>s+c.traps.length,0);
  const toc=cats.map((c,i)=>`<a href="#trapcat${i}" class="tp-toc-i">${c.title}<span>${c.traps.length}</span></a>`).join('');
  const body=cats.map((c,i)=>{
    const items=c.traps.map(t=>{
      const ex=(t.examples||[]).map(e=>`<a class="tp-ex" href="/q/${e.qid}" target="_blank">${e.paper} ${e.type==='mc'?'单':'判'}${e.num}</a>`).join('');
      return `<div class="tp-card">
        <div class="tp-h"><span class="tp-x">⚠️</span><b>${t.title}</b></div>
        <p class="tp-why">${fmtExp(t.why)}</p>
        <div class="tp-eg">
          <div class="tp-bad"><span>✗ 错误/陷阱</span><pre>${esc(t.wrong)}</pre></div>
          <div class="tp-good"><span>✓ 正确/正解</span><pre>${esc(t.right)}</pre></div>
        </div>
        ${ex?`<div class="tp-exs">📎 出现的真题：${ex}</div>`:''}
      </div>`;
    }).join('');
    return `<section class="tp-cat" id="trapcat${i}"><h3 class="tp-cat-h">${c.title}</h3><div class="tp-list">${items}</div></section>`;
  }).join('');
  C().innerHTML=`
    <div class="tp-back"><a onclick="go('learn')">← 返回学习中心</a></div>
    <div class="learn-hero">
      <h2>🪤 陷阱通关手册 · C++一级</h2>
      <p>这本手册汇总了一级真题里 <b>${total} 个高频易错陷阱</b>，全部来自每道题的「💡 提示」。考前过一遍，专治<b>粗心丢分</b>。每条都配错误/正解对照，并链接到出现该坑的真题。</p>
    </div>
    <div class="tp-toc">${toc}</div>
    ${body}
    <div class="learn-foot">看完手册，建议回到「真题精讲」对照练习，把这些坑真正踩熟、记牢。</div>`;
  window.scrollTo(0,0);
}

/* ===================== 入门讲义(电子教程) ===================== */
let LESSONS_TOC=null, LESSONS_TOC_LV=null;
async function renderLessons(){
  setActiveTab('learn');
  C().innerHTML='<div class="empty"><div class="spinner"></div>正在打开讲义…</div>';
  let d;
  try{
    if(LESSONS_TOC && LESSONS_TOC_LV===LEVEL){ d=LESSONS_TOC; }
    else { d=await api('/api/lessons?level='+LEVEL); LESSONS_TOC=d; LESSONS_TOC_LV=LEVEL; }
  }catch(e){ C().innerHTML='<div class="empty">讲义加载失败，请稍后再试。</div>'; return; }
  const main=d.chapters.filter(c=>String(c.id)[0]==='c');
  const apps=d.chapters.filter(c=>String(c.id)[0]==='a');
  const item=c=>{
    const lock=c.locked?'<span class="lb-lock">🔒 VIP</span>':'';
    const secs=(c.sections||[]).length?`<span class="lb-secs">${c.sections.length} 节</span>`:'';
    return `<div class="lb-item${c.locked?' lb-dim':''}" onclick="renderLessonChapter('${c.id}')">
      <span class="lb-t">${esc(c.title)}</span><span class="lb-x">${secs}${lock}</span></div>`;
  };
  C().innerHTML=`
    <div class="tp-back"><a onclick="go('learn')">← 返回学习中心</a></div>
    <div class="learn-hero">
      <h2>📘 ${esc(d.title)}</h2>
      <p>${esc(d.brand||'')} · 对照官方考纲编写，每章配模拟题精讲。建议先读讲义，再做对应章节的真题。${Number(LEVEL)!==1?'前言与第 1 章免费试读，全书内容 VIP 专享。':'本级别讲义全部免费阅读。'}</p>
    </div>
    <div class="lb-card"><div class="lb-h">正文</div>${main.map(item).join('')}</div>
    ${apps.length?`<div class="lb-card"><div class="lb-h">附录</div>${apps.map(item).join('')}</div>`:''}
    <div class="learn-foot">建议每读完一章，到「真题精讲」做对应章节的真题。</div>`;
  window.scrollTo(0,0);
}
async function renderLessonChapter(cid){
  setActiveTab('learn');
  C().innerHTML='<div class="empty"><div class="spinner"></div>正在加载章节…</div>';
  let d;
  try{ d=await api('/api/lessons/chapter?level='+LEVEL+'&id='+encodeURIComponent(cid)); }
  catch(e){ C().innerHTML='<div class="empty">章节加载失败，请稍后再试。</div>'; return; }
  const nav=(cls)=>`<div class="ls-nav ${cls}">
    ${d.prev?`<a class="ls-navbtn" onclick="renderLessonChapter('${d.prev.id}')">← ${esc(d.prev.title)}</a>`:'<span></span>'}
    <a class="ls-navbtn ghost" onclick="renderLessons()">目录</a>
    ${d.next?`<a class="ls-navbtn" onclick="renderLessonChapter('${d.next.id}')">${esc(d.next.title)} →</a>`:'<span></span>'}
  </div>`;
  const toc=(d.sections||[]).length?`<div class="ls-toc">${d.sections.map(s=>`<a href="#s${s.id.replace(/\./g,'-')}">${s.id}　${esc(s.title)}</a>`).join('')}</div>`:'';
  const body=d.locked
    ? `<div class="exp vip-lock" style="margin:24px 0">🔒 本章为 <b>VIP 专享</b> · 前言与第 1 章免费试读<a class="vip-cta" onclick="event.stopPropagation();go('upgrade')">开通 VIP 解锁全书 ›</a></div>`
    : `<article class="ls-body">${d.html}</article>`;
  C().innerHTML=`
    <div class="tp-back"><a onclick="renderLessons()">← 返回讲义目录</a></div>
    <div class="learn-hero ls-hero"><h2>${esc(d.title)}</h2></div>
    ${toc}${body}${nav('bottom')}`;
  window.scrollTo(0,0);
}

/* ===================== 备考路线图(一级) ===================== */
function renderRoadmap(){
  setActiveTab('learn');
  const stages=[
    {w:'第 1–2 周',t:'起步：认识计算机与第一个程序',ch:'讲义第 1–3 章',pts:'计算机软硬件、Dev-C++ 实操、标识符与变量',ms:'独立写出并运行 Hello World，说清「编辑→编译→运行」流程'},
    {w:'第 3–5 周',t:'语法核心：数据与运算',ch:'讲义第 4–7 章',pts:'数据类型、cin/cout 与 printf、运算符与优先级、顺序结构',ms:'「表达式求值」「输出是什么」类单选题正确率 ≥ 80%'},
    {w:'第 6–8 周',t:'控制结构：分支与循环',ch:'讲义第 8–12 章',pts:'if/switch、for、while、break 与 continue',ms:'循环类编程题能独立写出，不抄答案'},
    {w:'第 9–10 周',t:'综合与真题实战',ch:'讲义第 13 章 + 真题精讲',pts:'综合编程 + 按章刷完全部 325 道真题',ms:'错题本完整清零一遍'},
    {w:'考前 2 周',t:'冲刺：模考与避坑',ch:'陷阱手册 + 限时模考',pts:'陷阱通关手册过一遍；限时模考至少 3 套；重做全部错题',ms:'模考稳定 80 分以上，安心进考场'},
  ];
  const rows=stages.map((s,i)=>`<div class="rm-stage">
    <div class="rm-no">${i+1}</div>
    <div class="rm-bd">
      <div class="rm-w">${s.w}</div>
      <div class="rm-t">${s.t}<span class="rm-ch">${s.ch}</span></div>
      <p class="rm-p">${s.pts}</p>
      <div class="rm-ms">🏁 里程碑：${s.ms}</div>
    </div></div>`).join('');
  C().innerHTML=`
    <div class="tp-back"><a onclick="go('learn')">← 返回学习中心</a></div>
    <div class="learn-hero"><h2>🗺️ 备考路线图 · C++一级</h2>
      <p>零基础按此路线安排，约 10–12 周可完成一级备考；每周 2–3 次、每次 40–60 分钟，进度快可压缩到 6–8 周。GESP 每年 3、6、9、12 月各开考一次，可据此倒推开始时间。</p></div>
    ${rows}
    <div class="lb-card"><div class="lb-h">使用建议</div><div style="padding:14px 18px;font-size:16.5px;line-height:1.85;color:var(--ink2)">
      每个阶段按「读讲义 → 做对应章节真题 → 错题进错题本」推进，达成里程碑再进入下一阶段，没达成就放慢一周。冲刺期以「陷阱通关手册」和「限时模考」为主。</div></div>
    <div class="learn-foot">可以从 <a onclick="renderLessons()" style="color:#185fa5;font-weight:700;cursor:pointer">入门讲义第 1 章</a> 开始。</div>`;
  window.scrollTo(0,0);
}

/* ===================== 知识速查表(一级) ===================== */
function renderCheatsheet(){
  setActiveTab('learn');
  C().innerHTML=`
    <div class="tp-back"><a onclick="go('learn')">← 返回学习中心</a></div>
    <div class="learn-hero"><h2>📄 知识速查表 · C++一级</h2>
      <p>一级的核心语法都在这一页，适合考前快速过一遍。</p></div>
    <div class="lb-card"><div class="lb-h">① 程序骨架(必须一字不差)</div><div class="cs-pad">
      <pre class="ls-code"><code>#include &lt;iostream&gt;
using namespace std;
int main() {
    cout &lt;&lt; "Hello, GESP!" &lt;&lt; endl;
    return 0;
}</code></pre>
      <p class="cs-note">⚠️ main 必须返回 <code>int</code>；每条语句末尾的分号不能省；C++ 严格区分大小写。</p></div></div>
    <div class="lb-card"><div class="lb-h">② 常用数据类型</div><div class="cs-pad"><div class="ls-tablewrap"><table class="ls-table">
      <tr><th>类型</th><th>含义</th><th>要点</th></tr>
      <tr><td><code>int</code></td><td>整数</td><td>约 ±21 亿以内</td></tr>
      <tr><td><code>double</code></td><td>小数(浮点)</td><td>比 float 更精确，一级首选</td></tr>
      <tr><td><code>char</code></td><td>单个字符</td><td>用单引号：<code>'A'</code></td></tr>
      <tr><td><code>bool</code></td><td>布尔</td><td>只有 true / false</td></tr>
    </table></div></div></div>
    <div class="lb-card"><div class="lb-h">③ 运算符:一级最高频考点</div><div class="cs-pad"><div class="ls-tablewrap"><table class="ls-table">
      <tr><th>要点</th><th>例子</th><th>结果</th></tr>
      <tr><td>整数除法<b>向下取整</b></td><td><code>7 / 2</code></td><td><code>3</code>(不是 3.5)</td></tr>
      <tr><td><code>%</code> 取余数</td><td><code>7 % 2</code></td><td><code>1</code></td></tr>
      <tr><td>先乘除后加减</td><td><code>2 + 3 * 4</code></td><td><code>14</code></td></tr>
      <tr><td><code>=</code> 是赋值,<code>==</code> 才是比较</td><td><code>if (a == 5)</code></td><td>判断 a 是否等于 5</td></tr>
      <tr><td>自增/自减</td><td><code>i++</code> / <code>i--</code></td><td>i 加 1 / 减 1</td></tr>
    </table></div></div></div>
    <div class="lb-card"><div class="lb-h">④ 输入输出</div><div class="cs-pad"><div class="ls-tablewrap"><table class="ls-table">
      <tr><th>写法</th><th>作用</th></tr>
      <tr><td><code>cin &gt;&gt; a;</code></td><td>读入一个值到变量 a</td></tr>
      <tr><td><code>cout &lt;&lt; a &lt;&lt; endl;</code></td><td>输出 a 并换行(endl = 换行)</td></tr>
      <tr><td><code>printf("%d", a);</code></td><td>按格式输出整数</td></tr>
      <tr><td><code>%d</code> 整数 · <code>%f</code> 小数 · <code>%.2f</code> 保留两位 · <code>%c</code> 字符</td><td>printf 格式符(高频考点)</td></tr>
    </table></div></div></div>
    <div class="lb-card"><div class="lb-h">⑤ ASCII 三个关键值(大小写差 32)</div><div class="cs-pad"><div class="ls-tablewrap"><table class="ls-table">
      <tr><th><code>'0'</code></th><th><code>'A'</code></th><th><code>'a'</code></th></tr>
      <tr><td>48</td><td>65</td><td>97</td></tr>
    </table></div></div></div>
    <div class="lb-card"><div class="lb-h">⑥ 考前必背 8 条易错</div><div class="cs-pad"><ol class="cs-list">
      <li>分号丢失是最常见编译错误，逐行检查</li>
      <li><code>cout</code>、<code>cin</code>、<code>endl</code> 都<b>不是</b>关键字(判断题高频)</li>
      <li><code>7 / 2 = 3</code>，想要 3.5 必须有小数参与：<code>7.0 / 2</code></li>
      <li><code>if (a = 5)</code> 是赋值永远为真，比较要用 <code>==</code></li>
      <li><code>switch</code> 不支持 double 和 string</li>
      <li><code>break</code> 只跳出<b>最内一层</b>循环</li>
      <li><code>for(int i=0;…)</code> 中的 i 出了 for 就不存在</li>
      <li><code>void main()</code> 是错的，必须 <code>int main()</code></li>
    </ol></div></div>
    <div class="learn-foot">每条都对应真题中出现过的考点，建议配合 <a onclick="renderTraps()" style="color:#185fa5;font-weight:700;cursor:pointer">陷阱通关手册</a> 一起复习。</div>`;
  window.scrollTo(0,0);
}

/* ===================== 报考指南(一级) ===================== */
function renderExamGuide(){
  setActiveTab('learn');
  C().innerHTML=`
    <div class="tp-back"><a onclick="go('learn')">← 返回学习中心</a></div>
    <div class="learn-hero"><h2>🗓️ GESP 报考指南</h2>
      <p>报名时间、流程、考场要求与证书说明的汇总。具体日期与费用以 CCF 官网当期通知为准。</p></div>
    <div class="lb-card"><div class="lb-h">① 考试时间规律</div><div class="cs-pad">
      <p class="cs-p">GESP 每年开考 <b>4 次：3 月、6 月、9 月、12 月</b>各一次。报名通常在<b>考前 1–2 个月</b>开放，名额先到先得，建议关注官网通知后尽早报名。</p>
      <p class="cs-p">💡 备考节奏参考：用 <a onclick="renderRoadmap()" style="color:#185fa5;font-weight:700;cursor:pointer">备考路线图</a> 的 10–12 周计划，倒推出最晚起跑时间。</p></div></div>
    <div class="lb-card"><div class="lb-h">② 报名流程(全程线上)</div><div class="cs-pad"><ol class="cs-list">
      <li>访问 CCF GESP 官网 <b>gesp.ccf.org.cn</b>，注册账号并完成实名信息</li>
      <li>选择编程语言(<b>C++</b>)、报考级别与考点城市</li>
      <li>在线缴费，报名成功后等待通知</li>
      <li>考前按通知打印<b>准考证</b>，记好考点地址与场次时间</li>
    </ol>
    <p class="cs-p">级别选择：GESP 支持直接报考相应级别(具体规则以官网当期简章为准)。零基础建议从一级起步，把地基打牢。</p></div></div>
    <div class="lb-card"><div class="lb-h">③ 一级考什么</div><div class="cs-pad"><div class="ls-tablewrap"><table class="ls-table">
      <tr><th>题型</th><th>数量</th><th>说明</th></tr>
      <tr><td>单选题(客观题)</td><td>15 道 × 2 分</td><td>语法概念 + 读程序选结果</td></tr>
      <tr><td>判断题(客观题)</td><td>10 道 × 2 分</td><td>概念辨析,易错点集中区</td></tr>
      <tr><td>编程题</td><td>2 道 × 25 分</td><td>上机编写完整程序,提交评测</td></tr>
    </table></div>
    <p class="cs-p">单选与判断合称「客观题」,共 50 分;编程题共 50 分,满分 100 分。客观题在「题库浏览 / 限时模考」中练习,编程题在「💻 编程题」栏目在线提交评测。</p>
    <p class="cs-p">机考形式。本站「<a onclick="go('mock')" style="color:#185fa5;font-weight:700;cursor:pointer">限时模拟题</a>」按真实题型组卷，建议考前完成 3 套以上。</p></div></div>
    <div class="lb-card"><div class="lb-h">④ 考场须知</div><div class="cs-pad"><ol class="cs-list">
      <li>携带<b>准考证 + 有效身份证件</b>(身份证/户口本,按通知要求)</li>
      <li>提前 30 分钟到场，留出入场核验时间</li>
      <li>开考先通览全卷：先做有把握的选择/判断，编程题留足时间</li>
      <li>编程题提交前务必<b>自测一遍样例</b>,检查输出格式(空格/换行)是否与题目完全一致</li>
    </ol></div></div>
    <div class="lb-card"><div class="lb-h">⑤ 成绩与证书</div><div class="cs-pad">
      <p class="cs-p">成绩一般在考后数周内于官网公布，达标即获 CCF 颁发的等级证书。GESP 证书由 CCF 颁发，可作为编程能力的证明，也是向 CSP-J/S 等竞赛进阶的常见路径，一级是这条路径的起点。</p></div></div>
    <div class="learn-foot">信息整理自 CCF 公开资料，具体以 <b>gesp.ccf.org.cn</b> 当期通知为准。</div>`;
  window.scrollTo(0,0);
}
/* ===================== 💻 编程题(在线评测) ===================== */
async function renderProgList(){
  setActiveTab('prog');
  C().innerHTML='<div class="empty"><div class="spinner"></div>加载编程题…</div>';
  let d;
  try{ d=await api('/api/prog?level='+LEVEL); }
  catch(e){
    C().innerHTML=`<div class="card"><div class="card-b empty"><div class="big">💻</div>${esc(e.message||'本级别编程题暂未上线')}<br><span style="font-size:13px;color:var(--ink3)">编程真题正在按级别整理上线，一级已就绪</span></div></div>`;
    return;
  }
  const byPaper={};
  d.questions.forEach(q=>{ (byPaper[q.paper]=byPaper[q.paper]||[]).push(q); });
  const rows=Object.keys(byPaper).sort().reverse().map(p=>`
    <div class="pg-paper">
      <div class="pg-paper-h">${papFull(p)}</div>
      ${byPaper[p].map(q=>`<div class="pg-row" onclick="renderProgQ('${q.pid}')">
        <span class="pg-st ${q.ac?'ac':q.tries?'tr':''}">${q.ac?'✓ 已通过':q.tries?'尝试过':'未做'}</span>
        <span class="pg-t">编程题 ${q.num} · ${esc(q.title)}</span>
        <span class="pg-go">去做题 ›</span></div>`).join('')}
    </div>`).join('');
  const judgeTip=d.judge?'':'<div class="notice" style="margin-bottom:14px">⏳ 在线评测引擎即将开通。开通前可以先看题、写代码，对照样例与参考程序自查。</div>';
  C().innerHTML=`
    <div class="learn-hero"><h2>💻 编程真题 · 在线评测</h2>
      <p>历年真题编程题（每卷 2 题 × 25 分，占试卷 50 分；单选与判断为客观题，在「题库浏览」练习）。在线编写 C++ 代码提交评测，逐测试点反馈结果。建议先用「<a onclick="renderLessons()" style="color:#185fa5;font-weight:700;cursor:pointer">入门讲义</a>」学完对应章节再来练。</p></div>
    ${judgeTip}${rows}`;
  window.scrollTo(0,0);
}

let PROGQ=null;
async function renderProgQ(pid){
  setActiveTab('prog');
  C().innerHTML='<div class="empty"><div class="spinner"></div>加载题目…</div>';
  let d;
  try{ d=await api('/api/prog/'+encodeURIComponent(pid)); }
  catch(e){ C().innerHTML='<div class="empty">'+esc(e.message)+'</div>'; return; }
  PROGQ=d;
  const stmt=progMd(d.statement);
  const subs=(d.submissions||[]).map(s=>`<div class="pg-sub"><span class="pg-v v-${s.verdict}">${s.verdict}</span><span>${s.passed}/${s.total} 测试点</span><span class="pg-sub-t">${(s.created_at||'').slice(5,16)}</span></div>`).join('');
  const starter=d.last_code||'#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n';
  C().innerHTML=`
    <div class="tp-back"><a onclick="go('prog')">← 返回编程题列表</a></div>
    <div class="learn-hero ls-hero"><h2>${esc(d.title)}</h2>
      <p style="margin-top:4px;font-size:14px;color:var(--ink3)">${papFull(d.paper)} · 编程题 ${d.num} ·  时限 ${d.time_limit}s</p>
      ${(d.kps&&d.kps.length)?`<div class="pg-kps">${d.kps.map(k=>'<span class="pg-kp">'+esc(k)+'</span>').join('')}</div>`:''}</div>
    <div class="card"><div class="card-b"><article class="ls-body pg-stmt">${stmt}</article>
      <div class="q-report"><a onclick="openReport('${d.pid}','pg')">题目有误？报错 ›</a><span class="rp-slot" id="rppg"></span></div></div></div>
    <div class="card"><div class="card-h">✍️ 我的代码<span class="sub">C++ · Tab 键可缩进</span></div><div class="card-b">
      <textarea id="pg-code" class="pg-editor" spellcheck="false">${esc(starter)}</textarea>
      <div class="pg-actions">
        <button class="btn solid" id="pg-submit" onclick="submitProg('${d.pid}')" ${d.judge?'':'disabled title="评测引擎即将开通"'}>${d.judge?'提交评测':'评测即将开通'}</button>
        <a class="pg-sol-toggle" onclick="toggleSol()">标准答案与代码解析 ▾</a>
      </div>
      <div id="pg-verdict"></div>
      <div id="pg-sol" style="display:none">
        <h4 class="ls-h4">标准答案(逐行注释版) <a class="pg-copy" onclick="copyAnno(this)">复制代码</a></h4>
        <pre class="ls-code pg-anno"><code>${hl(d.solution_zh||d.solution)}</code></pre>
        ${d.analysis?`<h4 class="ls-h4">代码解析</h4><div class="pg-analysis">${progMd(d.analysis)}</div>`:''}
        <p class="cs-note">💡 建议先独立完成并通过评测，再对照标准答案比较写法差异。</p></div>
    </div></div>
    ${subs?`<div class="card"><div class="card-h">📜 提交记录</div><div class="card-b">${subs}</div></div>`:''}`;
  const ta=document.getElementById('pg-code');
  ta.addEventListener('keydown',function(e){
    if(e.key==='Tab'){ e.preventDefault();
      const s=this.selectionStart, t=this.selectionEnd;
      this.value=this.value.slice(0,s)+'    '+this.value.slice(t);
      this.selectionStart=this.selectionEnd=s+4; }
  });
  window.scrollTo(0,0);
}
function copyAnno(el){
  const txt=(PROGQ&&(PROGQ.solution_zh||PROGQ.solution))||'';
  const done=()=>{ el.textContent='已复制 ✓'; setTimeout(()=>{el.textContent='复制代码';},1600); };
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done).catch(()=>fallbackCopy(txt,done)); }
  else fallbackCopy(txt,done);
}
function fallbackCopy(txt,done){
  const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta);
  ta.select(); try{document.execCommand('copy');}catch(e){} document.body.removeChild(ta); done();
}
function toggleSol(){
  const el=document.getElementById('pg-sol');
  el.style.display=el.style.display==='none'?'block':'none';
}
async function submitProg(pid){
  const btn=document.getElementById('pg-submit');
  const out=document.getElementById('pg-verdict');
  const code=document.getElementById('pg-code').value;
  btn.disabled=true; btn.textContent='评测中…';
  out.innerHTML='<div class="empty" style="padding:14px"><div class="spinner"></div>正在逐测试点评测，请稍候…</div>';
  try{
    const r=await api('/api/prog/'+encodeURIComponent(pid)+'/submit',{method:'POST',body:JSON.stringify({code})});
    if(r.verdict==='CE'){
      out.innerHTML=`<div class="pg-result v-CE"><b>✗ 编译错误 (CE)</b><pre class="pg-ce">${esc(r.compile_output||'')}</pre></div>`;
    }else{
      const dots=(r.results||[]).map(t=>`<span class="pg-dot d-${t.status}" title="测试点 ${t.name}: ${t.status}">${t.status==='AC'?'✓':'✗'}</span>`).join('');
      const remain=r.total-(r.results||[]).length;
      const head=r.verdict==='AC'
        ?`<b class="pg-ac">🎉 全部通过 (AC) · ${r.passed}/${r.total}</b>`
        :`<b>✗ ${r.verdict==='WA'?'答案错误 (WA)':r.verdict==='TLE'?'超出时限 (TLE)':'运行错误 (RE)'} · 通过 ${r.passed}/${r.total}</b>`;
      out.innerHTML=`<div class="pg-result v-${r.verdict}">${head}<div class="pg-dots">${dots}${remain>0?`<span class="pg-skip">… 其余 ${remain} 点未测</span>`:''}</div>${r.verdict!=='AC'?'<p class="pg-hint">提示：从第一个失败的测试点开始排查；注意输出格式（空格 / 换行）要与要求完全一致。</p>':''}</div>`;
    }
  }catch(e){ out.innerHTML='<div class="pg-result v-RE"><b>'+esc(e.message||'提交失败')+'</b></div>'; }
  finally{ btn.disabled=false; btn.textContent='提交评测'; }
}
/* 极简 markdown 渲染(题面专用:标题/粗体/代码块/行内码) */
function progMd(md){
  let s=esc(md);
  s=s.replace(/```([a-z]*)\n([\s\S]*?)```/g,(m,l,c)=>'<pre class="ls-code"><code>'+c.replace(/\n$/,'')+'</code></pre>');
  s=s.replace(/^####\s*(.+)$/gm,'<h4 class="ls-h4">$1</h4>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  s=s.replace(/^- (.+)$/gm,'<p class="pg-li">· $1</p>');
  s=s.split(/\n{2,}/).map(p=>/^<(h4|pre|p)/.test(p.trim())?p:'<p>'+p.replace(/\n/g,'<br>')+'</p>').join('');
  return s;
}

/* ===================== 题库浏览 ===================== */
function browseLayout(mainHtml){
  return `<div class="layout"><aside class="side"><div class="card" id="sidebar"></div></aside><main class="main" id="bmain">${mainHtml}</main></div>`;
}
function renderSidebar(){
  const rows=CATALOG.chapters.map(c=>{
    const act=(view.cid===c.id)?'active':'';
    return `<div class="nav-item ${act}" title="第${short(c.id).slice(1)}章 ${esc(c.name)}" onclick="goBrowse('chapter','${c.id}')">
      <span class="ni-name"><span class="caret">▶</span><span class="ch">第${short(c.id).slice(1)}章</span><span class="ni-nm">${c.name}</span></span>
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
    <div class="notice"><b>题型说明</b>:本题库收录的单选题与判断题合称试卷的「<b>客观题</b>」部分(单选 15 题 × 2 分 + 判断 10 题 × 2 分,共 50 分);编程题(2 题 × 25 分,共 50 分)在顶部「💻 编程题」栏目单独提供在线评测。真题已对照 CCF GESP 大纲按知识点归类并标注答案;一至八级 2300 道真题均配有逐题解析，<b>对所有用户免费开放</b>;一级解析另含逐题提示与易错点说明。知识点归类由程序依题面与代码自动判定,个别题以题目本身为准。</div></div>`;
  C().innerHTML=browseLayout(main); renderSidebar();
}
async function goBrowse(sub,cid,sid){
  view={tab:'browse',sub,cid,sid}; setActiveTab('browse');
  if(sub==='overview'){ renderBrowse(); }
  else if(sub==='chapter'){ renderChapter(cid); }
  else if(sub==='section'){
    C().innerHTML=browseLayout('<div class="empty"><div class="spinner"></div>加载中…</div>'); renderSidebar();
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
  let exp; if(q.locked){ exp=lockBox(); } else if(q.explanation){ let e=fmtExp(q.explanation); exp=`<div class="exp">${e}</div>`; }
  else exp='<div class="exp todo">本题解析整理中,可先对照答案理解</div>';
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
      <div class="ans"><div class="a-line">正确答案：<span class="ansv">${q.answer}</span></div>${exp}
      <div class="q-report"><a onclick="event.stopPropagation();openReport('${q.qid}','${idx}')">题目有误？报错 ›</a><span class="rp-slot" id="rp${idx}"></span></div></div></div></div>`;
}
/* 题目报错:行内小表单 */
function openReport(qid,idx){
  const host=document.getElementById('rp'+idx); if(!host) return;
  if(host.dataset.open){ host.innerHTML=''; delete host.dataset.open; return; }
  host.dataset.open='1';
  host.innerHTML=`<div class="rp-box">
    <textarea id="rpt${idx}" maxlength="300" rows="2" placeholder="请描述问题：如答案有误、解析笔误、题干缺图等（2–300 字）"></textarea>
    <div class="rp-act"><button class="lm-btn ghost" onclick="event.stopPropagation();openReport('${qid}','${idx}')">取消</button><button class="lm-btn" onclick="event.stopPropagation();submitReport('${qid}','${idx}')">提交</button></div></div>`;
  const ta=document.getElementById('rpt'+idx); if(ta) ta.focus();
}
async function submitReport(qid,idx){
  const ta=document.getElementById('rpt'+idx); const v=(ta&&ta.value||'').trim();
  if(v.length<2){ if(ta) ta.placeholder='请填写问题描述后再提交'; return; }
  try{
    await api('/api/questions/'+encodeURIComponent(qid)+'/report',{method:'POST',body:JSON.stringify({reason:v})});
    const host=document.getElementById('rp'+idx);
    host.innerHTML='<span class="rp-ok">已收到，感谢反馈，我们会尽快核对。</span>'; delete host.dataset.open;
  }catch(e){ const host=document.getElementById('rp'+idx); if(host) host.insertAdjacentHTML('beforeend','<span class="rp-err">'+esc(e.message||'提交失败')+'</span>'); }
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
  }catch(e){ toast(e.message,'err'); }
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
  C().innerHTML='<div class="empty"><div class="spinner"></div>组卷中…</div>';
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
    const expHtml=d.locked?lockBox():`<div class="exp">${d.explanation?fmtExp(d.explanation):'<span class="todo">本题解析整理中,可先对照答案理解</span>'}</div>`;
    const last=quiz.idx>=quiz.questions.length-1;
    document.getElementById('quizfb').innerHTML=
      `<div class="fb ${d.correct?'ok':'no'}">${d.correct?'✓ 回答正确':'✗ 回答错误,正确答案：'+d.answer}</div>
       <div class="ans show">${expHtml}</div>`;
    document.getElementById('submitbtn').outerHTML=`<button class="btn solid" onclick="${last?'finishQuiz()':'nextQ()'}">${last?'查看结果 ›':'下一题 ›'}</button>`;
  }catch(err){ toast(err.message,'err'); quiz.answered=false; document.getElementById('submitbtn').disabled=false; }
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
  C().innerHTML='<div class="empty"><div class="spinner"></div>加载错题本…</div>';
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
  const el=document.getElementById('q'+idx); if(el){el.style.transition='.3s';el.style.opacity='0';setTimeout(()=>el.remove(),300);} }catch(e){toast(e.message,'err');} }

/* ===================== 我的进度 ===================== */
async function renderProgress(){
  C().innerHTML='<div class="empty"><div class="spinner"></div>统计中…</div>';
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
    <div class="cheer-wrap"><span class="cheer">${d.answered===0?'今天还没做题，先来几道找找状态':d.accuracy>=80?'正确率不错，保持这个状态':d.wrongbook_count>0?('错题本还有 '+d.wrongbook_count+' 题，建议先清错题'):'按自己的节奏继续'}</span></div>
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
  C().innerHTML='<div class="empty"><div class="spinner"></div>加载收藏…</div>';
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
  C().innerHTML='<div class="empty"><div class="spinner"></div>组卷中…</div>';
  try{
    const d=await api('/api/mock/start',{method:'POST',body:JSON.stringify({level:Number(LEVEL),paper})});
    MOCK={level:Number(LEVEL),paper,questions:d.questions,answers:{},remain:d.duration_sec,timer:null,submitted:false};
    renderMockExam(); MOCK.timer=setInterval(tickMock,1000);
  }catch(e){ if(/VIP/.test(e.message)){ toast(e.message,'err'); go('upgrade'); } else C().innerHTML=`<div class="empty">组卷失败：${esc(e.message)}</div>`; }
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
  C().innerHTML='<div class="empty"><div class="spinner"></div>判分中…</div>';
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
    const expBox=(q.locked?lockBox():`<div class="exp">${q.explanation?fmtExp(q.explanation):'<span class="todo">本题暂未提供解析</span>'}</div>`)
      +`<div class="q-report"><a onclick="event.stopPropagation();openReport('${q.qid}','m${i}')">题目有误？报错 ›</a><span class="rp-slot" id="rpm${i}"></span></div>`;
    return `<div class="q open" id="q${i}"><div class="q-head"><span class="qtype type-${q.type}">${isMC?'单选':'判断'}</span>
      <span class="q-src">第${i+1}题</span> <span style="margin-left:auto;font-weight:600" class="${q.correct?'fb-ok':'fb-no'}">${q.correct?'✓ 正确':'✗ 你答'+(q.your||'未答')+' / 应'+q.answer}</span></div>
      <div class="q-body"><div class="q-stem">${hlInline(q.stem)}</div>${q.code?`<pre class="q-code">${hl(q.code)}</pre>`:''}${optsHtml}
      <div class="ans show"><div class="a-line">正确答案：<span class="ansv">${q.answer}</span></div>${expBox}</div></div></div>`;
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

/* ===================== 更换头像 ===================== */
function openAvatarDlg(){
  let picked=AVATAR;
  const dlg=document.createElement('div'); dlg.className='avdlg-mask'; dlg.id='avdlg';
  dlg.innerHTML=`<div class="avdlg">
    <div class="avdlg-h">更换头像 <span class="avdlg-x" onclick="document.getElementById('avdlg').remove()">×</span></div>
    <div class="avdlg-grid">${Array.from({length:12},(_,i)=>`<button class="ap${('a'+(i+1))===AVATAR?' on':''}" data-av="a${i+1}"><img src="/avatars/a${i+1}.svg" alt=""></button>`).join('')}</div>
    <div class="avdlg-up">
      <label class="avdlg-upbtn">上传图片<input type="file" id="av-file" accept="image/png,image/jpeg,image/webp" hidden></label>
      <span class="avdlg-cur" id="av-cur">${avHtml(AVATAR)}</span>
      <span class="avdlg-tip">支持 jpg/png，自动裁剪为方形小图</span>
    </div>
    <div class="avdlg-f"><button class="btn solid" id="av-save">保存</button></div>
  </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click',e=>{ if(e.target===dlg) dlg.remove(); });
  dlg.querySelector('.avdlg-grid').addEventListener('click',e=>{
    const b=e.target.closest('.ap'); if(!b)return;
    picked=b.dataset.av;
    dlg.querySelectorAll('.ap').forEach(x=>x.classList.toggle('on',x===b));
    document.getElementById('av-cur').innerHTML=avHtml(picked);
  });
  document.getElementById('av-file').addEventListener('change',function(){
    const f=this.files&&this.files[0]; if(!f)return;
    const img=new Image();
    img.onload=()=>{
      const S=128,c=document.createElement('canvas');c.width=S;c.height=S;
      const x=c.getContext('2d');
      const m=Math.min(img.width,img.height);
      x.drawImage(img,(img.width-m)/2,(img.height-m)/2,m,m,0,0,S,S);
      picked=c.toDataURL('image/jpeg',0.82);
      dlg.querySelectorAll('.ap').forEach(b=>b.classList.remove('on'));
      document.getElementById('av-cur').innerHTML=avHtml(picked);
      URL.revokeObjectURL(img.src);
    };
    img.src=URL.createObjectURL(f);
  });
  document.getElementById('av-save').onclick=async()=>{
    try{
      const d=await api('/api/me/avatar',{method:'POST',body:JSON.stringify({avatar:picked})});
      localStorage.setItem('gesp_avatar',d.avatar);
      const u=document.getElementById('uavatar'); if(u) u.innerHTML=avHtml(d.avatar);
      dlg.remove();
    }catch(e){ alert(e.message||'保存失败'); }
  };
}

/* ===================== 🏆 排行榜 + 打卡积分 ===================== */
async function renderRank(){
  C().innerHTML='<div class="empty"><div class="spinner"></div>加载成就与排行…</div>';
  const [st,lb]=await Promise.all([api('/api/stats/me'),api('/api/leaderboard')]);
  let act=[];try{act=(await api('/api/activity')).days||[];}catch(e){}
  const cmap={};act.forEach(x=>cmap[x.d]=x.c);
  const cells=[];const today=new Date();
  for(let i=90;i>=0;i--){const dt=new Date(today);dt.setDate(today.getDate()-i);const ds=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');const c=cmap[ds]||0;const cl=c===0?'':c<=1?'l1':c<=2?'l2':c<=4?'l3':'l4';cells.push('<i class="'+cl+'"></i>');}
  const heat=`<div class="card"><div class="card-h">🔥 活跃度<span class="sub">最近 13 周 · 连续 ${st.streak} 天</span></div><div class="card-b"><div class="heat">${cells.join('')}</div><div class="heat-legend">少 <i style="background:#eaecf3"></i><i style="background:#bde8d8"></i><i style="background:#7ed9b4"></i><i style="background:#35c191"></i><i style="background:var(--pass-d)"></i> 多</div></div></div>`;
  const rows=lb.top.map(u=>`<div class="lb-row ${u.me?'me':''}">
    <span class="lb-rank ${u.rank<=3?['r1','r2','r3'][u.rank-1]:''}">${u.rank}</span>
    <span class="lb-name"><span class="lb-av">${avHtml(u.avatar)}</span> ${esc(u.username)}${u.me?' · 我':''}</span>
    <span class="lb-tier">${u.icon} ${u.tier}</span><span class="lb-pts">${u.points} 分</span></div>`).join('');
  const checkin = st.today_done ? `<div class="ci ci-done">✅ 今日已打卡 · 连续 ${st.streak} 天,继续保持!</div>`
    : `<div class="ci ci-todo">📅 今天还没练习——做一道题即可自动打卡</div>`;
  C().innerHTML=`<div class="card"><div class="card-h">🏆 我的成就</div><div class="card-b">
    <div class="ach-grid">
      <div class="ach-card"><div class="ach-ic">${st.tier_icon}</div><div class="ach-v">${st.tier}</div><div class="ach-l">当前段位</div></div>
      <div class="ach-card amber"><div class="ach-ic">💎</div><div class="ach-v">${st.points}</div><div class="ach-l">积分</div></div>
      <div class="ach-card teal"><div class="ach-ic">🔥</div><div class="ach-v">${st.streak}</div><div class="ach-l">连续打卡(天)</div></div>
      <div class="ach-card blue"><div class="ach-ic">📅</div><div class="ach-v">${st.streak_total}</div><div class="ach-l">累计打卡(天)</div></div>
    </div>
    ${checkin}
    ${st.next_at?`<div class="lvl-progress"><div class="lp-bar"><span style="width:${Math.min(100,Math.round(st.points/st.next_at*100))}%"></span></div><div class="lp-txt">距下一段位还需 <b>${st.to_next}</b> 分</div></div>`:'<div class="lp-txt" style="text-align:center;margin-top:12px">已达最高段位 👑 宗师</div>'}
    <div class="notice" style="margin-top:10px">积分规则:答对单选 +2、判断 +1;每天做题即自动打卡。</div></div></div>
  ${heat}
  <div class="card"><div class="card-h">🏆 积分排行榜<span class="sub">全站 Top ${lb.top.length}</span></div><div class="card-b">
    ${lb.me.rank?'':`<div class="ai-intro">还未上榜。做题即可获得积分，当前 ${lb.me.points} 分。</div>`}
    <div class="lb">${rows||'<div class="empty">暂无排行数据。</div>'}</div></div></div>`;
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

function renderUpgrade(){
  const vipNow = IS_VIP ? '<div class="ci ci-done" style="margin-bottom:14px">👑 你已是 VIP 会员，全部讲义与增值内容已解锁。</div>' : '';
  C().innerHTML=`
  <div class="card"><div class="card-h">👑 开通 VIP · 解锁全套讲义与增值内容</div><div class="card-b">
    ${vipNow}
    <div class="plan-grid">
      <div class="plan">
        <div class="plan-t">免费版</div>
        <div class="plan-p">¥0</div>
        <ul class="plan-f">
          <li>✓ 一至八级全部历年真题、答案与<b>逐题解析，永久免费</b></li>
          <li>✓ 全部级别不限次数计时模考</li>
          <li>✓ 一级全部学习模块（讲义全书 / 陷阱手册 / 路线图 / 速查表 / 报考指南）</li>
          <li>✓ 二至八级讲义试读（前言 + 第 1 章）</li>
          <li>✓ 错题本 · 收藏 · 进度 · 排行榜 · 推荐练习</li>
        </ul>
      </div>
      <div class="plan hot">
        <div class="plan-badge">推荐</div>
        <div class="plan-t">VIP 会员</div>
        <div class="plan-p">¥199<span>/年</span></div>
        <div class="plan-sub">约 ¥39/月 · ¥99/季</div>
        <ul class="plan-f">
          <li>✓ 免费版全部功能</li>
          <li>✓ <b>二至八级《备考教程》讲义全书</b>，共 7 册电子教程，按考纲逐章讲解</li>
          <li>✓ 二至八级陷阱手册、路线图、速查表等模块，制作完成后随到随享</li>
          <li>✓ 自研模拟题库（建设中），上线后 VIP 直接使用</li>
          <li>✓ 问题反馈优先处理</li>
        </ul>
        <button class="btn solid" style="width:100%;margin-top:6px" onclick="howToVip()">立即开通 ›</button>
      </div>
    </div>
    <div class="notice" style="margin-top:14px">说明：本站全部真题、答案与解析对所有用户免费开放，不设任何门槛。VIP 收入仅用于支持自研内容（讲义、模拟题、学习工具）的持续制作。</div>
  </div></div>
  <div class="card"><div class="card-h">🎟️ 已有兑换码？</div><div class="card-b">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="redeem-code" placeholder="GESP-XXXX-XXXX-XXXX" style="flex:1;min-width:200px;padding:9px 11px;border:1px solid #e6e8ef;border-radius:8px;font-size:14px;text-transform:uppercase">
      <button class="btn solid" onclick="redeemCode()">立即兑换</button>
    </div>
    <div id="redeem-msg" class="notice" style="margin-top:10px;display:none"></div>
  </div></div>`;
  window.scrollTo(0,0);
}
function howToVip(){ toast('开通通道即将上线；当前可用兑换码开通，或通过页脚邮箱联系（支付宝/微信转账后为你手动开通）','ok'); }
async function redeemCode(){
  const code=(document.getElementById('redeem-code').value||'').trim();
  const m=document.getElementById('redeem-msg'); if(!code)return;
  try{
    const d=await api('/api/redeem',{method:'POST',body:JSON.stringify({code})});
    IS_VIP=true; updateVipUI();
    m.style.display='block'; m.style.color='#16a34a';
    m.textContent='🎉 兑换成功！VIP 已开通'+(d.vip_until?('，有效期至 '+d.vip_until.slice(0,10)):'（永久）')+'，二级至八级全部精解已解锁。';
    toast('VIP 已开通 👑'); setTimeout(()=>renderUpgrade(),1300);
  }catch(e){ m.style.display='block'; m.style.color='#dc2626'; m.textContent='兑换失败：'+e.message; }
}

/* ===================== 启动 ===================== */
document.getElementById('uname').textContent=USER;
var _uav=document.getElementById('uavatar'); if(_uav){ _uav.innerHTML=avHtml(AVATAR); _uav.classList.add('av-click'); _uav.title='点击更换头像'; _uav.onclick=openAvatarDlg; }
loadMe();
go('browse');
