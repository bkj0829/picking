export async function getItemForUpdate(supabase, itemId) {
  const { data, error } = await supabase
    .from("picking_items")
    .select("id, job_id, status, product_name, completed_by, problem_by, quantity, picked_quantity")
    .eq("id", itemId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function logAction(supabase, { item, user, action, previousStatus, newStatus, details }) {
  await supabase.from("activity_logs").insert({
    job_id: item.job_id,
    item_id: item.id,
    worker_id: user.id,
    action,
    previous_status: previousStatus || item.status,
    new_status: newStatus,
    details: details || {}
  });
}
