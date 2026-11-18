import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }
  const secret = Deno.env.get('DAILY_PAYOUT_SECRET')
  const auth = req.headers.get('Authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data, error } = await supabase.rpc('run_daily_payout')
  if (error) return new Response(error.message, { status: 500 })
  return Response.json(data)
})
