-- ============================================================
-- 提醒后端的数据库部分：偏好列 + 两个定时任务
-- 在 Supabase 控制台 → SQL Editor 里跑（把 <...> 占位符换成你的值）
-- ============================================================

-- ① 给 user_state 加 prefs 列（前端把开关状态同步进来，后端据此判断给谁发）
alter table public.user_state
  add column if not exists prefs jsonb not null default '{}'::jsonb;

-- ② 开启定时任务所需扩展（如果控制台 Database → Extensions 里已开可跳过）
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ③ 删除同名旧任务（可重复执行）
select cron.unschedule('intj-nightly-reminder') where exists (select 1 from cron.job where jobname = 'intj-nightly-reminder');
select cron.unschedule('intj-weekly-summary')  where exists (select 1 from cron.job where jobname = 'intj-weekly-summary');

-- ④ 每天 13:00 UTC = 北京时间 21:00 —— 发「今日回顾」提醒
select cron.schedule(
  'intj-nightly-reminder',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://pycucnouthitjypkcdnw.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret', '<CRON_SECRET>'),
    body    := jsonb_build_object('type', 'nightly')
  );
  $$
);

-- ⑤ 每周日 13:00 UTC = 周日北京时间 21:00 —— 发「本周能量小结」
select cron.schedule(
  'intj-weekly-summary',
  '0 13 * * 0',
  $$
  select net.http_post(
    url     := 'https://pycucnouthitjypkcdnw.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret', '<CRON_SECRET>'),
    body    := jsonb_build_object('type', 'weekly')
  );
  $$
);

-- 查看已排定的任务： select jobname, schedule from cron.job;
-- 手动触发一次测试（验证邮件能发出）：
--   select net.http_post(
--     url := 'https://pycucnouthitjypkcdnw.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object('Content-Type','application/json','x-reminder-secret','<CRON_SECRET>'),
--     body := jsonb_build_object('type','nightly'));
