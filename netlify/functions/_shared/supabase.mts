import { createClient } from '@supabase/supabase-js';

/**
 * Netlify Functions用 Supabaseクライアント（service_role）
 * RLSをバイパスしてフルアクセス可能
 */
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
