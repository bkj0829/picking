import { fail, json } from "../../../../../lib/http";
import { getItemForUpdate, logAction } from "../../../../../lib/itemActions";
import { requireUser } from "../../../../../lib/session";

export async function POST(_request, { params }) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  try {
    const item = await getItemForUpdate(auth.supabase, params.id);
    if (item.status !== "done") return fail("완료 상태가 아닙니다.", 409);
    if (auth.user.role !== "admin" && item.completed_by !== auth.user.id) return fail("처리 담당자 또는 관리자만 취소할 수 있습니다.", 403);
    const { data, error } = await auth.supabase
      .from("picking_items")
      .update({
        status: "pending",
        completed_by: null,
        completed_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", params.id)
      .eq("status", "done")
      .select("*")
      .single();
    if (error) return fail(error.message, 409);
    await logAction(auth.supabase, { item, user: auth.user, action: "item_undo", newStatus: "pending" });
    return json({ item: data });
  } catch (error) {
    return fail(error.message, 500);
  }
}
