import { supabase, getSettings } from './api.js'

const ROLE_KEY = 'edem_role'
const EMAIL_SETTING = {
  curator: 'curator_email',
  admin: 'admin_email',
}

export async function signIn(role, password) {
  const emailSetting = EMAIL_SETTING[role]
  if (!emailSetting) throw new Error('Неизвестная роль')

  const settings = await getSettings()
  const email = settings[emailSetting]
  if (!email) throw new Error('Логин не настроен')

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.session) throw new Error('Сессия не создана')

  localStorage.setItem(ROLE_KEY, role)
  return role
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  localStorage.removeItem(ROLE_KEY)
}

// Async: Supabase v2 reads the persisted session via getSession().
export async function getRole() {
  const role = localStorage.getItem(ROLE_KEY)
  if (!role) return null

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    localStorage.removeItem(ROLE_KEY)
    return null
  }
  return role
}
