'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Q } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
if (JWT_SECRET === 'dev-insecure-secret-change-me') {
  console.warn('[auth] ⚠ 使用默认 JWT_SECRET,生产环境务必在环境变量中设置随机值!');
}

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function register({ username, email, password, avatar }) {
  username = (username || '').trim();
  if (username.length < 2 || username.length > 24) throw httpErr(400, '昵称需 2–24 个字符（支持中文）');
  if (!password || password.length < 6) throw httpErr(400, '密码至少 6 位');
  avatar = (avatar || '').trim();
  // 允许:预设图标 id(a1-a12) / 短 emoji;默认随机一个预设
  if (!/^a([1-9]|1[0-2])$/.test(avatar) && avatar.length > 8) avatar = '';
  if (!avatar) avatar = 'a' + (1 + Math.floor(Math.random() * 12));
  if (await Q.userByName(username)) throw httpErr(409, '该昵称已被使用,换一个吧');
  const hash = bcrypt.hashSync(password, 10);
  let info;
  try {
    info = await Q.createUser(username, email || null, hash, avatar);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw httpErr(409, '昵称或邮箱已被使用');
    throw e;
  }
  const user = { id: Number(info.lastInsertRowid), username, avatar };
  return { token: signToken(user), user: { id: user.id, username, avatar } };
}

async function login({ username, password }) {
  const row = await Q.userByName((username || '').trim());
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    throw httpErr(401, '用户名或密码错误');
  }
  return { token: signToken(row), user: { id: row.id, username: row.username, avatar: row.avatar || 'a1' } };
}

// Express 中间件:校验 Bearer token,挂载 req.user(异步,需查库)
async function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: '未登录' });
  let payload;
  try { payload = jwt.verify(m[1], JWT_SECRET); }
  catch (e) { return res.status(401).json({ error: '登录已过期,请重新登录' }); }
  try {
    const user = await Q.userById(payload.uid);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(500).json({ error: '服务器错误' });
  }
}

function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }

// ===== 管理后台鉴权 =====
function signAdminToken() { return jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '12h' }); }
function adminRequired(req, res, next) {
  const KEY = process.env.ADMIN_KEY;
  if (!KEY) return res.status(403).json({ error: '后台未启用:请在服务器环境变量中配置 ADMIN_KEY' });
  const hk = req.headers['x-admin-key'];
  if (hk && hk === KEY) return next();          // CLI / 脚本直连
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (m) { try { const p = jwt.verify(m[1], JWT_SECRET); if (p && p.admin) return next(); } catch (e) { /* 无效令牌 */ } }
  return res.status(403).json({ error: 'forbidden' });
}

module.exports = { register, login, authRequired, signToken, httpErr, signAdminToken, adminRequired };
