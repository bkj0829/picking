import { fail, json } from "../../../lib/http";
import { requireUser } from "../../../lib/session";

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const { data, error } = await auth.supabase
    .from("picking_jobs")
    .select("*, picking_items(id,status,quantity,completed_by,problem_by)")
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) return fail(error.message, 500);
  return json({ jobs: data });
}

export async function POST(request) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const body = await request.json();
  const title = String(body.title || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!title) return fail("작업명을 입력하세요.");
  if (!items.length) return fail("생성할 품목이 없습니다.");

  const totalItems = items.length;
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const { data: job, error: jobError } = await auth.supabase
    .from("picking_jobs")
    .insert({
      title,
      source_file_name: body.sourceFileName || null,
      status: "active",
      total_items: totalItems,
      total_quantity: totalQuantity,
      created_by: auth.user.id,
      memo: body.memo || null
    })
    .select("*")
    .single();
  if (jobError) return fail(jobError.message, 500);

  const rows = items.map((item, index) => ({
    original_quantity: Number(item.quantity || 0),
    canceled_quantity: 0,
    job_id: job.id,
    sequence: index + 1,
    product_name: item.product_name,
    option_name: item.option_name || "단일상품",
    location: item.location || "",
    location_sort_1: item.location_sort_1 || 4999999,
    location_sort_2: item.location_sort_2 || 999999,
    quantity: Number(item.quantity || 0),
    picked_quantity: 0,
    status: "pending"
  }));
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error: itemError } = await auth.supabase.from("picking_items").insert(rows.slice(i, i + chunkSize));
    if (itemError) return fail(itemError.message, 500);
  }
  await auth.supabase.from("activity_logs").insert({
    job_id: job.id,
    worker_id: auth.user.id,
    action: "job_created",
    new_status: "active",
    details: { totalItems, totalQuantity, sourceFileName: body.sourceFileName || null }
  });
  return json({ job });
}
