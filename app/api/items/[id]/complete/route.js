import { fail, json } from "../../../../../lib/http";
import { getItemForUpdate, logAction } from "../../../../../lib/itemActions";
import { requireUser } from "../../../../../lib/session";

export async function POST(_request, { params }) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  try {
    const item = await getItemForUpdate(auth.supabase, params.id);
    if (item.status !== "pending" && item.status !== "problem") {
      return fail("이미 다른 담당자가 처리한 상품입니다.", 409);
    }
    const { data, error } = await auth.supabase
      .from("picking_items")
      .update({
        status: "done",
        completed_by: auth.user.id,
        completed_at: new Date().toISOString(),
        assigned_worker_id: auth.user.id,
        problem_reason: null,
        problem_memo: null,
        problem_by: null,
        problem_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", params.id)
      .in("status", ["pending", "problem"])
      .select("*")
      .single();
    if (error) return fail(error.message, 409);
    await logAction(auth.supabase, { item, user: auth.user, action: "item_completed", newStatus: "done" });
    return json({ item: data });
  } catch (error) {
    return fail(error.message, 500);
  }
}
