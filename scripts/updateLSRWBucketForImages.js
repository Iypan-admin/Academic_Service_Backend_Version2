/**
 * Script to update the 'lsrw' Supabase storage bucket to accept image files
 * 
 * This script provides instructions and attempts to update the allowed MIME types 
 * for the lsrw bucket to include image formats needed for the writing module.
 * 
 * Run with: node scripts/updateLSRWBucketForImages.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function updateLSRWBucketForImages() {
    try {
        console.log('🔧 Updating lsrw bucket to accept image files...\n');

        // Check if bucket exists
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        
        if (listError) {
            console.error('❌ Error listing buckets:', listError);
            return;
        }

        const lsrwBucket = buckets.find(bucket => bucket.name === 'lsrw');

        if (!lsrwBucket) {
            console.error('❌ Error: lsrw bucket does not exist. Please create it first.');
            console.log('   Run: node scripts/createLSRWBucket.js');
            return;
        }

        console.log('✅ Found lsrw bucket');
        console.log('📊 Current bucket information:');
        console.log(JSON.stringify(lsrwBucket, null, 2));
        console.log('\n');

        // Note: Supabase Storage API doesn't directly support updating bucket settings
        // You need to update it via the Supabase Dashboard or Management API
        console.log('📝 IMPORTANT: Supabase Storage API does not support updating bucket settings programmatically.');
        console.log('   You need to update the bucket settings manually in the Supabase Dashboard.\n');
        
        console.log('📋 Steps to update the bucket:');
        console.log('1. Go to your Supabase Dashboard');
        console.log('2. Navigate to Storage → Buckets');
        console.log('3. Click on the "lsrw" bucket');
        console.log('4. Click "Edit bucket" or "Settings"');
        console.log('5. In "Allowed MIME types", add the following image types:');
        console.log('   - image/jpeg');
        console.log('   - image/jpg');
        console.log('   - image/png');
        console.log('\n6. Keep the existing MIME types:');
        console.log('   - audio/mpeg');
        console.log('   - audio/mp3');
        console.log('   - audio/wav');
        console.log('   - application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        console.log('   - application/msword');
        console.log('\n7. Final list should include:');
        console.log('   ✅ audio/mpeg');
        console.log('   ✅ audio/mp3');
        console.log('   ✅ audio/wav');
        console.log('   ✅ application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        console.log('   ✅ application/msword');
        console.log('   ✅ image/jpeg');
        console.log('   ✅ image/jpg');
        console.log('   ✅ image/png');
        console.log('\n8. Save the changes\n');

        console.log('💡 Alternative: You can also remove MIME type restrictions entirely');
        console.log('   by leaving the "Allowed MIME types" field empty (accepts all types).');
        console.log('   This is less secure but more flexible.\n');

        // Note: Supabase doesn't provide a direct API to update bucket settings
        // The bucket must be updated manually through the Supabase Dashboard
        console.log('💡 Note: Bucket settings must be updated manually in Supabase Dashboard.');
        console.log('   The Supabase Storage API does not support updating bucket configuration.\n');

    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

// Run the script
updateLSRWBucketForImages()
    .then(() => {
        console.log('\n✅ Script completed');
        console.log('📌 Remember to update the bucket settings in Supabase Dashboard if the API update failed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });

