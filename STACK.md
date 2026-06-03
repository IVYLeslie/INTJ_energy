# 全栈 Web App 复用模板 · Playbook（给 Claude Code 读取）

> **怎么用这份文件**：在新项目里把这个 `STACK.md` 放进根目录，然后对 Claude Code 说：
> 「读取 STACK.md，按这套技术栈和流程帮我搭建 <你的项目想法>」。
> 它就会照下面的架构、代码骨架和部署清单来做。

这套栈的目标：**最少运维、纯静态前端、零自建服务器，也能有登录 / 多用户 / 云端数据库 / 定时任务 / 邮件**。已在一个真实项目（能量待办）跑通。

---

## 1. 技术栈

| 层 | 工具 | 角色 | 费用 |
|---|---|---|---|
| 前端 | 单文件 `index.html` + React 18(CDN UMD)+ Babel Standalone(浏览器内编译 JSX) | UI / 交互 / 状态，**无构建步骤** | 免费 |
| 字体/样式 | CSS 变量 + Google Fonts | 主题化 | 免费 |
| 前端托管 | **Vercel**（或 Netlify / Cloudflare Pages） | 静态托管 + 连 GitHub 自动部署 | 免费 |
| 代码托管 | **GitHub**（SSH 推送） | 版本管理 + 触发部署 | 免费 |
| 后端 BaaS | **Supabase** | Postgres 数据库 + Auth + Edge Functions + Cron | 免费额度够用 |
| 鉴权 | Supabase Auth（邮箱+密码） | 注册/登录 | 免费 |
| 数据隔离 | Postgres **RLS** 策略 | 每用户只能读写自己的数据 | 免费 |
| DB 客户端 | `@supabase/supabase-js`（浏览器直连） | 前端直接读写，免自写后端 API | 免费 |
| 服务端逻辑 | Supabase Edge Functions（Deno/TS） | 定时任务里要跑的代码 | 免费额度 |
| 定时 | `pg_cron` + `pg_net` | 周期触发 Edge Function | 免费 |
| 邮件 | **Resend** | 把邮件真正投递到邮箱 | 免费 100 封/天 |

**架构图**
```
浏览器（Vercel 托管的 index.html）
   │  supabase-js 直连（anon key + RLS 保护）
   ▼
Supabase ── Postgres / Auth / Edge Function / Cron
   │  Cron 定时触发函数
   ▼
Resend ── 发邮件 ──▶ 用户邮箱
```

---

## 2. 核心设计原则（照搬这些就不会错）

1. **前端零构建**：用 React + Babel 的 CDN，直接写 `<script type="text/babel">`，不引入 webpack/vite，部署就是丢一个 `index.html`。
2. **per-user JSON 行**：每个用户一行 `user_state`，整份 app 状态存成 `jsonb`。比拆很多表简单得多，和「localStorage 存一个对象」心智一致。需要历史/时间序列时，再单开一张 `(user_id, date)` 的 `daily_log` 表。
3. **anon key 可以放前端**：它是公开 key，安全靠 **RLS**。真正的秘密（service_role key、第三方 API key、cron secret）**只放 Supabase 服务端**，绝不进前端 / 仓库。
4. **离线优先**：状态先存 localStorage（即时、断网可用），再防抖同步到云端。
5. **所有 SQL 可重复执行**：策略用 `drop policy if exists` 再 `create`；加列用 `add column if not exists`。

---

## 3. 部署流程（新项目照这个顺序）

```
① 写单文件 index.html（React+Babel CDN，无构建）
② git init → 推到 GitHub（SSH）
③ Vercel: Import 仓库 → Deploy → 拿到网址 https://<proj>.vercel.app
④ Supabase: 建项目 → SQL Editor 跑 schema.sql（建表+RLS）
⑤ 复制 Supabase 的 Project URL + anon key 填进 index.html 的 SUPABASE_CONFIG
⑥ Supabase: Authentication → URL Configuration → Site URL = Vercel 网址
⑦（需要定时/邮件时）部署 Edge Function + 设 Secrets + 跑 cron SQL + 注册 Resend
⑧ 以后改代码 → git push → Vercel 自动上线
```

---

## 4. 可直接复制的代码骨架

### 4a. `index.html` —— 前端骨架（React + Supabase 登录 + 每用户云同步）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My App</title>
  <style>/* 你的 CSS（建议用 CSS 变量做主题） */</style>
</head>
<body>
  <div id="root"></div>

  <script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" crossorigin></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

  <!-- 填你的 Supabase 配置（anon key 放这里是安全的，靠 RLS 保护） -->
  <script>
    window.SUPABASE_CONFIG = {
      url:     "https://<PROJECT_REF>.supabase.co",
      anonKey: "<ANON_OR_PUBLISHABLE_KEY>",
    };
  </script>

  <script type="text/babel" data-presets="react">
    const { useState, useEffect, useRef } = React;
    const LS = {
      get(k,d){ try{const v=localStorage.getItem(k); return v==null?d:JSON.parse(v);}catch{return d;} },
      set(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch{} },
    };
    const CFG = window.SUPABASE_CONFIG || {};
    const READY = !!(CFG.url && CFG.anonKey && !/^<|YOUR_/.test(CFG.url) && !/^<|YOUR_/.test(CFG.anonKey) && window.supabase);
    const SB = READY ? window.supabase.createClient(CFG.url, CFG.anonKey) : null;

    const DEFAULT_STATE = { items: [] };          // ← 你的 app 初始状态

    async function loadState(uid){
      const { data, error } = await SB.from('user_state').select('*').eq('user_id', uid).maybeSingle();
      if (error) throw error; return data;
    }
    async function saveState(uid, state){
      const { error } = await SB.from('user_state').upsert(
        { user_id: uid, state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) console.warn('save', error.message);
    }

    function AuthScreen(){
      const [mode,setMode]=useState('signin');
      const [email,setEmail]=useState(''); const [pw,setPw]=useState('');
      const [err,setErr]=useState(null); const [busy,setBusy]=useState(false);
      const submit=async()=>{ setErr(null); setBusy(true);
        try{
          if(mode==='signin'){ const {error}=await SB.auth.signInWithPassword({email,password:pw}); if(error)throw error; }
          else { const {error}=await SB.auth.signUp({email,password:pw}); if(error)throw error; }
        }catch(e){ setErr(e.message); } finally{ setBusy(false); }
      };
      return (
        <div style={{minHeight:'100vh',display:'grid',placeItems:'center'}}>
          <div style={{width:360,padding:28,border:'1px solid #eee',borderRadius:16}}>
            <h2>{mode==='signin'?'登录':'注册'}</h2>
            <input placeholder="邮箱" value={email} onChange={e=>setEmail(e.target.value)} style={{width:'100%',margin:'8px 0',padding:10}}/>
            <input placeholder="密码" type="password" value={pw} onChange={e=>setPw(e.target.value)} style={{width:'100%',margin:'8px 0',padding:10}}/>
            {err && <div style={{color:'crimson',fontSize:13}}>{err}</div>}
            <button onClick={submit} disabled={busy} style={{width:'100%',padding:10,marginTop:8}}>{busy?'...':(mode==='signin'?'登录':'注册')}</button>
            <p style={{fontSize:13}} onClick={()=>setMode(mode==='signin'?'signup':'signin')}>
              {mode==='signin'?'去注册':'去登录'}
            </p>
          </div>
        </div>
      );
    }

    function App({ session }){
      const cloud = !!(SB && session);
      const uid = cloud ? session.user.id : 'local';
      const [state,setState]=useState(()=>LS.get('state_'+uid, DEFAULT_STATE));
      const hydrated=useRef(false); const timer=useRef(null);

      useEffect(()=>{ let alive=true; hydrated.current=false;
        (async()=>{
          let s=state;
          if(cloud){ const r=await loadState(uid).catch(()=>null);
            if(r && r.state) s=r.state; else await saveState(uid, s); }
          if(!alive) return; setState(s); hydrated.current=true;
        })(); return ()=>{alive=false;};
      },[uid,cloud]);

      useEffect(()=>{ LS.set('state_'+uid, state); }, [state]);          // 本地缓存
      useEffect(()=>{ if(!cloud||!hydrated.current) return;              // 防抖云同步
        clearTimeout(timer.current);
        timer.current=setTimeout(()=>saveState(uid, state), 700);
      }, [state, cloud]);

      return (
        <div style={{padding:24}}>
          <h1>My App</h1>
          {/* 你的 UI：读 state、用 setState 更新即可，自动云同步 */}
          {cloud && <button onClick={()=>SB.auth.signOut()}>退出</button>}
        </div>
      );
    }

    function Root(){
      const [session,setSession]=useState(undefined);
      useEffect(()=>{ if(!SB) return;
        SB.auth.getSession().then(({data})=>setSession(data.session));
        const { data:sub } = SB.auth.onAuthStateChange((_e,s)=>setSession(s));
        return ()=>sub.subscription.unsubscribe();
      },[]);
      if(!SB) return <App session={null} />;        // 没配 Supabase → 本地模式
      if(session===undefined) return <div style={{padding:24}}>加载中…</div>;
      if(!session) return <AuthScreen/>;
      return <App session={session} />;
    }
    ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
  </script>
</body>
</html>
```

### 4b. `schema.sql` —— 建表 + RLS（在 Supabase SQL Editor 跑，可重复执行）

```sql
-- 每个用户一行，整份状态存 jsonb
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
drop policy if exists "own state s" on public.user_state;
drop policy if exists "own state i" on public.user_state;
drop policy if exists "own state u" on public.user_state;
create policy "own state s" on public.user_state for select using (auth.uid() = user_id);
create policy "own state i" on public.user_state for insert with check (auth.uid() = user_id);
create policy "own state u" on public.user_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 需要时间序列/历史时，再加一张（可选）
create table if not exists public.daily_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  date    date not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, date)
);
alter table public.daily_log enable row level security;
drop policy if exists "own log s" on public.daily_log;
drop policy if exists "own log i" on public.daily_log;
drop policy if exists "own log u" on public.daily_log;
create policy "own log s" on public.daily_log for select using (auth.uid() = user_id);
create policy "own log i" on public.daily_log for insert with check (auth.uid() = user_id);
create policy "own log u" on public.daily_log for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### 4c. `supabase/functions/notify/index.ts` —— Edge Function 发邮件（Resend）

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB  = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } });               // service role：可读 auth.users，绕过 RLS
const RESEND = Deno.env.get("RESEND_API_KEY")!;
const FROM   = Deno.env.get("MAIL_FROM") ?? "App <onboarding@resend.dev>";
const SECRET = Deno.env.get("CRON_SECRET") ?? "";

async function email(to: string, subject: string, html: string){
  const r = await fetch("https://api.resend.com/emails", { method:"POST",
    headers:{ Authorization:`Bearer ${RESEND}`, "Content-Type":"application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }) });
  if(!r.ok) console.error("resend", to, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  if (SECRET && req.headers.get("x-cron-secret") !== SECRET) return new Response("unauthorized",{status:401});
  // 取要通知的用户（按你的业务条件过滤）
  const { data: rows } = await SB.from("user_state").select("user_id, state");
  const { data: users } = await SB.auth.admin.listUsers({ page:1, perPage:1000 });
  const mail = Object.fromEntries((users?.users ?? []).filter(u=>u.email).map(u=>[u.id,u.email]));
  let sent = 0;
  for (const r of rows ?? []) {
    const to = mail[r.user_id]; if(!to) continue;
    if (await email(to, "提醒", "<b>你好</b>，这是定时提醒。")) sent++;
  }
  return new Response(JSON.stringify({ ok:true, sent }), { headers:{ "Content-Type":"application/json" }});
});
```

### 4d. `cron.sql` —— 定时任务（替换 `<PROJECT_REF>` 和 `<CRON_SECRET>`）

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('my-notify') where exists (select 1 from cron.job where jobname='my-notify');
-- 时间是 UTC：北京时间 = UTC+8，例如北京 21:00 = 13:00 UTC
select cron.schedule('my-notify', '0 13 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body    := jsonb_build_object('type','daily'));
$$);
```

---

## 5. 部署动作清单（含每个平台点哪里）

**GitHub**
- `git init && git add -A && git commit -m "init"`
- `git branch -M main`
- 在 GitHub 网页 **New repository**（空仓库，不勾 README）
- `git remote add origin git@github.com:<user>/<repo>.git && git push -u origin main`（用 SSH 免密码）

**Vercel**
- vercel.com → Add New → Project → 选仓库 → Deploy（静态站点零配置）
- Domains 里可改前缀或绑自有域名

**Supabase**
- 建项目 → **SQL Editor** 跑 `schema.sql`
- **Project Settings → API** 复制 Project URL + anon/publishable key 填进 index.html
- **Authentication → URL Configuration** → Site URL 填 Vercel 网址
- **Edge Functions** → 新建 `notify` → 粘贴 4c 代码 → **关 Verify JWT** → Deploy
- 函数 **Secrets** 设 `RESEND_API_KEY` `MAIL_FROM` `CRON_SECRET`（`SUPABASE_*` 自动注入，别手设）
- **SQL Editor** 跑 `cron.sql`

**Resend**
- resend.com → API Keys 拿 `re_...`
- 测试：用 `onboarding@resend.dev`（只能发给你自己注册的邮箱）
- 群发：Domains 验证**你自己拥有的域名**（`vercel.app`/`github.io` 不行）

---

## 6. 避坑清单（血泪经验）

- ❌ `vercel.app` / `github.io` / `netlify.app` **不能当邮件发件域名**（公共域名）。先用 Resend 测试地址，群发再买/验证自有域名。
- ❌ `create policy` 不能重复跑 → 一律 `drop policy if exists` 再建。
- ❌ Edge Function 别手动设 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`（保留名，自动注入）。
- ❌ cron 时间是 **UTC**，记得换算时区。
- ✅ anon key 放前端**安全**；service_role / Resend key / cron secret **只放服务端**。
- ✅ push 用 **SSH**（`git@github.com:...`）不反复要密码。
- ✅ 加列用 `add column if not exists`；前端读云端用 `.select('*')`，缺列也不报错。
- ✅ 纯前端没有「定时/跨天」能力 → 要么打开时比对时间处理，要么交给 Supabase Cron。

---

## 7. 给 Claude Code 的执行提示

读到这份文件后，建议按此协作：
1. 先确认本项目要不要**登录/多用户**（要 → 用 Supabase；纯本地工具 → 只要 index.html + localStorage，跳过后端）。
2. 要不要**定时/邮件**（要 → 加 Edge Function + Cron + Resend；不要 → 跳过第 4c/4d）。
3. 先把前端 `index.html` 跑通（本地模式即可，不配 Supabase 也能用），再接后端。
4. 每步用 `git commit` 小步提交；改完 push 让 Vercel 自动部署。
5. 秘密永远不进前端/仓库。
```
