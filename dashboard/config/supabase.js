const dotenvResult = require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn('⚠️  Warning: Missing Supabase environment variables. Dashboard features requiring database access will be limited.');
  console.warn('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.');
  module.exports = null;
} else {
  // A local .env must declare its target; a production one needs RUMI_ALLOW_PROD=1 per run.
  require('../../bot/shared/config/env-target-guard').assertEnvTarget({ fileVars: dotenvResult && dotenvResult.parsed });

  // Create Supabase client with service role key (for full database access)
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  module.exports = supabase;
}
