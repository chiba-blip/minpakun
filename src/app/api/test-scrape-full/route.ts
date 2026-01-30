import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { getConnectors, getConnector } from '@/lib/scraper/connectors';

/**
 * デバッグ用：フルスクレイプテスト
 */
export async function GET() {
  const debug: Record<string, unknown> = {};
  
  try {
    const supabase = await createSupabaseServer();
    
    // 1. portal_sites確認
    const { data: sites, error: sitesError } = await supabase
      .from('portal_sites')
      .select('*')
      .eq('enabled', true);
    
    debug.sitesError = sitesError?.message;
    debug.sites = sites?.map(s => ({ id: s.id, key: s.key, name: s.name, enabled: s.enabled }));
    
    if (!sites || sites.length === 0) {
      debug.message = 'No enabled sites';
      return NextResponse.json(debug);
    }
    
    // 2. scrape_configs確認
    const { data: configs, error: configError } = await supabase
      .from('scrape_configs')
      .select('*')
      .eq('enabled', true)
      .limit(1)
      .single();
    
    debug.configError = configError?.message;
    debug.configs = configs;
    
    // 3. コネクター確認
    const enabledKeys = sites.map(s => s.key);
    debug.enabledKeys = enabledKeys;
    
    const connectors = getConnectors(enabledKeys);
    debug.connectorsFound = connectors.map(c => c.key);
    
    // 4. アットホームで直接テスト
    const athomeConnector = getConnector('athome');
    debug.athomeConnectorExists = !!athomeConnector;
    
    if (athomeConnector) {
      try {
        const candidates = await athomeConnector.search({
          areas: [],
          propertyTypes: [],
          maxPages: 1, // 1ページだけ
        });
        debug.athomeCandidates = candidates.length;
        debug.athomeSampleUrls = candidates.slice(0, 5).map(c => c.url);
      } catch (e) {
        debug.athomeSearchError = String(e);
      }
    }
    
    debug.message = 'Debug complete';
    return NextResponse.json(debug);
  } catch (error) {
    debug.error = String(error);
    return NextResponse.json(debug, { status: 500 });
  }
}
