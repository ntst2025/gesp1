'use strict';
/* ===== GESPPASS 管理后台 ===== */
const AT = () => localStorage.getItem('gesp_admin_token');
function show(which){ document.getElementById('login').style.display = which==='login'?'flex':'none'; document.getElementById('app').style.display = which==='app'?'block':'none'; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
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
  ['dash','q','u','c','b'].forEach(x=>{const el=document.getElementById('nav-'+x);if(el)el.classList.toggle('on',x===v);});
  const fn={dash:renderDash,q:renderQ,u:renderU,c:renderC,b:renderBaidu}[v];
  Promise.resolve(fn&&fn()).catch(e=>{ if(e&&e.message!=='请重新登录') toast(e.message); });
}

/* ---------- 概览 ---------- */
async function renderDash(){
  V().innerHTML='<div class="empty">加载中…</div>';
  const s=await aapi('/api/admin/stats'); const codes=s.codes||{};
  const lv=s.levels.map(l=>`<tr><td>${l.level} 级</td><td class="right">${l.count}</td><td class="right">${l.exp}</td><td class="right">${l.count?Math.round(l.exp/l.count*100):0}%</td></tr>`).join('');
  const recent=s.recent.map(u=>`<tr><td>${u.avatar||'🙂'} ${esc(u.username)} <span class="muted mono">#${u.id}</span></td><td><span class="pill ${u.tier==='vip'?'vip':'free'}">${u.tier==='vip'?'VIP':'免费'}</span></td><td class="muted">${(u.created_at||'').slice(0,16)}</td></tr>`).join('');
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
  document.getElementById('u-count').textContent='共 '+d.users.length+' 人';
  document.getElementById('u-list').innerHTML=`<table class="tbl"><thead><tr><th>用户</th><th>会员</th><th>到期</th><th class="right">积分</th><th class="right">答题</th><th>注册</th><th></th></tr></thead><tbody>${
    d.users.map(u=>{
      const vipOn=u.tier==='vip'&&(!u.vip_until||new Date(u.vip_until)>new Date());
      const until=u.vip_until?u.vip_until.slice(0,10):'永久';
      return `<tr>
        <td>${u.avatar||'🙂'} ${esc(u.username)} <span class="muted mono">#${u.id}</span></td>
        <td><span class="pill ${vipOn?'vip':'free'}">${vipOn?'VIP':'免费'}</span></td>
        <td class="muted">${vipOn?until:'—'}</td>
        <td class="right">${u.points}</td><td class="right">${u.attempts}</td>
        <td class="muted">${(u.created_at||'').slice(0,10)}</td>
        <td class="right">
          ${vipOn?`<button class="btn sm" onclick="setTierById(${u.id},'free',0)">取消VIP</button>`:`<button class="btn sm" onclick="grantVip(${u.id})">开通VIP</button>`}
          <button class="btn sm danger" onclick="delUser(${u.id})">删除</button>
        </td></tr>`;}).join('')||'<tr><td class="empty">无用户</td></tr>'}</tbody></table>`;
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
      <div style="flex:1;min-width:160px"><label class="muted" style="font-size:12px">批次备注(可空)</label><br><input id="c-batch" placeholder="如 2026春-淘宝"></div>
      <div style="align-self:flex-end"><button class="btn solid" onclick="genCodes()">生成</button></div>
    </div>
    <div id="c-out"></div>
  </div>
  <div class="card" style="padding:6px"><div class="card-h" style="padding:12px 12px 0">已生成兑换码 <span class="sub" id="c-count"></span></div><div id="c-list"><div class="empty">加载中…</div></div></div>`;
  loadCodes();
}
async function genCodes(){
  const qty=Number(document.getElementById('c-qty').value)||1, days=Number(document.getElementById('c-days').value)||0, batch=document.getElementById('c-batch').value;
  const d=await aapi('/api/admin/codes',{method:'POST',body:JSON.stringify({qty,days,batch})});
  document.getElementById('c-out').innerHTML=`<div style="margin:6px 0 8px"><b>已生成 ${d.created} 个</b> · ${days>0?days+' 天':'永久'} <button class="btn sm" style="margin-left:10px" onclick="copyCodes()">复制全部</button></div><div class="code-out" id="c-codes">${d.codes.join('\n')}</div>`;
  toast('已生成 '+d.created+' 个兑换码'); loadCodes();
}
function copyCodes(){ const t=document.getElementById('c-codes'); if(!t)return; navigator.clipboard.writeText(t.textContent).then(()=>toast('已复制到剪贴板')).catch(()=>toast('复制失败,请手动选择')); }
async function loadCodes(){
  const d=await aapi('/api/admin/codes');
  document.getElementById('c-count').textContent='共 '+d.codes.length+' 个';
  document.getElementById('c-list').innerHTML=`<table class="tbl"><thead><tr><th>兑换码</th><th>有效期</th><th>状态</th><th>使用者</th><th>批次</th><th>生成时间</th><th></th></tr></thead><tbody>${
    d.codes.map(c=>`<tr>
      <td class="mono">${esc(c.code)}</td>
      <td>${c.days>0?c.days+' 天':'永久'}</td>
      <td><span class="pill ${c.status}">${c.status==='unused'?'未使用':c.status==='used'?'已使用':'已失效'}</span></td>
      <td class="muted">${c.used_name?esc(c.used_name):'—'}${c.used_at?'<br><span class="mono" style="font-size:11px">'+c.used_at.slice(0,16)+'</span>':''}</td>
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
  let st; try{ st=await api('/api/admin/baidu/status'); }catch(e){ V().innerHTML='<div class="empty">'+e.message+'</div>'; return; }
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
    const d=await api('/api/admin/baidu/push',{method:'POST',body:JSON.stringify({limit})});
    out.innerHTML=`<div class="ok" style="display:block">✓ 提交 ${d.submitted} 条,百度接收 <b>${d.success}</b> 条`+
      (d.remain!=null?`,今日剩余配额 <b>${d.remain}</b>`:'')+
      (d.pending!=null?`;站内待推 ${d.pending} 条`:'')+
      ((d.not_same_site&&d.not_same_site.length)?`<br>⚠ ${d.not_same_site.length} 条因域名不一致被拒(检查 BAIDU_SITE_BASE)`:'')+
      `</div>`;
    renderBaidu();
  }catch(e){ out.innerHTML='<div class="err" style="display:block">✗ '+e.message+'</div>'; }
  finally{ btn.disabled=false; btn.textContent='立即推送'; }
}
