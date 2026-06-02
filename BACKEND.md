# 提醒后端：定时邮件（关了网页也能收到）

让「每晚 21:00 回顾」和「周日本周小结」即使在网页关闭时也能送达，靠的是一个**定时运行的后端**。架构全部在 Supabase 内，加一个免费邮件服务：

```
Supabase Cron (定时)  ──每天/每周触发──▶  Edge Function: send-reminders
                                              │ 读 user_state.prefs 找出开了提醒的用户
                                              │ 读 auth.users 拿邮箱、daily_log 算本周净值
                                              └──▶  Resend  ──发邮件──▶  用户邮箱
```

仓库里已经备好：
- `supabase/functions/send-reminders/index.ts` — 发邮件的函数
- `supabase/setup-reminders.sql` — 加 `prefs` 列 + 两个定时任务（已填好你的项目 ref）

下面按顺序做。需要你自己操作的只有「注册 Resend」和「填几个密钥」。

---

## 第 1 步：加 `prefs` 列（前端同步偏好用）

Supabase → **SQL Editor** → 跑 `supabase/setup-reminders.sql` 里的**第 ① 段**（就这一句，先单独跑）：

```sql
alter table public.user_state add column if not exists prefs jsonb not null default '{}'::jsonb;
```

> 跑完后，前端「设置」里的三个开关就会**同步到云端**（之前只存本地）。这一步做完，提醒功能的前端部分就齐了。

## 第 2 步：注册 Resend，拿到 API Key

1. 打开 **https://resend.com** → 注册（可用 GitHub）。
2. 左侧 **API Keys** → **Create API Key** → 复制 `re_...` 开头的 key（只显示一次，存好）。
3. **关于发件域名（重要）**：
   - **快速测试（不绑域名）**：**不要**点 “Add domain”。直接用 Resend 自带的 `onboarding@resend.dev` 发，无需验证任何域名——唯一限制：**只能发到你注册 Resend 的那个邮箱**。先用它把整条链路跑通、确认自己能收到。
   - ⚠️ **不能用 `xxx.vercel.app` 当发件域名**：`vercel.app` 是 Vercel 的公共域名、不是你拥有的，Resend 会拒绝（“We don't allow free public domains”）。同理 `github.io`、`netlify.app` 等也不行。
   - **正式发给所有用户**：你需要**自己拥有一个域名**（任意一个，便宜的如 Cloudflare Registrar / Namecheap / 阿里云，约几~几十元/年）。左侧 **Domains → Add Domain** 填你买的域名（如 `yourname.com`），按提示去域名商后台加几条 DNS 记录（SPF/DKIM/DMARC）验证。通过后把发件地址设成 `INTJ能量板 <noreply@yourname.com>`。已有任何域名也可直接用（含子域名 `mail.yourname.com`）。

## 第 3 步：部署 Edge Function（用控制台，免装 CLI）

1. Supabase → 左侧 **Edge Functions** → **Deploy a new function**（或 Create function）。
2. 名字填 **`send-reminders`**（必须一致）。
3. 把 `supabase/functions/send-reminders/index.ts` 的**全部内容**粘进编辑器。
4. **关闭 “Verify JWT”**（这个函数靠下面的 `x-reminder-secret` 自己鉴权，不需要 JWT）。
5. 点 **Deploy**。

> 如果你更习惯命令行：`supabase login` → `supabase link --project-ref pycucnouthitjypkcdnw` → `supabase functions deploy send-reminders --no-verify-jwt`。

## 第 4 步：给函数设密钥（环境变量）

Supabase → **Edge Functions → 选中 send-reminders → Secrets**（或 Project Settings → Edge Functions → Manage secrets），加这几条：

| 名称 | 值 |
|---|---|
| `RESEND_API_KEY` | 第 2 步拿到的 `re_...` |
| `REMINDER_FROM` | `INTJ能量板 <onboarding@resend.dev>`（测试）或你验证过的域名地址 |
| `CRON_SECRET` | 你自己随便编一串长随机字符串（如 `intj_x8K3p...`），**记下来**，第 5 步要用 |

> `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 是 Supabase 自动注入的，**不用你设**。

## 第 5 步：建定时任务

打开 `supabase/setup-reminders.sql`，把里面 **2 处 `<CRON_SECRET>`** 替换成你第 4 步设的同一个值，然后在 **SQL Editor** 跑**第 ②③④⑤ 段**（项目 ref 我已经替你填好了）。

- 每天 **13:00 UTC = 北京时间 21:00** 发今日回顾。
- 每周日同一时间发本周小结。
- （时区固定按北京时间。以后要按各用户所在时区发，需要再存用户时区，告诉我即可。）

## 第 6 步：测试

在 SQL Editor 里手动触发一次（替换 `<CRON_SECRET>`）：

```sql
select net.http_post(
  url := 'https://pycucnouthitjypkcdnw.supabase.co/functions/v1/send-reminders',
  headers := jsonb_build_object('Content-Type','application/json','x-reminder-secret','<CRON_SECRET>'),
  body := jsonb_build_object('type','nightly'));
```

- 确保你的账号在「设置」里**开了**「每晚 21:00 提醒」，且 Resend 能发到你的邮箱（测试模式下= 你注册 Resend 的邮箱）。
- 几秒后查收邮件。在 **Edge Functions → send-reminders → Logs** 能看到执行日志、`sent` 数量；Resend 后台 **Emails** 也能看到发送记录。

---

## 排错

- **没收到邮件**：先看 Edge Function 的 Logs 有没有报错；再看 Resend → Emails 的状态。测试模式下只能发到你注册 Resend 的邮箱。
- **函数返回 401**：`x-reminder-secret` 和函数 Secrets 里的 `CRON_SECRET` 不一致。
- **`candidates: 0`**：没有用户把开关打开，或 `prefs` 列没建（第 1 步）/前端还没同步上去（去设置页拨一下开关，等「✓ 已同步」）。
- **cron 没跑**：`select jobname, schedule from cron.job;` 看任务是否在；`pg_cron`/`pg_net` 扩展是否已开（Database → Extensions）。

## 安全说明

- `CRON_SECRET`、`RESEND_API_KEY`、service role key 都**只存在 Supabase 服务端**（函数 Secrets / 数据库里），不会出现在前端 `index.html`，也没提交进仓库。
- 函数用 service role 读 `auth.users` 拿邮箱，但它被 `x-reminder-secret` 保护，外部无法随意调用。
