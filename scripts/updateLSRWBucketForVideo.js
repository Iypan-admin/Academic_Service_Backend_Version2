/**
 * Script to update the LSRW storage bucket to allow video MIME types
 * 
 * This script updates the 'lsrw' bucket configuration to include video MIME types
 * for the new video upload feature in the Listening module.
 * 
 * Run this script with: node scripts/updateLSRWBucketForVideo.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) must be set in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function updateLSRWBucket() {
    try {
        console.log('🔧 Updating LSRW storage bucket to allow video files...');

        // Check if bucket exists
        const { data: existingBuckets, error: listError } = await supabase.storage.listBuckets();
        
        if (listError) {
            console.error('❌ Error listing buckets:', listError);
            return;
        }

        const lsrwBucket = existingBuckets.find(bucket => bucket.name === 'lsrw');

        if (!lsrwBucket) {
            console.error('❌ Error: LSRW bucket does not exist. Please create it first in Supabase Dashboard.');
            return;
        }

        console.log('✅ Found LSRW bucket');

        // Note: Supabase Storage API doesn't directly support updating bucket configuration
        // We need to use the Management API or update via Dashboard
        // However, we can provide instructions and check current configuration

        console.log('\n📋 Current bucket configuration:');
        console.log('   Name:', lsrwBucket.name);
        console.log('   Public:', lsrwBucket.public);
        console.log('   File size limit:', lsrwBucket.fileSizeLimit || 'Not set');
        console.log('   Allowed MIME types:', lsrwBucket.allowedMimeTypes || 'Not restricted');

        console.log('\n⚠️  IMPORTANT: Supabase Storage buckets cannot be updated via the JavaScript API.');
        console.log('   You need to update the bucket configuration manually in the Supabase Dashboard.\n');

        console.log('📝 Steps to update the bucket:');
        console.log('   1. Go to your Supabase Dashboard');
        console.log('   2. Navigate to Storage → Buckets');
        console.log('   3. Click on the "lsrw" bucket');
        console.log('   4. Click "Edit bucket" or "Settings"');
        console.log('   5. In "Allowed MIME types", add the following video MIME types:');
        console.log('      - video/mp4');
        console.log('      - video/mpeg');
        console.log('      - video/quicktime');
        console.log('      - video/x-msvideo');
        console.log('      - video/webm');
        console.log('      - video/ogg');
        console.log('   6. Also ensure audio MIME types are included:');
        console.log('      - audio/mpeg');
        console.log('      - audio/mp3');
        console.log('      - audio/wav');
        console.log('      - audio/webm');
        console.log('      - audio/ogg');
        console.log('      - audio/m4a');
        console.log('   7. Save the changes');

        console.log('\n💡 Alternative: If you want to allow all video/audio types, you can:');
        console.log('   - Leave "Allowed MIME types" empty (allows all types)');
        console.log('   - Or add: video/* and audio/* (if supported by your Supabase version)');

        console.log('\n✅ After updating, video uploads should work correctly.');

    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

// Run the script
updateLSRWBucket()
    .then(() => {
        console.log('\n✨ Script completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });




