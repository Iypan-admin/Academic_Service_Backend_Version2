/**
 * Script to create the 'notes_files' storage bucket in Supabase
 * Run this script once to set up the storage bucket for notes file uploads
 * 
 * Usage: node scripts/createNotesBucket.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY; // Use service role key for admin operations

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

async function createNotesBucket() {
    try {
        console.log('🔧 Creating notes_files storage bucket...');

        // Check if bucket already exists
        const { data: existingBuckets, error: listError } = await supabase.storage.listBuckets();
        
        if (listError) {
            console.error('❌ Error listing buckets:', listError);
            return;
        }

        const bucketExists = existingBuckets.some(bucket => bucket.name === 'notes_files');

        if (bucketExists) {
            console.log('✅ Bucket "notes_files" already exists');
            console.log('📋 Bucket details:', existingBuckets.find(b => b.name === 'notes_files'));
            return;
        }

        // Create the bucket
        const { data, error } = await supabase.storage.createBucket('notes_files', {
            public: true, // Make bucket public for easier file access
            fileSizeLimit: 10485760, // 10 MB limit per file
            allowedMimeTypes: [
                'application/pdf', // PDF
                'application/msword', // DOC
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
                'application/vnd.ms-powerpoint', // PPT
                'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
                'application/vnd.ms-excel', // XLS
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
                'text/plain' // TXT
            ]
        });

        if (error) {
            console.error('❌ Error creating bucket:', error);
            return;
        }

        console.log('✅ Bucket "notes_files" created successfully!');
        console.log('📋 Bucket details:', data);

        console.log('\n📝 Next steps:');
        console.log('1. The bucket is now ready to use');
        console.log('2. Files will be stored in the format: {batch_id}/{filename}');
        console.log('3. You may want to configure RLS policies in Supabase Dashboard → Storage → Policies');
        console.log('\n💡 Tip: If you need RLS policies, run the SQL commands from: scripts/notes_bucket_policies.sql');

    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

// Run the script
createNotesBucket()
    .then(() => {
        console.log('\n✨ Script completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });



