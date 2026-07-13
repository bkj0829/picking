import { fail, json } from "../../../../../lib/http";
import { getItemForUpdate, logAction } from "../../../../../lib/itemActions";
import { requireUser } from "../../../../../lib/session";

const REASONS = ["품절", "재고마감", "재고없음", "위치없음", "수량부족", "상품불일치"];

export async function POST(request, { params }) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const { id } = await params;
  const body = await request.json();
  const reason = String(body.reason || "");
  const memo = String(body.memo || "").trim();
  if (!REASONS.includes(reason)) return fail("문제 사유를 선택하세요.");
  try {
    const item = await getItemForUpdate(auth.supabase, id);
    if (item.status === "done") return fail("완료된 상품은 먼저 완료 취소 후 문제 등록하세요.", 409);
    const { data, error } = await auth.supabase
      .from("picking_items")
      .update({
        status: "problem",
        problem_reason: reason,
        problem_memo: memo || null,
        problem_by: auth.user.id,
        problem_at: new Date().toISOString(),
        assigned_worker_id: auth.user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .neq("status", "done")
      .select("*")
      .single();
    if (error) return fail(error.message, 409);
    await logAction(auth.supabase, {
      item,
      user: auth.user,
      action: "problem_created",
      newStatus: "problem",
      details: { reason, memo }
    });
    return json({ item: data });
  } catch (error) {
    return fail(error.message, 500);
  }
}
