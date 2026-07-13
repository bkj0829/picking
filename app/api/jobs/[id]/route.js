import { fail, json } from "../../../../lib/http";
import { requireUser } from "../../../../lib/session";

export async function GET(_request, { params }) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const { data: job, error: jobError } = await auth.supabase
    .from("picking_jobs")
    .select("*")
    .eq("id", params.id)
    .single();
  if (jobError) return fail(jobError.message, 500);
  const { data: items, error: itemError } = await auth.supabase
    .from("picking_items")
    .select("*, completed:completed_by(name), problem_worker:problem_by(name)")
    .eq("job_id", params.id)
    .order("status", { ascending: false })
    .order("location_sort_1", { ascending: true })
    .order("location_sort_2", { ascending: true })
    .order("sequence", { ascending: true });
  if (itemError) return fail(itemError.message, 500);
  return json({ job, items });
}

export async function PATCH(request, { params }) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return fail(auth.error, auth.status);
  const body = await request.json();
  const patch = {};
  if (body.status) {
    patch.status = body.status;
    if (body.status === "completed") patch.completed_at = new Date().toISOString();
    if (body.status === "archived") patch.archived_at = new Date().toISOString();
  }
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.memo !== undefined) patch.memo = body.memo || null;
  const { data, error } = await auth.supabase.from("picking_jobs").update(patch).eq("id", params.id).select("*").single();
  if (error) return fail(error.message, 500);
  await auth.supabase.from("activity_logs").insert({
    job_id: params.id,
    worker_id: auth.user.id,
    action: "job_updated",
    details: patch
  });
  return json({ job: data });
}
