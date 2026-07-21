import { fail, json } from "../../../../lib/http";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

const CANCEL_REASONS = new Set(["취소", "부분취소", "취소완료"]);

function validPin(request) {
  const configured = process.env.MONITOR_PIN;
  if (!configured) return true;
  const url = new URL(request.url);
  const supplied = url.searchParams.get("pin") || url.searchParams.get("token") || request.headers.get("x-monitor-pin");
  return supplied === configured;
}

function isCancelItem(item) {
  return Number(item.canceled_quantity || 0) > 0 || (item.status === "problem" && CANCEL_REASONS.has(item.problem_reason));
}

export async function PATCH(request) {
  if (!validPin(request)) return fail("모니터 PIN이 필요합니다.", 401);

  const body = await request.json().catch(() => ({}));
  const itemId = String(body.itemId || "").trim();
  const memo = String(body.memo || "").trim();
  if (!itemId) return fail("취소 상품을 선택하세요.");
  if (memo.length > 500) return fail("메모는 500자 이하로 입력하세요.");

  const supabase = getSupabaseAdmin();

  const { data: item, error: itemError } = await supabase
    .from("picking_items")
    .select("*, job:picking_jobs(id,status)")
    .eq("id", itemId)
    .single();
  if (itemError) return fail(itemError.message, 404);
  if (item.job?.status !== "active") return fail("진행 중인 작업의 취소건만 수정할 수 있습니다.", 409);
  if (!isCancelItem(item)) return fail("취소건만 메모를 등록할 수 있습니다.", 409);

  const { data, error } = await supabase
    .from("picking_items")
    .update({ problem_memo: memo || null, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .select("*")
    .single();
  if (error) return fail(error.message, 500);

  await supabase.from("activity_logs").insert({
    job_id: item.job_id,
    item_id: item.id,
    action: "cancel_memo_updated",
    previous_status: item.status,
    new_status: item.status,
    details: { memo }
  });

  return json({ item: data });
}
