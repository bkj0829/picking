import { fail, json } from "../../../lib/http";
import { requireUser } from "../../../lib/session";

export async function GET(request) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const jobId = new URL(request.url).searchParams.get("jobId");
  let query = auth.supabase
    .from("activity_logs")
    .select("*, worker:worker_id(name), item:item_id(product_name, option_name, location)")
    .order("created_at", { ascending: false })
    .limit(80);
  if (jobId) query = query.eq("job_id", jobId);
  const { data, error } = await query;
  if (error) return fail(error.message, 500);
  return json({ logs: data });
}
