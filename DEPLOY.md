# INTJ能量板 — 部署成真正可用的多用户网站

你的 `index.html` 现在已经内置了**登录注册 + 云端数据同步**。整体方案：

```
浏览器里的 index.html  ──登录/读写──▶  Supabase（免费）
   （部署在 Vercel/Netlify）              ├─ Auth：邮箱+密码登录
                                          └─ Postgres：每个用户一行数据
```

- **不需要你自己写后端、租服务器**。Supabase 同时提供登录和数据库，浏览器直接安全访问。
- 安全性由数据库的 **RLS（行级安全）** 保证：每个用户只能读写自己的数据，别人偷不到。
- 在 `index.html` 里**明文写 anon key 是安全的、官方就是这么设计的**（它是公开 key，真正的权限控制在 RLS）。

> 还没配置 Supabase 也没关系：直接打开 `index.html` 会进入「本地模式」，功能照常，数据只存当前浏览器。配置好下面两步后才会出现登录界面和多设备同步。

---

## 第 1 步：创建 Supabase 项目（约 3 分钟）

1. 打开 https://supabase.com → 用 GitHub 或邮箱注册登录。
2. **New project** → 填项目名、设置一个数据库密码（自己记住即可）、选离你近的区域 → **Create new project**，等 1~2 分钟初始化。

## 第 2 步：建表 + 开启权限（复制粘贴即可）

进入项目 → 左侧 **SQL Editor** → **New query** → 粘贴下面全部 SQL → **Run**：

> 下面这段是**可重复执行**的（policy 都先 `drop ... if exists` 再创建），无论你是第一次跑、还是之前跑过旧版本，直接整段粘贴运行都安全。

```sql
-- ① 当前状态：每个用户一行（今日任务 / 分类 / 初始能量 / 最后活动日期）
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  tasks      jsonb       not null default '[]'::jsonb,
  cats       jsonb       not null default '[]'::jsonb,
  initial    integer     not null default 30,
  last_date  date,                       -- 上面 tasks 属于哪一天（用于跨天结算）
  updated_at timestamptz not null default now()
);
-- 若之前建过旧版 user_state，补上新列（已存在会自动跳过）
alter table public.user_state add column if not exists last_date date;

-- ② 历史记录：每个用户的每个「已结算日期」一行（真实累积的年/月/日数据）
create table if not exists public.daily_log (
  user_id uuid    not null references auth.users (id) on delete cascade,
  date    date    not null,
  tasks   jsonb   not null default '[]'::jsonb,   -- 当天完成的事项
  gain    integer not null default 0,
  drain   integer not null default 0,
  net     integer not null default 0,
  primary key (user_id, date)
);

-- 开启行级安全（已开启则无害）
alter table public.user_state enable row level security;
alter table public.daily_log  enable row level security;

-- 策略：先删后建，可重复执行
drop policy if exists "select own state" on public.user_state;
drop policy if exists "insert own state" on public.user_state;
drop policy if exists "update own state" on public.user_state;
create policy "select own state" on public.user_state for select using (auth.uid() = user_id);
create policy "insert own state" on public.user_state for insert with check (auth.uid() = user_id);
create policy "update own state" on public.user_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "select own log" on public.daily_log;
drop policy if exists "insert own log" on public.daily_log;
drop policy if exists "update own log" on public.daily_log;
create policy "select own log" on public.daily_log for select using (auth.uid() = user_id);
create policy "insert own log" on public.daily_log for insert with check (auth.uid() = user_id);
create policy "update own log" on public.daily_log for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

看到 “Success. No rows returned” 就对了。

> **想要一个完全干净的数据库？** 如果你之前测试时已经产生了带预制数据的行，跑一次下面这两行就能清空（不可恢复，仅清你账号自己的数据也行）：
>
> ```sql
> truncate public.daily_log;
> truncate public.user_state;
> ```
>
> 新代码里新用户从**空任务**开始（保留 7 个默认分类作为可编辑起点），不会再出现预制的 8 条假任务。

## 第 3 步：把密钥填进 index.html

项目 → 左侧 **Project Settings**（齿轮）→ **API**，复制两项：

- **Project URL**（形如 `https://abcdxxx.supabase.co`）
- **Project API keys** 里的 **`anon` `public`** key（很长一串）

打开本目录的 `index.html`，找到文件顶部这段（搜 `SUPABASE_CONFIG`），把两行换成你的值：

```js
window.SUPABASE_CONFIG = {
  url:     "https://abcdxxx.supabase.co",   // ← 你的 Project URL
  anonKey: "eyJhbGciOi...很长...",          // ← 你的 anon public key
};
```

保存。现在用浏览器打开 `index.html`，应该会出现**登录/注册**界面了。

## 第 4 步（关于邮箱确认，建议先看）

Supabase 默认**注册后要邮箱点确认链接**才能登录。两种选择：

- **想免确认、注册完直接用**：项目 → **Authentication** → **Sign In / Providers** → **Email** → 关掉 **Confirm email** → 保存。（适合自己测试 / 内部使用）
- **保留邮箱确认（更正式）**：项目 → **Authentication** → **URL Configuration** → 把 **Site URL** 设成你部署后的网址（见第 5 步），确认邮件里的链接才会跳回你的站点。

---

## 第 5 步：部署到 Vercel 或 Netlify（任选其一）

你的网站就是一个文件夹（里面有 `index.html`）。两种最省事的方式：

### A. 拖拽上传（最快，零配置）

- **Netlify**：登录 https://app.netlify.com → **Add new site** → **Deploy manually** → 把**这个文件夹**拖进去 → 几秒后得到一个 `xxx.netlify.app` 网址。
- **Vercel**：https://vercel.com → 新建项目时也支持拖拽 / 上传。

之后改了 `index.html` 想更新，再拖一次即可。

### B. 连 Git 自动部署（推荐长期用）

1. 把本文件夹推到一个 GitHub 仓库。
2. **Vercel** → **Add New… → Project** → 选这个仓库 → 直接 **Deploy**（无需任何构建设置，它就是静态站点）。
3. 以后每次 `git push`，网站自动更新。Netlify 同理（**Import from Git**）。

### 部署后回到第 4 步

把拿到的正式网址（如 `https://intj-energy.vercel.app`）填回 Supabase 的 **Site URL**，邮箱确认链接才会正确跳转。

---

## 完成后你将拥有

- 一个公网可访问的网址，任何人都能注册自己的账号，**新账号从干净的空白开始**（无预制假数据）。
- 每个用户的任务 / 分类 / 初始能量 / **历史记录**，全部**自动云端保存、换手机换电脑都能同步**（侧栏底部显示账号和「✓ 已同步」状态）。
- **历史真实累积**：每过一天，前一天完成的事项会自动结算写入数据库，「能量趋势 / 本月 / 本年 / 某日详情」展示的都是你的真实记录。
- 断网时仍能用（本地缓存），联网后继续同步。

## 想换免费域名 / 绑定自己的域名？

Vercel、Netlify 都自带免费二级域名和免费 HTTPS。要绑你自己的域名（如 `energy.yourname.com`），在它们的 **Domains** 设置里添加并按提示改一条 DNS 记录即可。

---

## 跨天结算是怎么工作的

- 任务列表是你的「今日清单」。**每次打开 app 时如果发现已经跨天**，会自动把上一活动日的**已完成事项**归档进 `daily_log`（写入历史），**未完成的事项顺延到今天**，然后能量从初始值重新开始。
- 如果 app 一直开着跨过了午夜，页面检测到日期变化会自动刷新一次以触发结算。
- 中间没打开 app 的空白日子，不会产生记录（视为休息日），这是正常的。

## 现状与可选的下一步

- 成就页的解锁条件也已改为**基于真实记录计算**（连续天数、累计增能等），新账号从 0 开始逐步点亮。
- 历史的归档时间是「按日期」整体归档，单个任务没有精确到几点完成（当前模型不记录完成时刻）。如果以后想要更细的「每件事的完成时间线」，可以再加一个字段，告诉我即可。
