'use strict';
/*
 * Baidu URL push (主动推送) — submit all site URLs to Baidu for faster crawling.
 *
 * What it does:
 *   1. Fetches <SITE_BASE>/sitemap.xml and extracts every <loc> URL (12 static + 2300 question pages).
 *   2. Splits them into batches of <=2000 (Baidu's per-request limit).
 *   3. POSTs each batch to Baidu's push API and prints the result.
 *
 * Get your token at: https://ziyuan.baidu.com  ->  add & verify site  ->
 *   搜索服务 / 站点资源 / 普通收录 / API提交  ->  copy the token after "token="
 *
 * Run (Node 18+, no dependencies needed):
 *   BAIDU_SITE=gesppass.com BAIDU_TOKEN=你的token node scripts/baidu-push.js
 *
 * Optional env:
 *   SITE_BASE   full origin used to fetch sitemap & build URLs (default https://<BAIDU_SITE>)
 *   PUSH_TYPE   "daily" to use the 快速收录 channel (only if you have that permission); default normal
 *   DRY_RUN     "1" to only print what would be pushed, without calling Baidu
 */

const SITE = process.env.BAIDU_SITE || '';
const TOKEN = process.env.BAIDU_TOKEN || '';
const SITE_BASE = (process.env.SITE_BASE || (SITE ? 'https://' + SITE : '')).replace(/\/+$/, '');
const PUSH_TYPE = process.env.PUSH_TYPE || '';
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH = 2000;

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

if (!SITE) die('缺少 BAIDU_SITE（你在百度验证的域名，如 gesppass.com）');
if (!TOKEN && !DRY_RUN) die('缺少 BAIDU_TOKEN（百度 API 提交里 token= 后面那串）');
if (!SITE_BASE) die('缺少 SITE_BASE（站点完整地址，如 https://gesppass.com）');
if (typeof fetch !== 'function') die('需要 Node 18 及以上版本（内置 fetch）。请升级 Node 后再运行。');

async function getSitemapUrls() {
  const sm = `${SITE_BASE}/sitemap.xml`;
  console.log(`· 读取 sitemap: ${sm}`);
  const res = await fetch(sm, { headers: { 'User-Agent': 'gesppass-baidu-push/1.0' } });
  if (!res.ok) die(`抓取 sitemap 失败，HTTP ${res.status}。先确认站点已上线、sitemap.xml 可访问。`);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].trim());
  if (!urls.length) die('sitemap 里没解析到任何 URL。');
  return urls;
}

async function pushBatch(urls, idx, totalBatches) {
  let api = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(SITE)}&token=${encodeURIComponent(TOKEN)}`;
  if (PUSH_TYPE === 'daily') api += '&type=daily';
  const body = urls.join('\n');
  if (DRY_RUN) {
    console.log(`  [试运行] 第 ${idx}/${totalBatches} 批：${urls.length} 条（未真正提交）`);
    return;
  }
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = null; }
  if (!data) {
    console.log(`  第 ${idx}/${totalBatches} 批：HTTP ${res.status}，返回：${text.slice(0, 300)}`);
    return;
  }
  // Baidu returns: { success, remain, not_same_site:[], not_valid:[], error?, message? }
  if (data.error) {
    console.log(`  ✗ 第 ${idx}/${totalBatches} 批失败：${data.error} - ${data.message || ''}`);
  } else {
    const ns = (data.not_same_site || []).length;
    const nv = (data.not_valid || []).length;
    console.log(`  ✓ 第 ${idx}/${totalBatches} 批：成功 ${data.success} 条，今日剩余配额 ${data.remain}` +
      (ns ? `，非本站 ${ns} 条` : '') + (nv ? `，无效 ${nv} 条` : ''));
  }
}

(async () => {
  console.log(`=== 百度主动推送 ===\n站点：${SITE}\n来源：${SITE_BASE}/sitemap.xml` + (PUSH_TYPE === 'daily' ? '\n通道：快速收录(daily)' : '\n通道：普通收录') + (DRY_RUN ? '\n模式：试运行(不提交)' : ''));
  const urls = await getSitemapUrls();
  console.log(`· 共 ${urls.length} 条 URL，分 ${Math.ceil(urls.length / BATCH)} 批推送（每批 ≤ ${BATCH}）\n`);
  const batches = [];
  for (let i = 0; i < urls.length; i += BATCH) batches.push(urls.slice(i, i + BATCH));
  for (let i = 0; i < batches.length; i++) {
    await pushBatch(batches[i], i + 1, batches.length);
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 800)); // be polite
  }
  console.log('\n完成。提示：推送≠收录，是否收录由百度判断；无备案海外站收录通常较慢，可配合必应/谷歌与直接访问。');
})().catch(e => die('运行出错：' + (e && e.message ? e.message : e)));
