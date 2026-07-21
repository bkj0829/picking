import { fail, json } from "../../../../../lib/http";
import { getItemForUpdate, logAction } from "../../../../../lib/itemActions";
import { requireUser } from "../../../../../lib/session";

export async function POST(request, { params }) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const item = await getItemForUpdate(auth.supabase, id);
    if (item.status === "done") {
      const { data: latest, error: latestError } = await auth.supabase.from("picking_items").select("*").eq("id", id).single();
      if (latestError) return fail(latestError.message, 409);
      return json({ item: latest });
    }
    if (item.status !== "pending" && item.status !== "problem") {
      return fail("이미 다른 담당자가 처리한 상품입니다.", 409);
    }
    const requiredQuantity = Math.max(Number(item.quantity || 0), 1);
    const currentPicked = Math.max(Number(item.picked_quantity || 0), 0);
    const requestedPicked = Number(body.targetPickedQuantity);
    const nextPicked = Math.min(
      Math.max(Number.isInteger(requestedPicked) ? requestedPicked : currentPicked + 1, currentPicked + 1),
      requiredQuantity
    );
    const isComplete = nextPicked >= requiredQuantity;
    const patch = {
      status: isComplete ? "done" : "pending",
      picked_quantity: nextPicked,
      assigned_worker_id: auth.user.id,
      completed_by: isComplete ? auth.user.id : null,
      completed_at: isComplete ? new Date().toISOString() : null,
      problem_reason: null,
      problem_memo: null,
      problem_by: null,
      problem_at: null,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await auth.supabase
      .from("picking_items")
      .update(patch)
      .eq("id", id)
      .in("status", ["pending", "problem"])
      .lt("picked_quantity", nextPicked)
      .select("*")
      .single();
    if (error) {
      const { data: latest, error: latestError } = await auth.supabase.from("picking_items").select("*").eq("id", id).single();
      if (!latestError && latest && (latest.status === "done" || Number(latest.picked_quantity || 0) >= nextPicked)) {
        return json({ item: latest });
      }
      return fail(error.message, 409);
    }
    await logAction(auth.supabase, {
      item,
      user: auth.user,
      action: isComplete ? "item_completed" : "item_picked",
      newStatus: patch.status,
      details: { pickedQuantity: nextPicked, requiredQuantity }
    });
    return json({ item: data });
  } catch (error) {
    return fail(error.message, 500);
  }
}
