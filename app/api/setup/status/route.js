import { fail, json } from "../../../../lib/http";
import { envReady, getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function GET() {
  if (!envReady()) return json({ envReady: false, needsSetup: true });
  try {
    const supabase = getSupabaseAdmin();
    const { count, error } = await supabase.from("workers").select("id", { count: "exact", head: true });
    if (error) return fail(error.message, 500);
    return json({ envReady: true, needsSetup: (count || 0) === 0 });
  } catch (error) {
    return fail(error.message, 500);
  }
}
