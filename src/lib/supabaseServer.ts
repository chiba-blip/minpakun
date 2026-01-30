import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function createSupabaseServer() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// 互換性のためのエイリアス
export const createServerClient = createSupabaseServer;

