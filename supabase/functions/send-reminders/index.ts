// ============================================================
// send-reminders — Supabase Edge Function
// 由数据库 Cron 定时调用，给开启了提醒的用户发邮件（通过 Resend）
//   body: { "type": "nightly" }  -> 每晚 21:00 回顾提醒
//   body: { "type": "weekly"  }  -> 周日本周能量小结
// 安全：调用方必须带 header  x-reminder-secret: <CRON_SECRET>
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY    = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM          = Deno.env.get("REMINDER_FROM") ?? "INTJ能量板 <onboarding@resend.dev>";
const CRON_SECRET   = Deno.env.get("CRON_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// id -> email（分页拉全部用户）
async function emailMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) map[u.id] = u.email;
    if (data.users.length < 1000) break;
  }
  return map;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) { console.error("RESEND_API_KEY 未设置"); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) console.error("Resend 发送失败", to, res.status, await res.text());
  return res.ok;
}

function wrap(title: string, body: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,'Noto Sans SC',sans-serif;max-width:480px;margin:0 auto;padding:28px;background:#FFFFFF;border:1px solid #EFE3EA;border-radius:20px;color:#4A3F46">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 36% 30%,#FBE6A6,#F0C97C 78%)"></div>
      <div style="font-size:18px;font-weight:700">INTJ能量板</div>
    </div>
    <div style="font-size:20px;font-weight:700;margin-bottom:10px">${title}</div>
    <div style="font-size:15px;line-height:1.7;color:#6b5d65">${body}</div>
    <div style="margin-top:22px"><a href="https://intj-energy.vercel.app" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#5FB892;color:#fff;text-decoration:none;font-weight:600">打开能量板 →</a></div>
    <div style="margin-top:20px;font-size:11px;color:#B3A6AE">你在「设置 → 偏好」里开启了提醒，如不想再收到可在那里关闭。</div>
  </div>`;
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-reminder-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let type = "nightly";
  try { const b = await req.json(); if (b?.type) type = b.type; } catch { /* default */ }
  const flag = type === "weekly" ? "weeklySummary" : "nightReminder";

  // 开启了该提醒的用户
  const { data: states, error } = await admin
    .from("user_state").select("user_id, prefs").eq(`prefs->>${flag}`, "true");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const emails = await emailMap();

  // 周报需要每人最近 7 天的净能量
  const netByUser: Record<string, { net: number; days: number }> = {};
  if (type === "weekly") {
    const since = new Date(); since.setDate(since.getDate() - 6);
    const sinceISO = since.toISOString().slice(0, 10);
    const { data: logs } = await admin
      .from("daily_log").select("user_id, net, date").gte("date", sinceISO);
    for (const r of logs ?? []) {
      const u = netByUser[r.user_id] ?? (netByUser[r.user_id] = { net: 0, days: 0 });
      u.net += r.net ?? 0; u.days += 1;
    }
  }

  let sent = 0;
  for (const s of states ?? []) {
    const to = emails[s.user_id];
    if (!to) continue;
    let subject: string, body: string;
    if (type === "weekly") {
      const w = netByUser[s.user_id] ?? { net: 0, days: 0 };
      subject = "📊 本周能量小结";
      body = `这一周你记录了 <b>${w.days}</b> 天，净能量 <b>${w.net >= 0 ? "+" : ""}${w.net}</b>。<br/>新的一周，继续把时间花在让自己充电的事上吧～`;
    } else {
      subject = "🌙 该回顾今天的能量啦";
      body = "今天过得怎么样？花一分钟回顾一下：哪些事为你充了电，哪些消耗了你。给明天一个更好的安排。";
    }
    if (await sendEmail(to, subject, wrap(subject, body))) sent++;
  }

  return new Response(JSON.stringify({ ok: true, type, candidates: states?.length ?? 0, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
