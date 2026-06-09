'use strict';
/**
 * 手动强制重建"题库内容表"(级别/章/节/题)并把内容版本号同步为 levels.json 里的 version。
 * 用户数据(账号 users / 答题 attempts / 错题本 wrongbook / 收藏 bookmarks)不受影响。
 *
 * 用法:
 *   本地:            node scripts/reseed.js
 *   对 Turso 云:     先设好 TURSO_DATABASE_URL 与 TURSO_AUTH_TOKEN 再运行(见 README)
 *
 * 说明:平台启动时本就会在"内容版本变化"时自动重载,本脚本仅用于强制立即重载。
 */
const fs = require('fs');
const path = require('path');
const { reseedAll, client } = require('../src/db');

(async () => {
  const n = await reseedAll();
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'levels.json'), 'utf-8'));
  const ver = String(m.version || 1);
  await client.execute({ sql: "INSERT OR REPLACE INTO meta(k,v) VALUES('content_version',?)", args: [ver] });
  console.log(`✅ 内容已重建:${n} 题;内容版本 = ${ver}(用户数据保留)`);
  process.exit(0);
})().catch(e => { console.error('❌ reseed 失败:', e); process.exit(1); });
