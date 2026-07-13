import { fail, json } from "../../../lib/http";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

const PROBLEM_REASONS = ["재고마감", "재고없음", "위치없음", "수량부족", "부분취소", "취소완료"];

function validPin(request) {
  const configured = process.env.MONITOR_PIN;
  if (!configured) return true;
  const url = new URL(request.url);
  const supplied = url.searchParams.get("pin") || url.searchParams.get("token") || request.headers.get("x-monitor-pin");
  return supplied === configured;
}

function toTime(value) {
  return value ? new Date(value).getTime() : 0;
}

export async function GET(request) {
  if (!validPin(request)) return fail("모니터 PIN이 필요합니다.", 401);

  const supabase = getSupabaseAdmin();
  const { data: job, error: jobError } = await supabase
    .from("picking_jobs")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) return fail(jobError.message, 500);
  if (!job) {
    return json({
      job: null,
      items: [],
      summary: { total: 0, done: 0, remain: 0, problem: 0, percent: 0 },
      workerStats: [],
      recentLogs: [],
      problemItems: [],
      reasonCounts: Object.fromEntries(PROBLEM_REASONS.map((reason) => [reason, 0]))
    });
  }

  const [{ data: items, error: itemError }, { data: logs, error: logError }, { data: workers, error: workerError }] = await Promise.all([
    supabase
      .from("picking_items")
      .select("*, completed:completed_by(id,name), problem_worker:problem_by(id,name)")
      .eq("job_id", job.id)
      .order("location_sort_1", { ascending: true })
      .order("location_sort_2", { ascending: true })
      .order("sequence", { ascending: true }),
    supabase
      .from("activity_logs")
      .select("*, worker:worker_id(id,name), item:item_id(product_name, option_name, location)")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("workers").select("id,name,role,is_active").eq("is_active", true).order("created_at", { ascending: true })
  ]);
  if (itemError) return fail(itemError.message, 500);
  if (logError) return fail(logError.message, 500);
  if (workerError) return fail(workerError.message, 500);

  const total = items.length;
  const done = items.filter((item) => item.status === "done").length;
  const problem = items.filter((item) => item.status === "problem").length;
  const remain = total - done - problem;
  const reasonCounts = Object.fromEntries(PROBLEM_REASONS.map((reason) => [reason, 0]));
  const problemItems = items
    .filter((item) => item.status === "problem")
    .map((item) => {
      if (reasonCounts[item.problem_reason] !== undefined) reasonCounts[item.problem_reason] += 1;
      return item;
    });

  const workerMap = new Map((workers || []).map((worker) => [worker.id, { ...worker, done: 0, lastAt: null }]));
  for (const item of items) {
    if (item.status === "done" && item.completed_by) {
      const worker = workerMap.get(item.completed_by) || { id: item.completed_by, name: item.completed?.name || "미확인", done: 0, lastAt: null };
      worker.done += 1;
      if (toTime(item.completed_at) > toTime(worker.lastAt)) worker.lastAt = item.completed_at;
      workerMap.set(item.completed_by, worker);
    }
  }
  for (const log of logs || []) {
    if (!log.worker_id) continue;
    const worker = workerMap.get(log.worker_id) || { id: log.worker_id, name: log.worker?.name || "미확인", done: 0, lastAt: null };
    if (toTime(log.created_at) > toTime(worker.lastAt)) worker.lastAt = log.created_at;
    workerMap.set(log.worker_id, worker);
  }
  const workerStats = Array.from(workerMap.values())
    .filter((worker) => worker.done > 0 || worker.lastAt)
    .map((worker) => ({
      id: worker.id,
      name: worker.name,
      done: worker.done,
      percent: total ? Math.round((worker.done / total) * 100) : 0,
      lastAt: worker.lastAt
    }))
    .sort((a, b) => b.done - a.done || toTime(b.lastAt) - toTime(a.lastAt));

  return json({
    job,
    items,
    summary: { total, done, remain, problem, percent: total ? Math.round((done / total) * 100) : 0 },
    workerStats,
    recentLogs: (logs || []).slice(0, 10),
    problemItems,
    reasonCounts
  });
}
