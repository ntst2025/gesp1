'use strict';
/* ===== GESPPASS 管理后台 ===== */
const AT = () => localStorage.getItem('gesp_admin_token');
function show(which){ document.getElementById('login').style.display = which==='login'?'flex':'none'; document.getElementById('app').style.display = which==='app'?'block':'none'; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function short(id){ return String(id).split(':').pop(); }  // 'L1:c1'->'c1', 'L1:1.1'->'1.1'
function toast(m){ const t=document.createElement('div'); t.className='toast'; t.textContent=m; document.body.appendChild(t); setTimeout(()=>{t.style.transition='.3s';t.style.opacity='0';setTimeout(()=>t.remove(),300);},2200); }

async function aapi(path, opts={}){
  const r = await fetch(path, { ...opts, headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+AT(), ...(opts.headers||{}) } });
  if(r.status===401||r.status===403){ localStorage.removeItem('gesp_admin_token'); show('login'); throw new Error('请重新登录'); }
  const d = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||'请求失败');
  return d;
}

async function adminLogin(){
  const key=document.getElementById('lg-key').value; const e=document.getElementById('lg-err'); e.textContent='';
  try{
    const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
    const d=await r.json(); if(!r.ok){ e.textContent=d.error||'登录失败'; return; }
    localStorage.setItem('gesp_admin_token',d.token); show('app'); nav('dash');
  }catch(err){ e.textContent='网络错误,请稍后再试'; }
}
function adminLogout(){ localStorage.removeItem('gesp_admin_token'); show('login'); }

const V=()=>document.getElementById('view');
function nav(v){
  ['dash','q','u','c','b','r','t'].forEach(x=>{const el=document.getElementById('nav-'+x);if(el)el.classList.toggle('on',x===v);});
  const fn={dash:renderDash,q:renderQ,u:renderU,c:renderC,b:renderBaidu,r:renderReports,t:renderTeach,bk:renderBackup}[v];
  Promise.resolve(fn&&fn()).catch(e=>{ if(e&&e.message!=='请重新登录') toast(e.message); });
}

/* ---------- 概览 ---------- */
async function renderDash(){
  V().innerHTML='<div class="empty">加载中…</div>';
  const s=await aapi('/api/admin/stats'); const codes=s.codes||{};
  const lv=s.levels.map(l=>`<tr><td>${l.level} 级</td><td class="right">${l.count}</td><td class="right">${l.exp}</td><td class="right">${l.count?Math.round(l.exp/l.count*100):0}%</td></tr>`).join('');
  const recent=s.recent.map(u=>`<tr><td>${avatarHtml(u.avatar)} ${esc(u.username)} <span class="muted mono">#${u.id}</span></td><td><span class="pill ${u.tier==='vip'?'vip':'free'}">${u.tier==='vip'?'VIP':'免费'}</span></td><td class="muted">${(u.created_at||'').slice(0,16)}</td></tr>`).join('');
  V().innerHTML=`<h1 class="page-h">📊 概览</h1>
  <div class="stat-grid">
    <div class="stat"><div class="v">${s.users}</div><div class="l">注册用户</div></div>
    <div class="stat gold"><div class="v">${s.vip}</div><div class="l">VIP 会员</div></div>
    <div class="stat"><div class="v">${s.free}</div><div class="l">免费用户</div></div>
    <div class="stat brand"><div class="v">${s.attempts}</div><div class="l">累计答题</div></div>
    <div class="stat"><div class="v">${s.mocks}</div><div class="l">模考次数</div></div>
    <div class="stat"><div class="v">${codes.unused||0}</div><div class="l">未用兑换码</div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h">📚 题库覆盖</div>
    <table class="tbl"><thead><tr><th>级别</th><th class="right">题目</th><th class="right">已解析</th><th class="right">覆盖率</th></tr></thead><tbody>${lv}</tbody></table></div>
  <div class="card"><div class="card-h">🆕 最近注册</div><table class="tbl"><tbody>${recent||'<tr><td class="empty">暂无</td></tr>'}</tbody></table></div>`;
}

/* ---------- 题目管理 ---------- */
let QData=[];
async function renderQ(){
  V().innerHTML=`<h1 class="page-h">📚 题目管理</h1>
  <div class="toolbar">
    <select id="q-level" onchange="loadQ()"><option value="1">C++ 一级</option><option value="2">C++ 二级</option><option value="3">C++ 三级</option><option value="4">C++ 四级</option><option value="5">C++ 五级</option><option value="6">C++ 六级</option><option value="7">C++ 七级</option><option value="8">C++ 八级</option></select>
    <input id="q-search" placeholder="搜索 qid / 卷次 / 题号" oninput="filterQ()" style="flex:1;min-width:200px">
    <span class="muted" id="q-count"></span>
  </div>
  <div class="card" style="padding:6px"><div id="q-list"><div class="empty">加载中…</div></div></div>`;
  loadQ();
}
async function loadQ(){
  const lv=document.getElementById('q-level').value;
  document.getElementById('q-list').innerHTML='<div class="empty">加载中…</div>';
  const d=await aapi('/api/admin/questions?level='+lv); QData=d.questions; filterQ();
}
function filterQ(){
  const kw=(document.getElementById('q-search').value||'').toLowerCase().trim();
  const rows=QData.filter(q=>!kw||q.qid.toLowerCase().includes(kw)||(q.paper||'').toLowerCase().includes(kw)||String(q.num).includes(kw));
  document.getElementById('q-count').textContent='共 '+rows.length+' 题';
  document.getElementById('q-list').innerHTML=`<table class="tbl"><thead><tr><th>qid</th><th>类型</th><th>卷次 / 题号</th><th>答案</th><th>解析</th><th>状态</th><th></th></tr></thead><tbody>${
    rows.slice(0,400).map(q=>`<tr>
      <td class="mono">${esc(q.qid)}</td>
      <td><span class="pill ${q.type}">${q.type==='mc'?'单选':'判断'}</span></td>
      <td class="muted">${esc(q.paper)} · ${q.num}</td>
      <td class="mono">${esc(q.answer)}</td>
      <td>${q.has_exp?'<span style="color:var(--ok)">✓</span>':'<span style="color:#dc2626">✗ 缺</span>'}</td>
      <td>${q.overridden?'<span class="pill" style="background:#fff4f6;color:#c4560f">已改</span>':''}</td>
      <td class="right"><button class="btn sm" onclick="editQ('${q.qid}')">编辑</button></td>
    </tr>`).join('')}</tbody></table>${rows.length>400?'<div class="muted" style="padding:8px">仅显示前 400 条,请用搜索缩小范围</div>':''}`;
}
async function editQ(qid){
  const d=await aapi('/api/admin/question/'+encodeURIComponent(qid)); const q=d.question; const isMC=q.type==='mc';
  document.getElementById('dr-title').textContent='编辑 '+qid;
  const optHtml=isMC?['A','B','C','D'].map(k=>`<div class="opt-row"><span class="k">${k}</span><input id="o-${k}" value="${esc((q.options||{})[k]||'')}"></div>`).join(''):'<div class="muted">判断题无选项</div>';
  document.getElementById('dr-body').innerHTML=`
    <div class="fld"><label>题干</label><textarea id="f-stem" rows="3">${esc(q.stem)}</textarea></div>
    <div class="fld"><label>代码(可空)</label><textarea id="f-code" rows="4" class="mono">${esc(q.code)}</textarea></div>
    <div class="fld"><label>选项</label>${optHtml}</div>
    <div class="fld"><label>正确答案</label><input id="f-answer" value="${esc(q.answer)}" style="max-width:160px"></div>
    <div class="fld"><label>难度(1–5)</label><input id="f-diff" type="number" min="1" max="5" step="1" value="${q.difficulty||3}" style="max-width:120px"></div>
    <div class="fld"><label>解析 ⭐ 平台核心,请用心写</label><textarea id="f-exp" rows="8">${esc(q.explanation)}</textarea></div>`;
  document.getElementById('dr-foot').innerHTML=`
    <button class="btn solid" onclick="saveQ('${qid}',${isMC})">保存</button>
    <button class="btn danger" onclick="resetQ('${qid}')">重置为原始</button>
    <span class="muted" id="dr-msg" style="margin-left:auto"></span>`;
  openDrawer();
}
async function saveQ(qid,isMC){
  const body={ stem:val('f-stem'), code:val('f-code'), answer:val('f-answer').trim(), explanation:val('f-exp'), difficulty:Number(val('f-diff'))||3 };
  if(isMC){ const o={}; ['A','B','C','D'].forEach(k=>{const v=val('o-'+k);if(v!=='')o[k]=v;}); body.options=o; }
  try{ await aapi('/api/admin/question/'+encodeURIComponent(qid),{method:'PUT',body:JSON.stringify(body)}); toast('已保存 ✓'); closeDrawer(); loadQ(); }
  catch(e){ document.getElementById('dr-msg').textContent=e.message; }
}
async function resetQ(qid){
  if(!confirm('重置后将移除后台修改,下次内容更新(版本号变化)时恢复为原始题库内容。确定?'))return;
  await aapi('/api/admin/question/'+encodeURIComponent(qid)+'/reset',{method:'POST'}); toast('已重置'); closeDrawer(); loadQ();
}

/* ---------- 用户管理 ---------- */
let UData=[];
async function renderU(){
  V().innerHTML=`<h1 class="page-h">👥 用户管理</h1>
  <div class="toolbar"><input id="u-search" placeholder="搜索昵称" oninput="loadUDeb()" style="flex:1;min-width:200px"><span class="muted" id="u-count"></span></div>
  <div class="card" style="padding:6px"><div id="u-list"><div class="empty">加载中…</div></div></div>`;
  loadU();
}
let _udeb; function loadUDeb(){ clearTimeout(_udeb); _udeb=setTimeout(loadU,300); }
function findU(id){ return UData.find(x=>Number(x.id)===Number(id)); }
async function loadU(){
  const q=(document.getElementById('u-search')||{}).value||'';
  const d=await aapi('/api/admin/users?q='+encodeURIComponent(q)); UData=d.users;
  const vips=d.users.filter(u=>u.tier==='vip'&&(!u.vip_until||new Date(u.vip_until)>new Date())).length;
  const dis=d.users.filter(u=>u.disabled).length;
  document.getElementById('u-count').innerHTML='共 <b>'+d.users.length+'</b> 人 · VIP <b style="color:#c98a12">'+vips+'</b> · 停用 <b style="color:#c0392b">'+dis+'</b>';
  document.getElementById('u-list').innerHTML=`<table class="tbl utbl"><thead><tr><th>用户</th><th>会员</th><th>VIP 到期</th><th class="right">积分</th><th class="right">答题</th><th>注册</th><th>状态</th><th class="right">操作</th></tr></thead><tbody>${
    d.users.map(u=>{
      const vipOn=u.tier==='vip'&&(!u.vip_until||new Date(u.vip_until)>new Date());
      const until=u.vip_until?u.vip_until.slice(0,10):'永久';
      const days=u.vip_until?Math.ceil((new Date(u.vip_until)-new Date())/86400000):null;
      const av=avatarHtml(u.avatar);
      return `<tr class="${u.disabled?'u-off':''}">
        <td>${av} <b>${esc(u.username)}</b> <span class="muted mono">#${u.id}</span></td>
        <td><span class="pill ${vipOn?'vip':'free'}">${vipOn?'👑 VIP':'免费'}</span></td>
        <td class="muted">${vipOn?(u.vip_until?until+(days!=null?` <span class="mono" style="font-size:11px">剩${days}天</span>`:''):'永久'):'—'}</td>
        <td class="right mono">${u.points}</td><td class="right mono">${u.attempts}</td>
        <td class="muted mono" style="font-size:12px">${(u.created_at||'').slice(0,10)}</td>
        <td>${u.disabled?'<span class="pill off">已停用</span>':'<span class="pill ok">正常</span>'}</td>
        <td class="right u-acts">
          ${vipOn?`<button class="btn sm" onclick="grantVip(${u.id})">调整VIP</button><button class="btn sm gray" onclick="setTierById(${u.id},'free',0)">取消VIP</button>`:`<button class="btn sm solid" onclick="grantVip(${u.id})">开通VIP</button>`}
          ${u.disabled?`<button class="btn sm" onclick="toggleDisabled(${u.id},0)">恢复</button>`:`<button class="btn sm warn" onclick="toggleDisabled(${u.id},1)">停用</button>`}
          <button class="btn sm danger" onclick="delUser(${u.id})">删除</button>
        </td></tr>`;}).join('')||'<tr><td class="empty">无用户</td></tr>'}</tbody></table>`;
}
async function toggleDisabled(id,v){
  const u=findU(id); if(!u)return;
  if(v && !confirm('停用「'+u.username+'」?\n停用后该账号无法登录、无法使用任何功能,可随时恢复。'))return;
  try{ await aapi('/api/admin/users/'+id+'/disabled',{method:'POST',body:JSON.stringify({disabled:v})});
    toast(v?'已停用':'已恢复'); loadU();
  }catch(e){ toast(e.message); }
}
async function grantVip(id){ const u=findU(id); if(!u)return; const v=prompt('为「'+u.username+'」开通 VIP\n输入有效天数(留空或 0 = 永久):','365'); if(v===null)return; await setTierById(id,'vip',Number(v)||0); }
async function setTierById(id,tier,days){
  const u=findU(id); if(!u)return;
  try{ const d=await aapi('/api/admin/set-tier',{method:'POST',body:JSON.stringify({username:u.username,tier,days})});
    toast(tier==='vip'?('已开通 VIP '+(d.vip_until?'(至 '+d.vip_until.slice(0,10)+')':'(永久)')):'已取消 VIP'); loadU();
  }catch(e){ toast(e.message); }
}
async function delUser(id){
  const u=findU(id); if(!u)return;
  if(!confirm('确定删除用户「'+u.username+'」?\n其做题记录 / 错题本 / 收藏 / 模考成绩将一并删除,不可恢复!'))return;
  await aapi('/api/admin/users/'+id,{method:'DELETE'}); toast('已删除'); loadU();
}

/* ---------- 兑换码 ---------- */
async function renderC(){
  V().innerHTML=`<h1 class="page-h">🎟️ 兑换码</h1>
  <div class="card"><div class="card-h">批量生成</div>
    <div class="toolbar">
      <div><label class="muted" style="font-size:12px">数量</label><br><input id="c-qty" type="number" value="10" min="1" max="200" style="width:90px"></div>
      <div><label class="muted" style="font-size:12px">有效期(天,0=永久)</label><br><input id="c-days" type="number" value="365" min="0" style="width:140px"></div>
      <div style="min-width:140px"><label class="muted" style="font-size:12px">批次(可空)</label><br><input id="c-batch" placeholder="如 星球创始"></div>
      <div style="flex:1;min-width:170px"><label class="muted" style="font-size:12px">备注·发给谁(可空)</label><br><input id="c-note" placeholder="如 星球昵称:小明妈妈"></div>
      <div style="align-self:flex-end"><button class="btn solid" onclick="genCodes()">生成</button></div>
    </div>
    <div id="c-out"></div>
  </div>
  <div class="card" style="padding:6px"><div class="card-h" style="padding:12px 12px 0">已生成兑换码 <span class="sub" id="c-count"></span><button class="btn sm" style="float:right" onclick="exportCodes()">📥 导出 Excel</button></div><div id="c-list"><div class="empty">加载中…</div></div></div>`;
  loadCodes();
}
async function genCodes(){
  const qty=Number(document.getElementById('c-qty').value)||1, days=Number(document.getElementById('c-days').value)||0, batch=document.getElementById('c-batch').value, note=document.getElementById('c-note').value;
  const d=await aapi('/api/admin/codes',{method:'POST',body:JSON.stringify({qty,days,batch,note})});
  document.getElementById('c-out').innerHTML=`<div style="margin:6px 0 8px"><b>已生成 ${d.created} 个</b> · ${days>0?days+' 天':'永久'} <button class="btn sm" style="margin-left:10px" onclick="copyCodes()">复制全部</button></div><div class="code-out" id="c-codes">${d.codes.join('\n')}</div>`;
  toast('已生成 '+d.created+' 个兑换码'); loadCodes();
}
function copyCodes(){ const t=document.getElementById('c-codes'); if(!t)return; navigator.clipboard.writeText(t.textContent).then(()=>toast('已复制到剪贴板')).catch(()=>toast('复制失败,请手动选择')); }
let CODES_CACHE=[];
async function editNote(code,cur){
  const v=prompt('备注(发给谁):',cur||''); if(v===null)return;
  await aapi('/api/admin/codes/'+encodeURIComponent(code)+'/note',{method:'POST',body:JSON.stringify({note:v})});
  toast('备注已更新'); loadCodes();
}
function exportCodes(){
  if(!CODES_CACHE.length){ toast('暂无数据'); return; }
  const head=['兑换码','有效期(天,0=永久)','状态','使用者','使用时间','备注(发给谁)','批次','生成时间'];
  const st={unused:'未使用',used:'已使用',disabled:'已失效'};
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=CODES_CACHE.map(c=>[c.code,c.days,st[c.status]||c.status,c.used_name||'',(c.used_at||'').slice(0,16),c.note||'',c.batch||'',(c.created_at||'').slice(0,16)].map(q).join(','));
  const csv='\ufeff'+head.map(q).join(',')+'\n'+rows.join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const aEl=document.createElement('a');
  aEl.href=URL.createObjectURL(blob);
  const d=new Date(), pad=n=>String(n).padStart(2,'0');
  aEl.download='兑换码统计_'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'.csv';
  document.body.appendChild(aEl); aEl.click(); document.body.removeChild(aEl);
  URL.revokeObjectURL(aEl.href);
  toast('已导出 '+CODES_CACHE.length+' 条');
}
async function loadCodes(){
  const d=await aapi('/api/admin/codes');
  CODES_CACHE=d.codes||[];
  document.getElementById('c-count').textContent='共 '+d.codes.length+' 个';
  document.getElementById('c-list').innerHTML=`<table class="tbl"><thead><tr><th>兑换码</th><th>有效期</th><th>状态</th><th>使用者</th><th>备注(发给谁)</th><th>批次</th><th>生成时间</th><th></th></tr></thead><tbody>${
    d.codes.map(c=>`<tr>
      <td class="mono">${esc(c.code)}</td>
      <td>${c.days>0?c.days+' 天':'永久'}</td>
      <td><span class="pill ${c.status}">${c.status==='unused'?'未使用':c.status==='used'?'已使用':'已失效'}</span></td>
      <td class="muted">${c.used_name?esc(c.used_name):'—'}${c.used_at?'<br><span class="mono" style="font-size:11px">'+c.used_at.slice(0,16)+'</span>':''}</td>
      <td class="muted" style="cursor:pointer" title="点击修改备注" onclick="editNote('${c.code}','${esc(c.note||'').replace(/'/g,"\\'")}')">${c.note?esc(c.note):'<span style="opacity:.45">点击添加</span>'}</td>
      <td class="muted">${esc(c.batch||'')}</td>
      <td class="muted">${(c.created_at||'').slice(0,16)}</td>
      <td class="right">${c.status==='unused'?`<button class="btn sm danger" onclick="disableCode('${c.code}')">失效</button>`:''}</td>
    </tr>`).join('')||'<tr><td class="empty">还没有兑换码</td></tr>'}</tbody></table>`;
}
async function disableCode(code){ if(!confirm('使该兑换码失效?失效后不可再被使用。'))return; await aapi('/api/admin/codes/'+encodeURIComponent(code)+'/disable',{method:'POST'}); toast('已失效'); loadCodes(); }

/* ---------- 抽屉 / 工具 ---------- */
function openDrawer(){ document.getElementById('dmask').classList.add('open'); document.getElementById('drawer').classList.add('open'); }
function closeDrawer(){ document.getElementById('dmask').classList.remove('open'); document.getElementById('drawer').classList.remove('open'); }
function val(id){ const e=document.getElementById(id); return e?e.value:''; }

/* ---------- 启动 ---------- */
if(AT()){ show('app'); nav('dash'); } else { show('login'); }
document.getElementById('lg-key').addEventListener('keydown',e=>{ if(e.key==='Enter') adminLogin(); });


/* ---------- 百度推送 ---------- */
async function renderBaidu(){
  V().innerHTML='<div class="empty">加载中…</div>';
  let st; try{ st=await aapi('/api/admin/baidu/status'); }catch(e){ V().innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  V().innerHTML=`
  <div class="card"><div class="card-h">🔍 百度普通收录 · 主动推送<span class="sub">站点 ${st.site}</span></div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px">
      <div><b style="font-size:22px">${st.total}</b><div style="color:var(--muted);font-size:13px">URL 总数</div></div>
      <div><b style="font-size:22px;color:#13b083">${st.pushed}</b><div style="color:var(--muted);font-size:13px">已推送</div></div>
      <div><b style="font-size:22px;color:#ed9b1f">${st.pending}</b><div style="color:var(--muted);font-size:13px">待推送</div></div>
    </div>
    ${st.tokenSet?'':'<div class="err" style="display:block;margin-bottom:10px">⚠ 服务器未配置 BAIDU_TOKEN 环境变量,推送将失败。请在 Render → Environment 添加。</div>'}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      本次推送 <input id="bd-limit" type="number" value="100" min="1" max="2000" style="width:90px"> 条
      <button class="btn primary" id="bd-go" onclick="baiduPushNow()">立即推送</button>
    </div>
    <div style="color:var(--muted);font-size:13px;margin-top:10px;line-height:1.7">
      · 推送顺序:首页与栏目页 → 一级单题页(解析免费,SEO 价值最高) → 其余级别。<br>
      · 每日配额以百度站长平台显示为准;配额用尽时百度会返回 remain=0,次日再推即可。<br>
      · 已推送记录存数据库,重复点击不会重复占用配额。</div>
    <div id="bd-result" style="margin-top:12px"></div>
  </div>`;
}
async function baiduPushNow(){
  const btn=document.getElementById('bd-go'); btn.disabled=true; btn.textContent='推送中…';
  const out=document.getElementById('bd-result');
  try{
    const limit=Number(document.getElementById('bd-limit').value)||100;
    const d=await aapi('/api/admin/baidu/push',{method:'POST',body:JSON.stringify({limit})});
    out.innerHTML=`<div class="ok" style="display:block">✓ 提交 ${d.submitted} 条,百度接收 <b>${d.success}</b> 条`+
      (d.remain!=null?`,今日剩余配额 <b>${d.remain}</b>`:'')+
      (d.pending!=null?`;站内待推 ${d.pending} 条`:'')+
      ((d.not_same_site&&d.not_same_site.length)?`<br>⚠ ${d.not_same_site.length} 条因域名不一致被拒(检查 BAIDU_SITE_BASE)`:'')+
      `</div>`;
    renderBaidu();
  }catch(e){ out.innerHTML='<div class="err" style="display:block">✗ '+e.message+'</div>'; }
  finally{ btn.disabled=false; btn.textContent='立即推送'; }
}


/* ---------- 题目报错 ---------- */
async function renderReports(st){
  V().innerHTML='<div class="empty">加载中…</div>';
  let d; try{ d=await aapi('/api/admin/reports'+(st?'?status='+st:'')); }catch(e){ V().innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  const rows=(d.reports||[]).map(r=>`<tr>
    <td>#${r.id}</td>
    <td><a href="/q/${encodeURIComponent(r.qid)}" target="_blank" style="font-family:monospace">${r.qid}</a></td>
    <td style="max-width:380px">${(r.reason||'').replace(/</g,'&lt;')}</td>
    <td>${r.username||'-'}</td>
    <td>${(r.created_at||'').slice(0,16)}</td>
    <td>${r.status==='open'?'<span style="color:#ed9b1f">待处理</span>':'<span style="color:#13b083">已处理</span>'}</td>
    <td class="right">${r.status==='open'
      ?`<button class="btn sm" onclick="setReport(${r.id},'closed')">标记已处理</button>`
      :`<button class="btn sm ghost" onclick="setReport(${r.id},'open')">重新打开</button>`}</td>
  </tr>`).join('');
  V().innerHTML=`<div class="card"><div class="card-h">🐞 题目报错
    <span class="sub"><a onclick="renderReports()" style="cursor:pointer">全部</a> · <a onclick="renderReports('open')" style="cursor:pointer">待处理</a> · <a onclick="renderReports('closed')" style="cursor:pointer">已处理</a></span></div>
    <table class="tbl"><thead><tr><th>#</th><th>题目</th><th>反馈内容</th><th>用户</th><th>时间</th><th>状态</th><th></th></tr></thead>
    <tbody>${rows||'<tr><td colspan="7" class="empty">暂无反馈</td></tr>'}</tbody></table></div>`;
}
async function setReport(id,st){
  try{ await aapi('/api/admin/reports/'+id+'/status',{method:'POST',body:JSON.stringify({status:st})}); renderReports(); }
  catch(e){ toast(e.message); }
}


/* ---------- 💾 数据备份 ---------- */
async function renderBackup(){
  V().innerHTML='<h1 class="page-h">💾 数据备份</h1><div class="empty">加载中…</div>';
  let sum; try{ sum=await aapi('/api/admin/backup/summary'); }catch(e){ V().innerHTML='<h1 class="page-h">💾 数据备份</h1><div class="empty">'+e.message+'</div>'; return; }
  const tableNames={users:'用户账号',attempts:'答题记录',wrongbook:'错题本',bookmarks:'收藏',class_members:'班级成员',assignments:'作业/试卷',assignment_progress:'作业成绩',teacher_prog:'老师出的编程题',teacher_prog_tc:'编程题测试点',prog_submissions:'代码提交记录',question_reports:'题目报错',mock_results:'模考成绩',question_overrides:'题目订正',redeem_codes:'兑换码',baidu_push:'百度推送记录',meta:'系统配置'};
  const rows=sum.counts.filter(c=>c.rows>0).map(c=>`<tr><td>${tableNames[c.table]||c.table}</td><td class="right mono">${c.rows}</td></tr>`).join('');
  V().innerHTML=`<h1 class="page-h">💾 数据备份</h1>
    <div class="card"><div class="card-h">📥 备份数据（下载到你的电脑）</div><div class="card-b">
      <p class="muted" style="margin-bottom:10px">把所有用户数据（账号、做题记录、班级、作业、成绩等）打包成一个文件下载保存。<b>建议每周备份一次</b>，存到电脑或网盘。题库内容不需备份（代码里已有）。</p>
      <table class="tbl" style="max-width:420px"><thead><tr><th>数据类型</th><th class="right">当前数量</th></tr></thead><tbody>${rows||'<tr><td colspan="2" class="muted">暂无数据</td></tr>'}</tbody></table>
      <div style="margin-top:14px"><button class="btn solid" onclick="doBackup()">📥 立即下载备份</button>
      <span id="bk-msg" class="muted" style="margin-left:12px"></span></div>
    </div></div>
    <div class="card"><div class="card-h">📤 恢复数据（从备份文件还原）</div><div class="card-b">
      <div class="notice" style="background:#fef3f3;border-color:#f3c0c0;color:#c0392b;margin-bottom:12px">⚠️ <b>危险操作</b>：恢复会用备份文件<b>覆盖</b>当前所有用户数据，当前数据将被清空替换。请仅在数据出问题需要还原时使用，且操作前务必先下载一份当前备份。</div>
      <input type="file" id="bk-file" accept=".json" style="font-size:13px">
      <div style="margin-top:12px"><button class="btn" style="border-color:#c0392b;color:#c0392b" onclick="doRestore()">📤 从文件恢复</button>
      <span id="rs-msg" class="muted" style="margin-left:12px"></span></div>
    </div></div>`;
}
async function doBackup(){
  const msg=document.getElementById('bk-msg'); msg.textContent='正在生成备份…';
  try{
    const r=await fetch('/api/admin/backup',{headers:{'Authorization':'Bearer '+AT()}});
    if(!r.ok) throw new Error('备份失败 '+r.status);
    const blob=await r.blob();
    // 从响应头取文件名
    const cd=r.headers.get('Content-Disposition')||'';
    const m=cd.match(/filename="([^"]+)"/);
    const name=m?m[1]:('gesppass-backup-'+Date.now()+'.json');
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    msg.textContent='✅ 已下载 '+name+'（'+(blob.size/1024).toFixed(0)+' KB），请妥善保存';
  }catch(e){ msg.textContent='❌ '+e.message; }
}
async function doRestore(){
  const f=document.getElementById('bk-file').files[0];
  const msg=document.getElementById('rs-msg');
  if(!f){ msg.textContent='请先选择备份文件'; return; }
  if(!confirm('⚠️ 确定要恢复吗？\n这会清空当前所有用户数据，用备份文件替换！\n此操作不可撤销，请确认已备份当前数据。')) return;
  if(!confirm('再次确认：真的要覆盖当前数据吗？')) return;
  msg.textContent='正在读取文件…';
  try{
    const text=await f.text();
    const dump=JSON.parse(text);
    msg.textContent='正在恢复…';
    const r=await aapi('/api/admin/restore',{method:'POST',body:JSON.stringify({dump,confirm:'RESTORE'})});
    const total=Object.values(r.restored).reduce((a,b)=>a+b,0);
    msg.textContent='✅ 恢复完成，共还原 '+total+' 条记录';
    setTimeout(()=>renderBackup(),1500);
  }catch(e){ msg.textContent='❌ '+e.message; }
}

/* ---------- 🎓 授课管理 ---------- */
let TEACH_LV=1;
let TEACH_TAB='center';
async function renderTeach(lv,tab){
  TEACH_LV=lv||TEACH_LV;
  if(tab) TEACH_TAB=tab;
  V().innerHTML='<h1 class="page-h">🎓 授课管理</h1><div class="empty">加载中…</div>';
  let cls;
  try{ cls=(await aapi('/api/admin/classes')).classes; }catch(e){ V().innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  const lvTabs=cls.map(c=>`<span class="chip ${c.level===TEACH_LV?'on':''}" onclick="renderTeach(${c.level})">C++ ${c.level}级班 <b>${c.students}</b></span>`).join('');
  const subTabs=[['center','📤 布置中心'],['posted','📋 已布置'],['students','👥 班级学生']]
    .map(([k,label])=>`<a class="t-subtab ${TEACH_TAB===k?'on':''}" onclick="switchTeachTab('${k}')">${label}</a>`).join('');
  V().innerHTML=`<h1 class="page-h">🎓 授课管理</h1>
    <div class="lv-tabs">${lvTabs}</div>
    <div class="t-subtabs">${subTabs}</div>
    <div id="t-panel"><div class="empty">加载中…</div></div>`;
  renderTeachPanel();
}
function switchTeachTab(k){ TEACH_TAB=k; document.querySelectorAll('.t-subtab').forEach(e=>e.classList.toggle('on',e.textContent.includes(({center:'布置中心',posted:'已布置',students:'班级'})[k]))); renderTeachPanel(); }
async function renderTeachPanel(){
  const p=document.getElementById('t-panel'); if(!p)return;
  p.innerHTML='<div class="empty">加载中…</div>';
  if(TEACH_TAB==='center'||TEACH_TAB==='assign') return renderCenterPanel(p);
  if(TEACH_TAB==='students') return renderStudentsPanel(p);
  if(TEACH_TAB==='posted') return renderPostedPanel(p);
  if(TEACH_TAB==='progbank') return renderProgbankPanel(p);
  if(TEACH_TAB==='exam') return renderExamPanel(p);
}
// 布置中心:顶部选"发什么",下方展开对应表单
let CENTER_MODE='homework'; // homework|resource|exam|adapt
async function renderCenterPanel(p){
  const modes=[
    ['homework','📝 发作业','选题或按章节，给学生布置练习'],
    ['resource','📎 推送资源','把讲义章节推给学生自学'],
    ['exam','📋 发模拟卷','一键生成仿真考试卷'],
    ['adapt','🎲 改编练习','基于真题生成同类编程题'],
  ];
  const cards=modes.map(([k,t,d])=>`<div class="center-card ${CENTER_MODE===k?'on':''}" onclick="centerPick('${k}')">
    <div class="center-card-t">${t}</div><div class="center-card-d">${d}</div></div>`).join('');
  p.innerHTML=`<div class="center-cards">${cards}</div><div id="center-body"><div class="empty">加载中…</div></div>`;
  renderCenterBody();
}
function centerPick(m){ CENTER_MODE=m; document.querySelectorAll('.center-card').forEach((c,i)=>c.classList.toggle('on',['homework','resource','exam','adapt'][i]===m)); renderCenterBody(); }
async function renderCenterBody(){
  const body=document.getElementById('center-body'); if(!body)return;
  body.innerHTML='<div class="empty">加载中…</div>';
  if(CENTER_MODE==='homework'||CENTER_MODE==='resource') return renderAssignPanel(body, CENTER_MODE);
  if(CENTER_MODE==='exam') return renderExamPanel(body);
  if(CENTER_MODE==='adapt') return renderAdaptInline(body);
}

// —— 布置作业/推送资源(由布置中心调用,mode=homework|resource) ——
async function renderAssignPanel(p, mode){
  mode = mode || 'homework';
  let roster=[]; try{ roster=(await aapi('/api/admin/classes/'+TEACH_LV+'/roster')).roster; }catch(e){}
  TEACH_ROSTER=roster;
  const isHw = mode==='homework';
  p.innerHTML=`
    <div class="card"><div class="card-h">${isHw?'📝 布置作业':'📎 推送课程资源'} <span class="sub">C++ ${TEACH_LV}级班</span></div><div class="card-b">
      <input type="hidden" id="t-type" value="${mode}">
      <div class="form-grid">
        <div class="fg-row">
          <div class="fg-col grow"><label class="fl">标题</label><input id="t-title" placeholder="${isHw?'如:第3章 if 语句练习':'如:第3章 讲义'}"></div>
          ${isHw?'<div class="fg-col" id="t-due-wrap"><label class="fl">截止时间(可空)</label><input id="t-due" type="datetime-local"></div>':''}
        </div>
        <div class="fg-row"><div class="fg-col grow"><label class="fl">说明(给学生的话,可空)</label><textarea id="t-body" rows="2" placeholder="说明文字"></textarea></div></div>
        ${isHw?`<div id="t-hw-fields" class="fg-block">
          <label class="fl">题目内容</label>
          <div class="t-quick">
            <button class="btn solid" onclick="openChapterPicker()">📚 按真题章节布置</button>
            <button class="btn" onclick="openPicker()">＋ 浏览题库 / 逐题选 / 编程题</button>
          </div>
          <span class="muted" id="t-pick-summary" style="display:block;margin-top:8px;font-size:13px">未选题</span>
          <div id="t-picked" class="t-picked"></div>
        </div>`:`<div id="t-res-fields" class="fg-block">
          <label class="fl">勾选讲义章节(与网站同步,学生点开即看)</label>
          <div id="t-lesson-toc" class="t-toc">加载中…</div>
        </div>`}
        <div class="fg-block">
          <label class="fl">发给谁</label>
          <select id="t-target" onchange="teachTargetChange()"><option value="class">📢 全班</option><option value="some">👤 指定学生</option></select>
          <div id="t-target-list" style="display:none;margin-top:8px" class="t-toc"></div>
        </div>
        <div><button class="btn solid" onclick="postAssign()">发布</button></div>
      </div>
    </div></div>`;
  if(!isHw) loadLessonToc();
}

// —— 面板2:班级学生(含拉人进班) ——
async function renderStudentsPanel(p){
  let roster; try{ roster=(await aapi('/api/admin/classes/'+TEACH_LV+'/roster')).roster; }catch(e){ p.innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  TEACH_ROSTER=roster;
  const rows=roster.map(s=>`<tr><td class="clk" onclick="viewStudent(${s.id})">${avA(s.avatar)} <b>${esc(s.username)}</b> <span class="muted mono">#${s.id}</span></td>
    <td class="right mono">${s.attempts}</td><td class="right mono">${s.correct}</td>
    <td class="muted mono" style="font-size:12px">${(s.joined_at||'').slice(0,10)}</td>
    <td class="right"><button class="btn sm" onclick="viewStudent(${s.id})">学情</button> <button class="btn sm danger" onclick="removeStudent(${s.id},'${esc(s.username)}')">移出</button></td></tr>`).join('')||'<tr><td class="empty" colspan="5">该班暂无学生</td></tr>';
  p.innerHTML=`
    <div class="card"><div class="card-h">班级花名册 <span class="sub">C++ ${TEACH_LV}级 · ${roster.length} 人</span>
      <button class="btn sm solid" style="float:right" onclick="openAddStudent()">＋ 添加学生</button></div>
      <table class="tbl"><thead><tr><th>学生</th><th class="right">答题数</th><th class="right">答对</th><th>加入</th><th class="right">操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function openAddStudent(){
  let users; try{ users=(await aapi('/api/admin/users?limit=200')).users; }catch(e){ toast(e.message); return; }
  const inClass=new Set(TEACH_ROSTER.map(s=>s.id));
  const candidates=users.filter(u=>!inClass.has(u.id));
  if(!candidates.length){ toast('没有可添加的注册用户(都已在班里)'); return; }
  const rows=candidates.map(u=>`<label class="toc-item"><input type="checkbox" class="add-stu" value="${u.id}"> ${avA(u.avatar)} ${esc(u.username)} <span class="muted mono" style="font-size:11px">#${u.id}</span></label>`).join('');
  showModal(`<h3 style="margin:0 0 6px">添加学生到 C++ ${TEACH_LV}级班</h3>
    <div class="muted" style="font-size:13px;margin-bottom:10px">从注册用户里勾选,加入后他们在「我的课程」即可看到本班作业与资源。</div>
    <input id="add-search" placeholder="搜索昵称…" style="width:100%;margin-bottom:8px" oninput="filterAddStu(this.value)">
    <div class="t-toc" id="add-list" style="max-height:320px">${rows}</div>
    <div style="margin-top:14px;text-align:right"><button class="btn solid" onclick="confirmAddStudent()">加入所选</button></div>`);
}
function filterAddStu(q){
  q=q.toLowerCase();
  document.querySelectorAll('#add-list .toc-item').forEach(el=>{ el.style.display=el.textContent.toLowerCase().includes(q)?'flex':'none'; });
}
async function confirmAddStudent(){
  const ids=[...document.querySelectorAll('.add-stu:checked')].map(c=>Number(c.value));
  if(!ids.length){ toast('请勾选学生'); return; }
  try{ const r=await aapi('/api/admin/classes/'+TEACH_LV+'/add-student',{method:'POST',body:JSON.stringify({userIds:ids})});
    toast('已加入 '+r.added+' 名学生'); document.getElementById('adm-modal').remove(); renderTeach(TEACH_LV); }
  catch(e){ toast(e.message); }
}
async function removeStudent(uid,name){
  if(!confirm('把「'+name+'」移出本班?(其学习记录保留,只是不再属于本班)'))return;
  await aapi('/api/admin/classes/'+TEACH_LV+'/remove-student',{method:'POST',body:JSON.stringify({userId:uid})});
  toast('已移出'); renderStudentsPanel(document.getElementById('t-panel'));
}

// —— 面板3:已布置 ——
async function renderPostedPanel(p){
  let asg; try{ asg=(await aapi('/api/admin/classes/'+TEACH_LV+'/assignments')).assignments; }catch(e){ p.innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  const typeIcon={homework:'📝',resource:'📎',exam:'📝'};
  const typeName={homework:'作业',resource:'资源',exam:'模拟卷'};
  const rows=asg.map(a=>{
    const unpub = a.target==='none';
    const tag = a.type==='exam'?' <span class="pill" style="background:#fde8ec;color:#c0392b">模拟卷</span>':'';
    const pubTag = unpub?' <span class="pill" style="background:#fff3cd;color:#856404">未发布</span>':(a.target&&a.target!=='class'?' <span class="pill" style="background:#eef;color:#558">指定</span>':'');
    const pubBtn = unpub?`<button class="btn sm solid" onclick="publishAsg(${a.id})">发布</button> `:'';
    return `<tr>
      <td>${typeIcon[a.type]||'📄'} ${esc(a.title)}${tag}${pubTag}</td>
      <td>${typeName[a.type]||a.type}</td>
      <td class="muted">${a.due_at?a.due_at.slice(0,16).replace('T',' '):'—'}</td>
      <td class="right">${unpub?'<span class="muted">未发布</span>':(a.done+' 人完成'+(a.avg!=null?' · 均分 '+a.avg:''))}</td>
      <td class="right">${pubBtn}<button class="btn sm" onclick="viewAsgRoster(${a.id})">详情</button> <button class="btn sm danger" onclick="delAsg(${a.id})">删除</button></td>
    </tr>`;
  }).join('')||'<tr><td class="empty" colspan="5">该班暂无作业/资源/模拟卷</td></tr>';
  p.innerHTML=`<div class="card"><div class="card-h">已布置 <span class="sub">C++ ${TEACH_LV}级</span></div>
    <table class="tbl"><thead><tr><th>标题</th><th>类型</th><th>截止</th><th class="right">完成情况</th><th class="right">操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// —— 面板5:仿真模拟卷 ——
async function renderExamPanel(p){
  let ck; try{ ck=await aapi('/api/admin/exam/check?level='+TEACH_LV); }catch(e){ p.innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  const st=ck.struct;
  let roster=TEACH_ROSTER; if(!roster||!roster.length){ try{ roster=(await aapi('/api/admin/classes/'+TEACH_LV+'/roster')).roster; TEACH_ROSTER=roster; }catch(e){ roster=[]; } }
  const stuOpts=(roster||[]).map(s=>`<label class="toc-item"><input type="checkbox" class="exam-stu" value="${s.id}"> ${avA(s.avatar)} ${esc(s.username)}</label>`).join('')||'<span class="muted">该班暂无学生</span>';
  if(!ck.ready){
    p.innerHTML=`<div class="card"><div class="card-h">📝 仿真模拟卷 · C++ ${TEACH_LV}级</div><div class="card-b">
      <div class="empty"><div class="big">🚧</div>本级别题库弹药不足，暂时无法自动组卷。<br>
      <span style="font-size:13px;color:var(--ink3)">需要：${st.mc}道单选(现有${ck.bank_mc}) + ${st.tf}道判断(现有${ck.bank_tf}) + 编程改编方案(现有${ck.adapt_count})</span></div>
      </div></div>`;
    return;
  }
  p.innerHTML=`<div class="card"><div class="card-h">📝 一键生成仿真模拟卷 <span class="sub">C++ ${TEACH_LV}级</span></div><div class="card-b">
    <div class="exam-struct">
      <div class="exam-struct-t">📋 试卷结构（与真题一致）</div>
      <table class="tbl" style="margin-top:6px"><tbody>
        <tr><td>单选题</td><td class="right">${st.mc} 题 × ${st.mc_score} 分</td><td class="right mono">${st.mc*st.mc_score} 分</td></tr>
        <tr><td>判断题</td><td class="right">${st.tf} 题 × ${st.tf_score} 分</td><td class="right mono">${st.tf*st.tf_score} 分</td></tr>
        <tr><td>编程题</td><td class="right">${st.prog} 题 × ${st.prog_score} 分</td><td class="right mono">${st.prog*st.prog_score} 分</td></tr>
        <tr style="font-weight:700"><td>合计</td><td class="right">${st.duration_min} 分钟</td><td class="right mono">100 分</td></tr>
      </tbody></table>
      <div class="muted" style="font-size:12px;margin-top:8px">客观题从本级模拟题库随机抽取，编程题由真题改编自动生成。每套都不一样。</div>
    </div>
    <div class="fg-col" style="margin:14px 0">
      <label class="fl">生成几套？</label>
      <input id="exam-sets" type="number" value="1" min="1" max="5" style="width:90px"> <span class="muted" style="font-size:12px">(1~5 套，每套题目不同)</span>
    </div>
    <div class="fg-col" style="margin:14px 0">
      <label class="fl">发给谁？</label>
      <div style="margin-top:4px">
        <label class="radio-line"><input type="radio" name="exam-target" value="class" checked onchange="examToggleStu()"> 📢 全班</label>
        <label class="radio-line"><input type="radio" name="exam-target" value="some" onchange="examToggleStu()"> 👤 指定学生</label>
        <label class="radio-line"><input type="radio" name="exam-target" value="none" onchange="examToggleStu()"> 💾 只生成不发布</label>
      </div>
      <div id="exam-stu-box" class="t-toc" style="display:none;margin-top:8px">${stuOpts}</div>
    </div>
    <div class="fg-col" style="margin:14px 0">
      <label class="fl">试卷名称</label>
      <input id="exam-title" value="C++ ${TEACH_LV}级 仿真模拟卷" style="width:100%">
      <label class="fl" style="margin-top:8px">截止时间(可空)</label>
      <input id="exam-due" type="datetime-local" style="width:auto">
    </div>
    <div style="text-align:right"><button class="btn solid" onclick="examGenerate()">🎲 一键生成模拟卷</button></div>
    <div id="exam-result" style="margin-top:10px"></div>
  </div></div>`;
}
function examToggleStu(){
  const v=document.querySelector('input[name=exam-target]:checked').value;
  const box=document.getElementById('exam-stu-box');
  if(box) box.style.display = v==='some' ? 'block' : 'none';
}
async function examGenerate(){
  const sets=Math.max(1,Math.min(5,Number(document.getElementById('exam-sets').value)||1));
  const target=document.querySelector('input[name=exam-target]:checked').value;
  const out=document.getElementById('exam-result');
  const body={level:TEACH_LV,sets,title:document.getElementById('exam-title').value.trim()||undefined};
  const due=document.getElementById('exam-due').value; if(due) body.due_at=due;
  if(target==='some'){
    const ids=[...document.querySelectorAll('.exam-stu:checked')].map(c=>Number(c.value));
    if(!ids.length){ out.innerHTML='<span style="color:#c0392b">请至少选一个学生</span>'; return; }
    body.targetUsers=ids;
  } else if(target==='none'){ body.onlyStore=true; }
  out.innerHTML='<div class="muted">正在组卷('+sets+'套)，每套要生成2道编程题(编译标程+造数据)，约 '+(sets*20)+'~'+(sets*40)+' 秒，请稍候…</div>';
  try{
    const r=await aapi('/api/admin/exam/generate',{method:'POST',body:JSON.stringify(body)});
    out.innerHTML=`<span style="color:#1f9d57">✅ 成功生成 ${r.count} 套模拟卷！</span><br>
      <span style="font-size:13px;color:var(--ink2)">${target==='none'?'卷子已存入题库（未发给学生）。':'已发布，学生可在「我的课程 → 仿真模拟卷」开始考试。'}
      在「<a onclick="switchTeachTab('posted')" style="color:#185fa5;font-weight:700;cursor:pointer">📋 已布置</a>」可查看所有生成的模拟卷和学生完成情况。</span>`;
  }catch(e){ out.innerHTML='<span style="color:#c0392b;white-space:pre-wrap">❌ '+esc(e.message)+'</span>'; }
}
async function renderProgbankPanel(p){
  p.innerHTML=`<div class="card"><div class="card-h">💻 我出的编程题 <span class="sub">C++ ${TEACH_LV}级 · 布置作业时可选</span>
    <span style="float:right"><button class="btn sm" onclick="openAdaptPicker()">🎲 基于真题改编</button>
    <button class="btn sm solid" onclick="openProgMaker()">＋ 手动出题</button></span></div><div class="card-b">
    <div id="t-myprog">加载中…</div></div></div>`;
  loadMyProg();
}

function avatarHtml(av){
  av = String(av||'');
  if(/^a([1-9]|1[0-2])$/.test(av)) return `<img class="u-av" src="/avatars/${av}.svg">`;
  if(/^(data:image|https?:|\/)/.test(av)) return `<img class="u-av" src="${esc(av)}">`;  // 用户上传的图片
  if(av && av.length<=4) return `<span class="u-av-e">${av}</span>`;  // emoji
  return `<span class="u-av-e">🙂</span>`;  // 兜底,绝不平铺长串
}
function avA(av){ return avatarHtml(av); }
let TEACH_ROSTER=[];
let PICKED={mc:[],prog:[],ranges:[]};  // 已选题(ranges 可多个)
function teachTypeChange(){
  const t=document.getElementById('t-type').value;
  document.getElementById('t-hw-fields').style.display=t==='homework'?'block':'none';
  document.getElementById('t-res-fields').style.display=t==='resource'?'block':'none';
  document.getElementById('t-due-wrap').style.display=t==='homework'?'block':'none';
  if(t==='resource') loadLessonToc();
}
function teachTargetChange(){
  const v=document.getElementById('t-target').value;
  const box=document.getElementById('t-target-list');
  if(v==='some'){
    box.style.display='block';
    box.innerHTML=TEACH_ROSTER.length?TEACH_ROSTER.map(s=>`<label class="toc-item"><input type="checkbox" class="t-stu" value="${s.id}"> ${avA(s.avatar)} ${esc(s.username)}</label>`).join(''):'<span class="muted">该班暂无学生</span>';
  }else box.style.display='none';
}
/* ---- 按真题章节快捷布置(可多选累加) ---- */
async function openChapterPicker(){
  if(!PICKER_CAT||PICKER_CAT._lv!==TEACH_LV){
    try{ PICKER_CAT=await aapi('/api/admin/catalog?level='+TEACH_LV); PICKER_CAT._lv=TEACH_LV; }
    catch(e){ toast('该级别题库未就绪:'+e.message); return; }
  }
  const chs=PICKER_CAT.chapters.map(c=>{
    const cn=short(c.id).slice(1);
    const secs=(c.sections||[]).filter(s=>s.count>0).map(s=>
      `<button class="cp-sec" onclick="pickRange('section','${s.id}','${esc(s.name)}',${s.count})">${esc(s.name)} <span class="muted">${s.count}</span></button>`).join('');
    return `<div class="cp-ch">
      <div class="cp-ch-h"><b>第${cn}章 ${esc(c.name)}</b> <span class="muted">${c.count}题</span>
        <button class="btn sm solid" onclick="pickRange('chapter','${c.id}','第${cn}章 ${esc(c.name)}',${c.count})">布置整章</button></div>
      <div class="cp-secs">${secs}</div></div>`;
  }).join('');
  const papers=(PICKER_CAT.meta.papers||[]).map(p=>`<button class="cp-sec" onclick="pickRange('paper','${p}','${p} 整卷',0)">${p}</button>`).join('');
  showModal(`<h3 style="margin:0 0 6px">📚 按真题章节布置 · C++ ${TEACH_LV}级</h3>
    <div class="muted" style="font-size:13px;margin-bottom:10px">点「布置整章」或某个子节即加入(可连续点多个,累加);也可按整卷布置。选完关闭本窗即可。</div>
    <div id="cp-live" class="cp-live"></div>
    <div style="margin:10px 0 6px"><b style="font-size:13px">按整卷:</b> ${papers||'无'}</div>
    <div class="cp-list">${chs}</div>
    <div style="margin-top:14px;text-align:right"><button class="btn solid" onclick="document.getElementById('adm-modal').remove();renderPickedSummary()">完成</button></div>`);
  updateCpLive();
}
function updateCpLive(){
  const el=document.getElementById('cp-live'); if(!el)return;
  el.innerHTML=PICKED.ranges.length?('已选: '+PICKED.ranges.map((r,i)=>`<span class="pchip">${esc(r.name)} <span onclick="rmRange(${i});updateCpLive()">×</span></span>`).join('')):'<span class="muted">尚未选择,点下方章节添加</span>';
}
/* ---- 可视化选题器 ---- */
let PICKER_CAT=null;
async function openPicker(){
  if(!PICKER_CAT||PICKER_CAT._lv!==TEACH_LV){
    try{ PICKER_CAT=await aapi('/api/admin/catalog?level='+TEACH_LV); PICKER_CAT._lv=TEACH_LV; }
    catch(e){ toast('该级别题库未就绪:'+e.message); return; }
  }
  const chs=PICKER_CAT.chapters.map(c=>{
    const cn=short(c.id).slice(1);
    const secs=(c.sections||[]).filter(s=>s.count>0).map(s=>
      `<div class="pk-sec"><span>${esc(s.name)} <span class="muted">(${s.count})</span></span>
        <span><button class="btn sm" onclick="pickRange('section','${s.id}','${esc(s.name)}',${s.count})">选整节</button>
        <button class="btn sm" onclick="pickBrowse('${s.id}','${esc(s.name)}')">逐题选</button></span></div>`).join('');
    return `<div class="pk-ch"><div class="pk-ch-h">第${cn}章 ${esc(c.name)} <span class="muted">(${c.count}题)</span>
      <button class="btn sm" onclick="pickRange('chapter','${c.id}','第${cn}章 ${esc(c.name)}',${c.count})">选整章</button></div>${secs}</div>`;
  }).join('');
  const papers=(PICKER_CAT.meta.papers||[]).map(p=>`<button class="btn sm" onclick="pickRange('paper','${p}','${p} 整卷',0)">${p}</button>`).join(' ');
  // 教师自出编程题
  let myProgHtml = '';
  try {
    const tp = await aapi('/api/admin/teacher-prog?level='+TEACH_LV);
    if (tp.list.length) myProgHtml = '<div style="margin:10px 0"><b style="font-size:13px">我出的编程题:</b><br>' +
      tp.list.map(p=>`<label class="pk-q" style="display:inline-flex;margin:4px 6px 0 0"><input type="checkbox" class="pk-tprog" value="${p.pid}"> 💻 ${esc(p.title)}</label>`).join('') + '</div>';
  } catch(e){}
  showModal(`<h3 style="margin:0 0 10px">浏览题库选题 · C++ ${TEACH_LV}级</h3>
    <div class="muted" style="font-size:13px;margin-bottom:10px">「选整章/整节/整卷」一键纳入全部题;「逐题选」可挑单题。编程题在下方单独添加。</div>
    <div style="margin-bottom:10px"><b style="font-size:13px">按整卷:</b> ${papers||'<span class="muted">无</span>'}</div>
    <div class="pk-list">${chs}</div>
    ${myProgHtml}
    <div style="margin-top:12px"><b style="font-size:13px">真题编程题 pid(可选,逗号分隔):</b><br><input id="pk-prog" placeholder="如 ${TEACH_LV}-2023-03-prog-1" style="width:100%;margin-top:4px"></div>
    <div style="margin-top:14px;text-align:right"><button class="btn solid" onclick="confirmPicker()">确定选择</button></div>`);
}
function pickRange(kind,id,name,count){
  if(PICKED.ranges.some(r=>r.kind===kind&&r.id===id)){ toast('已在列表中'); return; }
  PICKED.ranges.push({kind,id,name,count});
  toast('已添加:'+name);
  renderPickedSummary(); updateCpLive();
}
async function pickBrowse(sid,name){
  let qs; try{ qs=(await aapi('/api/admin/sections/'+encodeURIComponent(sid)+'/questions')).questions; }catch(e){ toast(e.message); return; }
  const rows=qs.map((q,i)=>`<label class="pk-q"><input type="checkbox" class="pk-qchk" value="${q.qid}" ${PICKED.mc.includes(q.qid)?'checked':''}>
    <span class="qtype type-${q.type}">${q.type==='mc'?'单选':'判断'}</span> ${i+1}. ${esc((q.stem||'').replace(/<[^>]+>/g,'').slice(0,50))}…</label>`).join('');
  showModal(`<h3 style="margin:0 0 10px">${esc(name)} · 逐题选</h3><div class="pk-qlist">${rows}</div>
    <div style="margin-top:12px;text-align:right"><button class="btn" onclick="openPicker()">← 返回</button>
    <button class="btn solid" onclick="applyBrowsePick()">加入所选题</button></div>`);
}
function applyBrowsePick(){
  document.querySelectorAll('.pk-qchk:checked').forEach(c=>{ if(!PICKED.mc.includes(c.value)) PICKED.mc.push(c.value); });
  toast('已加入,共 '+PICKED.mc.length+' 道客观题'); openPicker();
}
function confirmPicker(){
  const prog=(document.getElementById('pk-prog')?document.getElementById('pk-prog').value:'').split(/[\s,，]+/).filter(Boolean);
  const tprog=[...document.querySelectorAll('.pk-tprog:checked')].map(c=>c.value);
  PICKED.prog=[...new Set([...prog,...tprog])];
  document.getElementById('adm-modal') && document.getElementById('adm-modal').remove();
  renderPickedSummary();
}
function renderPickedSummary(){
  const sm=document.getElementById('t-pick-summary'); const box=document.getElementById('t-picked');
  if(!sm)return;
  const parts=[];
  PICKED.ranges.forEach(r=>parts.push((r.kind==='chapter'?'整章':r.kind==='section'?'整节':'整卷')+'「'+r.name+'」'+(r.count?r.count+'题':'')));
  if(PICKED.mc.length) parts.push(PICKED.mc.length+' 道单选/判断');
  if(PICKED.prog.length) parts.push(PICKED.prog.length+' 道编程题');
  sm.textContent=parts.length?('已选: '+parts.join(' + ')):'未选题';
  const has=PICKED.mc.length||PICKED.prog.length||PICKED.ranges.length;
  box.innerHTML=has?`<div class="picked-chips">${PICKED.ranges.map((r,i)=>`<span class="pchip">${esc(r.name)} <span onclick="rmRange(${i})">×</span></span>`).join('')}</div><button class="btn sm gray" onclick="clearPicked()">清空已选</button>`:'';
}
function rmRange(i){ PICKED.ranges.splice(i,1); renderPickedSummary(); }
function clearPicked(){ PICKED={mc:[],prog:[],ranges:[]}; renderPickedSummary(); }
async function loadLessonToc(){
  const box=document.getElementById('t-lesson-toc'); if(!box) return;
  try{
    const d=await aapi('/api/admin/lessons-toc?level='+TEACH_LV);
    if(!d.chapters.length){ box.innerHTML='<span class="muted">本级别暂无讲义</span>'; return; }
    box.innerHTML=d.chapters.map(c=>`<label class="toc-item"><input type="checkbox" value="${c.id}" data-title="${esc(c.title)}"> ${esc(c.title)}</label>`).join('');
  }catch(e){ box.innerHTML='<span class="muted">'+e.message+'</span>'; }
}
async function postAssign(){
  const type=document.getElementById('t-type').value;
  const title=document.getElementById('t-title').value.trim();
  if(!title){ toast('请填写标题'); return; }
  const body=document.getElementById('t-body').value;
  const due=document.getElementById('t-due')?document.getElementById('t-due').value:'';
  let payload={};
  if(type==='homework'){
    if(!PICKED.mc.length && !PICKED.prog.length && !PICKED.ranges.length){ toast('请先选好题目(可按真题章节,或浏览题库选题)'); return; }
    payload={mc:PICKED.mc,prog:PICKED.prog,ranges:PICKED.ranges};
  }else{
    const chapters=[...document.querySelectorAll('#t-lesson-toc input:checked')].map(c=>({id:c.value,title:c.dataset.title}));
    if(!chapters.length && !body.trim()){ toast('请勾选讲义章节或填写资源说明'); return; }
    payload={level:TEACH_LV,chapters};
  }
  // 发给谁
  let targetUsers=null;
  if(document.getElementById('t-target').value==='some'){
    targetUsers=[...document.querySelectorAll('.t-stu:checked')].map(c=>Number(c.value));
    if(!targetUsers.length){ toast('请勾选至少一名学生'); return; }
  }
  try{
    const r=await aapi('/api/admin/classes/'+TEACH_LV+'/assign',{method:'POST',body:JSON.stringify({type,title,body,payload,due_at:due||null,targetUsers})});
    toast('已发布'+(targetUsers?'给 '+targetUsers.length+' 名学生':'给全班')+(r.count?(' · '+r.count+'题'):''));
    PICKED={mc:[],prog:[],ranges:[]}; renderTeach(TEACH_LV,"posted");
  }catch(e){ toast(e.message); }
}
async function loadMyProg(){
  const box=document.getElementById('t-myprog'); if(!box)return;
  try{
    const d=await aapi('/api/admin/teacher-prog?level='+TEACH_LV);
    if(!d.list.length){ box.innerHTML='<span class="muted">还没有自出的编程题</span>'; return; }
    box.innerHTML='<table class="tbl"><thead><tr><th>题目</th><th>时限</th><th>创建</th><th></th></tr></thead><tbody>'+
      d.list.map(p=>`<tr><td>💻 ${esc(p.title)} <span class="muted mono" style="font-size:11px">${p.pid}</span></td>
        <td class="mono">${p.time_limit}s</td><td class="muted mono" style="font-size:12px">${(p.created_at||'').slice(0,10)}</td>
        <td class="right"><button class="btn sm danger" onclick="delTeacherProg('${p.pid}')">删除</button></td></tr>`).join('')+'</tbody></table>';
  }catch(e){ box.innerHTML='<span class="muted">'+e.message+'</span>'; }
}
async function delTeacherProg(pid){
  if(!confirm('删除这道编程题?已布置的作业里它会失效。'))return;
  await aapi('/api/admin/teacher-prog/'+encodeURIComponent(pid),{method:'DELETE'}); toast('已删除'); loadMyProg();
}
let PM_SAMPLES=[];
// ===== 基于真题改编:批量生成同类题 + 推送 =====
let ADAPT_LIST=[];
// 改编练习内嵌面板(布置中心用)
async function renderAdaptInline(body){
  let d; try{ d=await aapi('/api/admin/adapt/list?level='+TEACH_LV); }catch(e){ body.innerHTML='<div class="empty">'+e.message+'</div>'; return; }
  ADAPT_LIST=d.list;
  let myprog=''; try{ const mp=await aapi('/api/admin/teacher-prog?level='+TEACH_LV); myprog=(mp.list||[]).length; }catch(e){}
  if(!d.list.length){
    body.innerHTML=`<div class="card"><div class="card-b">
      <div class="empty">C++ ${TEACH_LV}级 暂无改编方案。</div>
      <div style="text-align:center"><button class="btn solid" onclick="openProgMaker()">＋ 手动出一道编程题</button></div></div></div>`;
    return;
  }
  const rows=d.list.map((a,i)=>`<div class="adapt-row">
    <div class="adapt-info"><b>${esc(a.base_title)}</b> <span class="muted" style="font-size:12px">${a.variant_count}种题型</span>
      <div class="muted" style="font-size:12px">考点:${(a.kps||[]).join('、')||'—'}</div></div>
    <button class="btn sm solid" onclick="adaptConfig(${i})">生成 ›</button>
  </div>`).join('');
  body.innerHTML=`<div class="card"><div class="card-h">🎲 基于真题改编出题 <span class="sub">C++ ${TEACH_LV}级</span>
    <button class="btn sm" style="float:right" onclick="openProgMaker()">＋ 手动出题</button></div><div class="card-b">
    <div class="muted" style="font-size:13px;margin-bottom:12px">选一个考点，生成若干道同类型的新编程题，自动验证、带解析，可直接推送给学生。已出 ${myprog||0} 道。</div>
    <div class="adapt-list">${rows}</div>
  </div></div>`;
}
async function openAdaptPicker(){
  let d; try{ d=await aapi('/api/admin/adapt/list?level='+TEACH_LV); }catch(e){ toast(e.message); return; }
  ADAPT_LIST=d.list;
  if(!d.list.length){
    showModal(`<h3 style="margin:0 0 8px">🎲 基于真题改编出题</h3>
      <div class="muted" style="padding:20px 0">C++ ${TEACH_LV}级 暂无可改编的真题方案。</div>
      <div style="text-align:right"><button class="btn" onclick="document.getElementById('adm-modal').remove()">关闭</button></div>`);
    return;
  }
  const rows=d.list.map((a,i)=>`<div class="adapt-row">
    <div class="adapt-info"><b>${esc(a.base_title)}</b> <span class="muted" style="font-size:12px">${a.variant_count}种题型</span>
      <div class="muted" style="font-size:12px">考点:${(a.kps||[]).join('、')||'—'}</div>
      <div class="muted" style="font-size:11px;color:#9aa0b4">可生成:${(a.samples||[]).join(' / ')}</div></div>
    <button class="btn sm solid" onclick="adaptConfig(${i})">选它 ›</button>
  </div>`).join('');
  showModal(`<h3 style="margin:0 0 6px">🎲 基于真题改编 · 生成同类练习题(C++ ${TEACH_LV}级)</h3>
    <div class="muted" style="font-size:13px;margin-bottom:12px">选一个考点,系统会生成<b>若干道同类型的新题</b>(换场景、换数据),每道都已验证标程、带解析,可直接推送给学生练习。</div>
    <div class="adapt-list">${rows}</div>
    <div style="margin-top:14px;text-align:right"><button class="btn" onclick="document.getElementById('adm-modal').remove()">取消</button></div>`);
}
// 配置:生成几道 + 推送给谁
function adaptConfig(idx){
  const a=ADAPT_LIST[idx];
  const stuOpts=(TEACH_ROSTER||[]).map(s=>`<label class="toc-item"><input type="checkbox" class="adapt-stu" value="${s.id}"> ${avA(s.avatar)} ${esc(s.username)}</label>`).join('') || '<span class="muted">该班暂无学生</span>';
  showModal(`<h3 style="margin:0 0 6px">🎲 生成「${esc(a.base_title)}」同类练习</h3>
    <div class="adapt-tip">考点:${(a.kps||[]).join('、')}。系统将生成同类型新题,每道换了场景和数据。</div>
    <div class="fg-col" style="margin:12px 0">
      <label class="fl">生成几道?</label>
      <input id="adapt-count" type="number" value="3" min="1" max="10" style="width:100px">
      <span class="muted" style="font-size:12px">(1~10 道,题型相同、数据/场景不同)</span>
    </div>
    <div class="fg-col" style="margin:12px 0">
      <label class="fl">推送给谁?</label>
      <div style="margin-top:4px">
        <label class="radio-line"><input type="radio" name="adapt-target" value="class" checked onchange="adaptToggleStu()"> 📢 全班</label>
        <label class="radio-line"><input type="radio" name="adapt-target" value="some" onchange="adaptToggleStu()"> 👤 指定学生</label>
        <label class="radio-line"><input type="radio" name="adapt-target" value="none" onchange="adaptToggleStu()"> 💾 只存入题库,暂不推送</label>
      </div>
      <div id="adapt-stu-box" class="t-toc" style="display:none;margin-top:8px">${stuOpts}</div>
    </div>
    <div class="fg-col" style="margin:12px 0">
      <label class="fl">作业标题(推送时显示)</label>
      <input id="adapt-asgtitle" value="${esc(a.base_title)} · 同类练习" style="width:100%">
      <label class="fl" style="margin-top:8px">截止时间(可空)</label>
      <input id="adapt-due" type="datetime-local" style="width:auto">
    </div>
    <div style="margin-top:16px;text-align:right">
      <button class="btn" onclick="openAdaptPicker()">← 返回</button>
      <button class="btn solid" onclick="adaptGenerate('${a.base_pid}')">生成并推送</button></div>
    <div id="adapt-result" style="margin-top:10px"></div>`);
}
async function adaptToggleStu(){
  const v=document.querySelector('input[name=adapt-target]:checked').value;
  const box=document.getElementById('adapt-stu-box');
  if(!box) return;
  if(v==='some'){
    if(!TEACH_ROSTER || !TEACH_ROSTER.length){
      try{ const d=await aapi('/api/admin/classes/'+TEACH_LV+'/roster'); TEACH_ROSTER=d.roster||[]; }catch(e){}
      box.innerHTML=(TEACH_ROSTER||[]).map(s=>`<label class="toc-item"><input type="checkbox" class="adapt-stu" value="${s.id}"> ${avA(s.avatar)} ${esc(s.username)}</label>`).join('') || '<span class="muted">该班暂无学生</span>';
    }
    box.style.display='block';
  } else box.style.display='none';
}
async function adaptGenerate(basePid){
  const count=Math.max(1,Math.min(10,Number(document.getElementById('adapt-count').value)||1));
  const target=document.querySelector('input[name=adapt-target]:checked').value;
  const out=document.getElementById('adapt-result');
  let publish=null;
  if(target==='class'){ publish={target:'class'}; }
  else if(target==='some'){
    const ids=[...document.querySelectorAll('.adapt-stu:checked')].map(c=>Number(c.value));
    if(!ids.length){ out.innerHTML='<span style="color:#c0392b">请至少选一个学生</span>'; return; }
    publish={target:','+ids.join(',')+','};
  }
  if(publish){
    publish.title=document.getElementById('adapt-asgtitle').value.trim()||undefined;
    const due=document.getElementById('adapt-due').value;
    if(due) publish.due_at=due;
  }
  out.innerHTML='<div class="muted">正在生成 '+count+' 道题(每道都要编译标程、生成测试数据),约 '+(count*8)+'~'+(count*20)+' 秒,请稍候…</div>';
  try{
    const r=await aapi('/api/admin/adapt/generate',{method:'POST',body:JSON.stringify({level:TEACH_LV,base_pid:basePid,count,publish})});
    const names=r.created.map(c=>c.title).join('、');
    out.innerHTML=`<span style="color:#1f9d57">✅ 成功生成 ${r.created.length} 道:${esc(names)}。${r.published?'已推送给学生,可在「我的课程」看到。':'已存入题库。'}</span>`;
    setTimeout(()=>{ const m=document.getElementById('adm-modal'); if(m)m.remove(); loadMyProg(); }, 2200);
  }catch(e){ out.innerHTML='<span style="color:#c0392b;white-space:pre-wrap">❌ '+esc(e.message)+'</span>'; }
}
function openProgMaker(){
  PM_SAMPLES=[{in:'',out:''}];
  PM_SPEC=[];
  showModal(progMakerHtml());
}
function progMakerHtml(){
  const sampleRows=PM_SAMPLES.map((s,i)=>`<div class="pm-sample">
    <textarea class="pm-in" data-i="${i}" rows="2" placeholder="样例输入${i+1}">${esc(s.in)}</textarea>
    <textarea class="pm-out" data-i="${i}" rows="2" placeholder="对应正确输出${i+1}">${esc(s.out)}</textarea>
    ${PM_SAMPLES.length>1?`<button class="btn sm gray" onclick="pmDelSample(${i})">×</button>`:''}</div>`).join('');
  return `<h3 style="margin:0 0 6px">💻 出一道编程题(C++ ${TEACH_LV}级)</h3>
    <div class="muted" style="font-size:13px;margin-bottom:12px">你只需写一份<b>正确的参考程序</b>,系统会自动用它生成测试数据。建议至少填 1~2 个样例,系统会校验你的标程是否正确。</div>
    <label class="muted" style="font-size:12px">题目标题</label><br><input id="pm-title" placeholder="如:计算阶乘" style="width:100%;margin-bottom:10px">
    <label class="muted" style="font-size:12px">题干(题目描述、输入格式、输出格式)</label><br>
    <textarea id="pm-stmt" rows="5" style="width:100%;margin-bottom:10px" placeholder="描述题目。例:输入一个正整数 n(1≤n≤1000),输出 1 到 n 的和。"></textarea>
    <label class="muted" style="font-size:12px">参考程序(C++,必须正确,系统会编译验证)</label><br>
    <textarea id="pm-sol" rows="9" style="width:100%;margin-bottom:10px;font-family:monospace;font-size:13px" placeholder="#include <iostream>\nusing namespace std;\nint main(){ ... }"></textarea>
    <label class="muted" style="font-size:12px">时间限制(秒)</label><br><input id="pm-tl" type="number" value="1" min="1" max="5" style="width:90px;margin-bottom:12px"><br>
    <label class="muted" style="font-size:12px">输入格式配置(系统据此自动生成更多测试数据)</label>
    <div id="pm-spec" class="pm-spec">
      <div class="muted" style="font-size:12px;margin:6px 0">添加输入变量(按你题目读取的顺序):</div>
      <div id="pm-spec-list"></div>
      <button class="btn sm" onclick="pmAddSpec('int')">+ 整数变量</button>
      <button class="btn sm" onclick="pmAddSpec('array')">+ 数组(先读长度再读元素)</button>
    </div>
    <label class="muted" style="font-size:12px;display:block;margin-top:12px">样例(系统会用标程验证你填的输出是否正确)</label>
    <div id="pm-samples">${sampleRows}</div>
    <button class="btn sm" onclick="pmAddSample()" style="margin-top:6px">+ 加一个样例</button>
    <div style="margin-top:16px;text-align:right"><button class="btn solid" onclick="submitProgMaker()">验证标程并保存</button></div>
    <div id="pm-result" style="margin-top:10px"></div>`;
}
let PM_SPEC=[];
function pmAddSpec(kind){
  PM_SPEC.push(kind==='int'?{kind:'int',min:1,max:1000}:{kind:'array',len:{min:1,max:100},elem:{min:1,max:1000}});
  pmRenderSpec();
}
function pmRenderSpec(){
  const box=document.getElementById('pm-spec-list'); if(!box)return;
  box.innerHTML=PM_SPEC.map((v,i)=>v.kind==='int'
    ? `<div class="pm-spec-row">整数 ${i+1}: 范围 <input type="number" value="${v.min}" onchange="PM_SPEC[${i}].min=+this.value" style="width:80px"> ~ <input type="number" value="${v.max}" onchange="PM_SPEC[${i}].max=+this.value" style="width:90px"> <button class="btn sm gray" onclick="pmDelSpec(${i})">×</button></div>`
    : `<div class="pm-spec-row">数组 ${i+1}: 长度 <input type="number" value="${v.len.min}" onchange="PM_SPEC[${i}].len.min=+this.value" style="width:60px">~<input type="number" value="${v.len.max}" onchange="PM_SPEC[${i}].len.max=+this.value" style="width:70px">, 元素 <input type="number" value="${v.elem.min}" onchange="PM_SPEC[${i}].elem.min=+this.value" style="width:70px">~<input type="number" value="${v.elem.max}" onchange="PM_SPEC[${i}].elem.max=+this.value" style="width:80px"> <button class="btn sm gray" onclick="pmDelSpec(${i})">×</button></div>`
  ).join('');
}
function pmDelSpec(i){ PM_SPEC.splice(i,1); pmRenderSpec(); }
function pmCollectSamples(){
  const ins=[...document.querySelectorAll('.pm-in')], outs=[...document.querySelectorAll('.pm-out')];
  PM_SAMPLES=ins.map((el,i)=>({in:el.value.trim(),out:(outs[i]||{}).value.trim()})).filter(s=>s.in);
}
function pmAddSample(){ pmCollectSamples(); PM_SAMPLES.push({in:'',out:''}); document.getElementById('pm-samples').innerHTML=PM_SAMPLES.map((s,i)=>`<div class="pm-sample"><textarea class="pm-in" rows="2" placeholder="样例输入${i+1}">${esc(s.in)}</textarea><textarea class="pm-out" rows="2" placeholder="对应正确输出${i+1}">${esc(s.out)}</textarea>${PM_SAMPLES.length>1?`<button class="btn sm gray" onclick="pmDelSample(${i})">×</button>`:''}</div>`).join(''); }
function pmDelSample(i){ pmCollectSamples(); PM_SAMPLES.splice(i,1); if(!PM_SAMPLES.length)PM_SAMPLES=[{in:'',out:''}]; document.getElementById('pm-samples').innerHTML=PM_SAMPLES.map((s,j)=>`<div class="pm-sample"><textarea class="pm-in" rows="2" placeholder="样例输入${j+1}">${esc(s.in)}</textarea><textarea class="pm-out" rows="2" placeholder="对应正确输出${j+1}">${esc(s.out)}</textarea>${PM_SAMPLES.length>1?`<button class="btn sm gray" onclick="pmDelSample(${j})">×</button>`:''}</div>`).join(''); }
async function submitProgMaker(){
  pmCollectSamples();
  const title=document.getElementById('pm-title').value.trim();
  const statement=document.getElementById('pm-stmt').value.trim();
  const solution=document.getElementById('pm-sol').value.trim();
  const time_limit=Number(document.getElementById('pm-tl').value)||1;
  const out=document.getElementById('pm-result');
  if(!title||!statement||!solution){ out.innerHTML='<span style="color:#c0392b">标题、题干、参考程序都要填</span>'; return; }
  if(!PM_SPEC.length && !PM_SAMPLES.length){ out.innerHTML='<span style="color:#c0392b">请配置输入格式或至少填一个样例</span>'; return; }
  out.innerHTML='<div class="muted">正在编译验证标程并生成测试数据,请稍候(约 10~30 秒)…</div>';
  try{
    const r=await aapi('/api/admin/teacher-prog',{method:'POST',body:JSON.stringify({level:TEACH_LV,title,statement,solution,time_limit,inputSpec:PM_SPEC,samples:PM_SAMPLES})});
    out.innerHTML=`<span style="color:#1f9d57">✅ 已保存!生成了 ${r.testcases} 个测试点。现在可在「布置作业」时把它加入编程题。</span>`;
    PM_SPEC=[]; PM_SAMPLES=[{in:'',out:''}];
    setTimeout(()=>{ document.getElementById('adm-modal')&&document.getElementById('adm-modal').remove(); loadMyProg(); }, 1800);
  }catch(e){ out.innerHTML='<span style="color:#c0392b;white-space:pre-wrap">❌ '+esc(e.message)+'</span>'; }
}
async function loadWeakness(){
  const box=document.getElementById('t-weakness'); box.innerHTML='加载中…';
  try{
    const d=await aapi('/api/admin/classes/'+TEACH_LV+'/weakness');
    if(!d.weakness.length){ box.innerHTML='<span class="muted">暂无错题数据(学生还没开始练或没有错题)</span>'; return; }
    box.innerHTML='<table class="tbl"><thead><tr><th>章节</th><th class="right">累计错题</th><th class="right">涉及人数</th></tr></thead><tbody>'+
      d.weakness.map(w=>`<tr><td>${esc(w.name)}</td><td class="right mono">${w.wrong_total}</td><td class="right mono">${w.students}</td></tr>`).join('')+'</tbody></table>';
  }catch(e){ box.innerHTML='<span class="muted">'+e.message+'</span>'; }
}
async function publishAsg(id){
  let roster=TEACH_ROSTER; if(!roster||!roster.length){ try{ roster=(await aapi('/api/admin/classes/'+TEACH_LV+'/roster')).roster; TEACH_ROSTER=roster; }catch(e){ roster=[]; } }
  const stuOpts=(roster||[]).map(s=>`<label class="toc-item"><input type="checkbox" class="pub-stu" value="${s.id}"> ${avA(s.avatar)} ${esc(s.username)}</label>`).join('')||'<span class="muted">该班暂无学生</span>';
  showModal(`<h3 style="margin:0 0 10px">📤 发布给学生</h3>
    <div style="margin-bottom:10px">
      <label class="radio-line"><input type="radio" name="pub-target" value="class" checked onchange="pubToggle()"> 📢 全班</label>
      <label class="radio-line"><input type="radio" name="pub-target" value="some" onchange="pubToggle()"> 👤 指定学生</label></div>
    <div id="pub-stu-box" class="t-toc" style="display:none">${stuOpts}</div>
    <div style="margin-top:8px"><label class="fl">截止时间(可空)</label><input id="pub-due" type="datetime-local" style="width:auto"></div>
    <div style="margin-top:14px;text-align:right"><button class="btn" onclick="document.getElementById('adm-modal').remove()">取消</button>
      <button class="btn solid" onclick="doPublishAsg(${id})">确认发布</button></div>
    <div id="pub-msg" class="muted" style="margin-top:8px"></div>`);
}
function pubToggle(){ const v=document.querySelector('input[name=pub-target]:checked').value; const box=document.getElementById('pub-stu-box'); if(box) box.style.display=v==='some'?'block':'none'; }
async function doPublishAsg(id){
  const v=document.querySelector('input[name=pub-target]:checked').value;
  const body={}; const due=document.getElementById('pub-due').value; if(due) body.due_at=due;
  if(v==='some'){ const ids=[...document.querySelectorAll('.pub-stu:checked')].map(c=>Number(c.value)); if(!ids.length){ document.getElementById('pub-msg').textContent='请至少选一个学生'; return; } body.targetUsers=ids; }
  try{ await aapi('/api/admin/assignments/'+id+'/publish',{method:'POST',body:JSON.stringify(body)}); toast('已发布'); const m=document.getElementById('adm-modal'); if(m)m.remove(); renderTeachPanel(); }
  catch(e){ document.getElementById('pub-msg').textContent=e.message; }
}
async function delAsg(id){ if(!confirm('删除该作业/资源?学生端将不再显示。'))return; await aapi('/api/admin/assignments/'+id,{method:'DELETE'}); toast('已删除'); renderTeach(TEACH_LV); }
async function viewAsgRoster(id){
  let d; try{ d=await aapi('/api/admin/assignments/'+id+'/roster'); }catch(e){ toast(e.message); return; }
  CUR_ASG_ID=id;
  const rows=d.roster.map(s=>`<tr><td>${avA(s.avatar)} ${esc(s.username)}</td>
    <td>${s.status==='done'?'<span class="pill ok">已完成</span>':'<span class="pill off">未完成</span>'}</td>
    <td class="right mono">${s.score!=null?s.score+'分':'—'}</td>
    <td class="muted mono" style="font-size:12px">${(s.updated_at||'').slice(0,16).replace('T',' ')}</td>
    <td><button class="btn sm" onclick="writeComment(${id},${s.id},'${esc(s.username)}')">评语</button></td></tr>`).join('');
  showModal(`<h3 style="margin:0 0 12px">${esc(d.assignment.title)} · 完成情况</h3>
    <table class="tbl"><thead><tr><th>学生</th><th>状态</th><th class="right">得分</th><th>提交时间</th><th></th></tr></thead><tbody>${rows||'<tr><td class="empty">暂无学生</td></tr>'}</tbody></table>`);
}
let CUR_ASG_ID=null;
async function writeComment(aid,uid,name){
  const v=prompt('给「'+name+'」的评语:','');
  if(v===null)return;
  try{ await aapi('/api/admin/assignments/'+aid+'/comment',{method:'POST',body:JSON.stringify({user_id:uid,comment:v})}); toast('评语已保存'); }
  catch(e){ toast(e.message); }
}
async function viewStudent(uid){
  let d; try{ d=await aapi('/api/admin/students/'+uid+'?level='+TEACH_LV); }catch(e){ toast(e.message); return; }
  const o=d.overview;
  const chRows=d.chapters.map(c=>`<tr><td>${esc(c.name)}</td><td class="right mono">${c.mastered}/${c.total}</td>
    <td style="width:140px"><div class="mini-bar"><span style="width:${c.pct}%"></span></div></td>
    <td class="right mono">${c.pct}%</td></tr>`).join('')||'<tr><td class="empty">暂无数据</td></tr>';
  const asgRows=d.assignments.map(a=>`<tr><td>${a.type==='homework'?'📝':'📎'} ${esc(a.title)}</td>
    <td>${a.status==='done'?'<span class="pill ok">已完成</span>':'<span class="pill off">未做</span>'}</td>
    <td class="right mono">${a.score!=null?a.score+'分':'—'}</td></tr>`).join('')||'<tr><td class="empty">暂无作业</td></tr>';
  const recent=d.recent.slice(0,16).map(r=>`<span class="rec-dot ${r.correct?'ok':'no'}" title="${r.qid} ${r.correct?'✓':'✗'}">${r.correct?'✓':'✗'}</span>`).join('');
  showModal(`<h3 style="margin:0 0 4px">${avA(d.student.avatar)} ${esc(d.student.username)} 的学情 <span class="muted" style="font-size:13px">· C++ ${d.level}级</span></h3>
    <div class="muted" style="font-size:12px;margin-bottom:14px">注册 ${(d.student.created_at||'').slice(0,10)} · ${d.student.vip?'👑 VIP':'免费用户'} · 最近活跃 ${(o.last_active||'—').slice(0,10)}</div>
    <div class="stat-row">
      <div class="stat-box"><div class="sv">${o.attempts}</div><div class="sl">总答题</div></div>
      <div class="stat-box"><div class="sv">${o.accuracy}%</div><div class="sl">正确率</div></div>
      <div class="stat-box"><div class="sv">${o.distinct_q}</div><div class="sl">做过题数</div></div>
      <div class="stat-box"><div class="sv">${o.prog_ac}</div><div class="sl">编程AC</div></div>
    </div>
    <h4 class="mh">各章掌握度</h4>
    <table class="tbl"><thead><tr><th>章节</th><th class="right">掌握/总</th><th>进度</th><th class="right">%</th></tr></thead><tbody>${chRows}</tbody></table>
    <h4 class="mh">作业完成情况</h4>
    <table class="tbl"><thead><tr><th>作业/资源</th><th>状态</th><th class="right">得分</th></tr></thead><tbody>${asgRows}</tbody></table>
    <h4 class="mh">最近答题(新→旧)</h4><div class="rec-row">${recent||'<span class="muted">暂无</span>'}</div>
    <h4 class="mh">针对性教学</h4>
    <div class="t-ops">
      <button class="btn sm" onclick="viewWrongbook(${d.student.id},${d.level})">查看错题清单</button>
      <button class="btn sm solid" onclick="genPersonalized(${d.student.id},${d.level})">生成个性化练习</button>
      <button class="btn sm" onclick="genRedo(${d.student.id},${d.level})">布置错题重做</button>
    </div>
    <div id="t-wrongbox"></div>`);
}
async function viewWrongbook(uid,level){
  const box=document.getElementById('t-wrongbox'); box.innerHTML='<div class="muted">加载中…</div>';
  try{
    const d=await aapi('/api/admin/students/'+uid+'/wrongbook?level='+level);
    if(!d.total){ box.innerHTML='<div class="muted" style="margin-top:8px">该生暂无错题 🎉</div>'; return; }
    box.innerHTML=`<div class="wrong-sum">共 ${d.total} 道错题,分布在 ${d.byChapter.length} 个章节:</div>`+
      '<table class="tbl"><thead><tr><th>章节</th><th class="right">错题数</th></tr></thead><tbody>'+
      d.byChapter.map(c=>`<tr><td>${esc(c.name)}</td><td class="right mono">${c.count}</td></tr>`).join('')+'</tbody></table>';
  }catch(e){ box.innerHTML='<div class="muted">'+e.message+'</div>'; }
}
async function genPersonalized(uid,level){
  if(!confirm('根据该生错题所在的薄弱章节,自动抽一组同类新题,作为个性化练习发给他。继续?'))return;
  try{
    const r=await aapi('/api/admin/students/'+uid+'/personalized',{method:'POST',body:JSON.stringify({level,count:10})});
    toast('已生成 '+r.count+' 题的个性化练习,来自 '+r.chapters+' 个薄弱章节,已发给该生');
  }catch(e){ toast(e.message); }
}
async function genRedo(uid,level){
  if(!confirm('把该生的全部错题打包成「错题重做」作业发给他?'))return;
  try{
    const r=await aapi('/api/admin/students/'+uid+'/redo-wrong',{method:'POST',body:JSON.stringify({level})});
    toast('已布置错题重做,共 '+r.count+' 题');
  }catch(e){ toast(e.message); }
}
function showModal(html){
  let m=document.getElementById('adm-modal');
  if(!m){ m=document.createElement('div'); m.id='adm-modal'; m.className='adm-modal-mask'; document.body.appendChild(m); }
  m.innerHTML=`<div class="adm-modal"><span class="adm-x" onclick="document.getElementById('adm-modal').remove()">×</span>${html}</div>`;
  m.onclick=e=>{ if(e.target===m) m.remove(); };
}
