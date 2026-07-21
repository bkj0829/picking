import { fail, json } from "../../../../lib/http";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

function validPin(request) {
  const configured = process.env.MONITOR_PIN;
  if (!configured) return true;
  const url = new URL(request.url);
  const supplied = url.searchParams.get("pin") || url.searchParams.get("token") || request.headers.get("x-monitor-pin");
  return supplied === configured;
}

export async function GET(request) {
  if (!validPin(request)) return fail("모니터 PIN이 필요합니다.", 401);

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("picking_jobs")
    .select("id,title,status,created_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return fail(error.message, 500);
  return json({ job: job || null });
}
