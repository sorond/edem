import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function callRpc(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data
}

async function selectFrom(table) {
  const { data, error } = await supabase.from(table).select('*')
  if (error) throw error
  return data
}

// get_settings/get_treasury are security-definer RPCs readable before login;
// table reads are allowed for authenticated users by RLS.
export const getSettings = () => callRpc('get_settings')
export const getTreasury = () => callRpc('get_treasury')
export async function getTasks() {
  const tasks = await selectFrom('tasks')
  const { data: reports, error } = await supabase
    .from('reports')
    .select('task_id')
    .eq('status', 'approved')
  if (error) throw error

  const approvedByTask = new Map()
  for (const report of reports ?? []) {
    if (!report.task_id) continue
    approvedByTask.set(report.task_id, (approvedByTask.get(report.task_id) ?? 0) + 1)
  }

  return tasks.map((task) => ({
    ...task,
    approved_count: approvedByTask.get(task.id) ?? 0,
  }))
}
export const getReports = () => selectFrom('reports')
export const getHistory = () => selectFrom('audit_log')
export const getWithdrawals = () => selectFrom('withdrawals')
export const getTaxEvents = () => selectFrom('tax_events')

export default {
  supabase,
  callRpc,
  getSettings,
  getTreasury,
  getTasks,
  getReports,
  getHistory,
  getWithdrawals,
  getTaxEvents,
}
