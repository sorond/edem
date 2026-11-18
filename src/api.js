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
export const getTasks = () => selectFrom('tasks')
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
