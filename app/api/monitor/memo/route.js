import { fail, json } from "../../../../lib/http";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

function validPin(request) {
  const configured = process.env.MONITOR_PIN;
  if (!configured) return true;
  const url = new URL(request.url);
  const supplied = url.searchParams.get("pin") || url.searchParams.get("token") || request.headers.get("x-monitor-pin");
  return supplied === configured;
}

export async function POST(request) {
  if (!validPin(request)) return fail("모니터 PIN이 필요합니다.", 401);

  const body = await request.json().catch(() => ({}));
  const memo = String(body.memo || "").trim();
  if (!memo) return fail("공유할 메모를 입력하세요.");
  if (memo.length > 500) return fail("메모는 500자 이하로 입력하세요.");

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("picking_jobs")
    .select("id,status")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) return fail(jobError.message, 500);
  if (!job) return fail("진행 중인 피킹 작업이 없습니다.", 409);

  const { data, error } = await supabase
    .from("activity_logs")
    .insert({
      job_id: job.id,
      action: "monitor_memo_created",
      new_status: "active",
      details: { memo }
    })
    .select("*")
    .single();
  if (error) return fail(error.message, 500);

  return json({ memo: data });
}

export async function PATCH(request) {
  if (!validPin(request)) return fail("모니터 PIN이 필요합니다.", 401);

  const body = await request.json().catch(() => ({}));
  const memoId = String(body.memoId || "").trim();
  if (!memoId) return fail("확인 처리할 메모를 선택하세요.");

  const supabase = getSupabaseAdmin();

  const { data: memo, error: memoError } = await supabase
    .from("activity_logs")
    .select("*")
    .eq("id", memoId)
    .eq("action", "monitor_memo_created")
    .single();
  if (memoError) return fail(memoError.message, 404);

  const acknowledgedAt = new Date().toISOString();
  const details = { ...(memo.details || {}), acknowledgedAt };
  const { data, error } = await supabase
    .from("activity_logs")
    .update({ details })
    .eq("id", memoId)
    .select("*")
    .single();
  if (error) return fail(error.message, 500);

  await supabase.from("activity_logs").insert({
    job_id: memo.job_id,
    action: "monitor_memo_acknowledged",
    new_status: "active",
    details: { memoId, memo: memo.details?.memo || "", acknowledgedAt }
  });

  return json({ memo: data });
}
