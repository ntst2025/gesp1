# GESP 在线 · C++ 一级真题学习平台

一个**注册登录后才能访问**的全栈在线刷题系统:13 套 GESP C++ 一级官方真题(2023.03–2026.03)、共 **325 题**(195 单选 + 130 判断),对照 CCF 官方大纲分 7 章/子节。支持刷题判分、自动错题本、收藏夹、学习进度追踪。

> 本项目为开源自部署脚手架,**非 CCF 官方网站**,真题仅供备考学习使用。

---

## 功能一览

| 模块 | 说明 |
|---|---|
| 账号系统 | 注册 / 登录,密码 bcrypt 哈希,JWT 鉴权,所有题库接口需登录 |
| 题库浏览 | 7 章 → 子节 → 题目三级浏览,历年分布图表,逐题答案 + 解析 |
| 刷题自测 | 按随机 / 按章 / 错题重练组卷,服务端判分(不下发答案),即时解析 |
| 错题本 | 答错自动收录,答对自动移出,可手动标记「已掌握」 |
| 收藏夹 | 收藏任意题目随时复习 |
| 学习进度 | 累计正确率、各章覆盖率与正确率(按每题最近一次作答统计) |
| 全站搜索 | 题干 / 代码 / 选项关键词检索 |

## 技术栈

Node.js + Express 5 + **libSQL（@libsql/client）** + JWT + bcryptjs。前端为原生 HTML/CSS/JS(零构建、零外部 CDN,图表内联 SVG 自绘)。

数据库一处适配两种后端,由环境变量切换,代码不变:
- **本地开发**:不设 `TURSO_DATABASE_URL` 时,自动落到本地 SQLite 文件(`DB_PATH`)。
- **线上免费托管**:设置 `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`,数据存 Turso 云端(持久,免费档够用)。

所有 SQL 集中在 `src/db.js` 单文件,将来换 PostgreSQL 也只改这一个文件。

---

## 快速开始(本地)

**环境要求:Node.js >= 18**。

```bash
npm install
cp .env.example .env          # 把 JWT_SECRET 改成随机长串;本地可暂时不填 TURSO_*
npm run dev                   # 读取 .env 启动 -> http://localhost:3000
```

不填 `TURSO_*` 时数据写本地 `data/gesp.db`。首次启动会**自动建表并导入 325 题**(日志打印 `[db] seeded 325 questions`)。

---

## 免费上线:Render(免费层) + Turso(免费数据库)

Render 免费层磁盘是临时的,数据必须放到外部的 Turso(libSQL,与 SQLite 同方言,代码无需改写)。**这套组合完全免费、数据持久、无需备案**;唯一取舍是 Render 在海外,国内访问能用但不保证快(见末尾)。

### 第 1 步:建 Turso 数据库(约 3 分钟)
```bash
# 安装 CLI(macOS/Linux;Windows 可用 WSL)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup            # 浏览器登录(GitHub 账号即可)
turso db create gesp         # 建库;区域尽量选离 Render 区域近的(如新加坡 sin)
turso db show gesp --url     # 记下连接串:libsql://gesp-xxx.turso.io
turso db tokens create gesp  # 记下生成的 token
```
> 不用在本地往 Turso 导题——程序首次连上空库会自动建表 + 导入 325 题。

### 第 2 步:把代码推到 GitHub
```bash
git init && git add . && git commit -m "init gesp platform"
git branch -M main
git remote add origin https://github.com/你的用户名/gesp-platform.git
git push -u origin main
```
（`.gitignore` 已排除 `node_modules`、`.env`、本地 `*.db`,不会泄露密钥。）

### 第 3 步:在 Render 创建服务
1. 注册 https://render.com (可用 GitHub 登录,免费层不要信用卡)。
2. **New + -> Web Service -> 连接你的 GitHub 仓库**。
3. 关键配置:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
4. 在 Environment 添加环境变量:

   | Key | Value |
   |---|---|
   | `JWT_SECRET` | 随机长串(`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` 生成) |
   | `TURSO_DATABASE_URL` | 第 1 步的 `libsql://...turso.io` |
   | `TURSO_AUTH_TOKEN` | 第 1 步生成的 token |

5. 点 Create Web Service,等部署完成,访问 `https://你的应用.onrender.com`。首次访问会触发建表 + 导入题库。

> 免费层闲置约 15 分钟后休眠,下次访问需 30–60 秒唤醒;数据在 Turso 不受影响。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务端口(Render 自动注入) |
| `JWT_SECRET` | (内置弱默认值) | **生产必须改**为随机长串 |
| `JWT_EXPIRES` | `7d` | 登录令牌有效期 |
| `TURSO_DATABASE_URL` | (空) | 设了就用 Turso;不设则用本地文件 |
| `TURSO_AUTH_TOKEN` | (空) | Turso 访问令牌 |
| `DB_PATH` | `./data/gesp.db` | 本地回退时的 SQLite 路径 |
| `SEED_PATH` | `./data/site_data.json` | 题库种子 |

## 项目结构

```
gesp-platform/
├── server.js            Express 应用 + 所有 API 路由
├── src/
│   ├── db.js            数据访问层(唯一接触数据库;libSQL 客户端 + 建表/种子/查询)
│   └── auth.js          注册/登录/JWT/鉴权中间件
├── public/              前端:index.html / app.html / js/app.js / css/app.css
├── data/site_data.json  题库种子(325 题)
├── .env.example         环境变量模板(含 Turso 建库步骤)
└── package.json
```

## API 一览(题库接口均需 Authorization: Bearer <token>)

| 方法 + 路径 | 作用 |
|---|---|
| `POST /api/auth/register` · `login` | 注册 / 登录,返回 {token, user} |
| `GET /api/catalog` | 章节树 + 各级计数 + 套卷列表 |
| `GET /api/sections/:sid/questions` | 某子节全部题(含答案+解析+历年分布) |
| `GET /api/search?q=` | 全站搜索(<=80 条) |
| `POST /api/practice/start` | 组卷抽题({mode,id,count},**不含答案**) |
| `POST /api/attempts` | 提交作答({qid,chosen}),服务端判分并更新错题本 |
| `GET /api/attempts/recent` | 最近作答记录 |
| `GET /api/wrongbook` · `POST /api/wrongbook/:qid/master` | 错题本 / 标记已掌握 |
| `GET·POST·DELETE /api/bookmarks[/:qid]` | 收藏 |
| `GET /api/progress` | 学习进度统计 |

## 数据量大了之后:迁移到更稳/付费方案

当前免费组合适合测试期。用户和数据量上来后按需升级(基本不用改业务代码):

- **Turso 升级付费档**:免费档约 9GB / 5 亿行读每月,超了升 Turso 付费(约 $5/月起),`TURSO_*` 不变,零迁移。
- **Render 升级付费档**(约 $7/月):去掉休眠、常驻不冷启动。命令不变。
- **要国内访问快** -> 换**香港 CN2 服务器**(免备案)或**内地服务器 + ICP 备案**:clone 上去 `npm install`、设环境变量、`pm2` 守护 + Nginx 反代 + HTTPS。数据库可继续用 Turso,或本机用本地 SQLite(清空 `TURSO_*` 即走 `DB_PATH`)。
- **换 PostgreSQL**(如 Neon 免费档):只改 `src/db.js` 的客户端与 SQL 方言,表结构沿用。

## 安全硬化清单(上线前过一遍)

已内置:密码 bcrypt 哈希、JWT 鉴权、注册输入校验、SQL 全参数化、请求体大小限制。**建议补**:强随机 `JWT_SECRET` + 全程 HTTPS(Render 默认有);为 `/api/auth/*` 加登录/注册限流防爆破(如 express-rate-limit);收紧 CORS 到你的前端域名;可将 token 改为 httpOnly Cookie。

## 题库与解析现状

325 题已**全部分类入库并标注答案**,可正常刷题判分。**逐题文字解析目前完成第 1 章(32 题)**,第 2–7 章解析按章补充中——未写解析的题前端显示「解析按章补写中」,不影响做题。

**补充/修改解析**:解析存在 `data/site_data.json` 每题的 `explanation` 字段。改完后:
- 本地(文件库):删 `data/gesp.db` 后重启,按新种子重新导入。
- Turso:种子只在「库为空」时导入;库已有数据时应写个 `UPDATE questions SET explanation=? WHERE qid=?` 的小脚本批量更新(避免清库丢用户数据)。
