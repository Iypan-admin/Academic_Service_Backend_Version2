const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('⚠️  WARNING: Supabase environment variables are missing!');
    console.error('   Please ensure SUPABASE_URL and SUPABASE_KEY are set in your .env file');
    console.error('   Database operations will fail until this is configured.');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Admin client for file uploads (requires service role key)
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

module.exports = supabase;
module.exports.supabaseAdmin = supabaseAdmin;
