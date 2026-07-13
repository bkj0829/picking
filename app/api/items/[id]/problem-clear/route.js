import { fail, json } from "../../../../../lib/http";
import { getItemForUpdate, logAction } from "../../../../../lib/itemActions";
import { requireUser } from "../../../../../lib/session";

export async function POST(_request, { params }) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const { id } = await params;
  try {
    const item = await getItemForUpdate(auth.supabase, id);
    if (item.status !== "problem") return fail("문제 상태가 아닙니다.", 409);
    if (auth.user.role !== "admin" && item.problem_by !== auth.user.id) return fail("등록 담당자 또는 관리자만 취소할 수 있습니다.", 403);
    const { data, error } = await auth.supabase
      .from("picking_items")
      .update({
        status: "pending",
        problem_reason: null,
        problem_memo: null,
        problem_by: null,
        problem_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("status", "problem")
      .select("*")
      .single();
    if (error) return fail(error.message, 409);
    await logAction(auth.supabase, { item, user: auth.user, action: "problem_cleared", newStatus: "pending" });
    return json({ item: data });
  } catch (error) {
    return fail(error.message, 500);
  }
}
