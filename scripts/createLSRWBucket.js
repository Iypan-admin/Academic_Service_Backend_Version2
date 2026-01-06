const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

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

async function createLSRWBucket() {
    try {
        console.log('🚀 Creating LSRW storage bucket...');

        // Check if bucket already exists
        const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
        
        if (listError) {
            throw new Error(`Failed to list buckets: ${listError.message}`);
        }

        const bucketExists = buckets.some(bucket => bucket.name === 'lsrw');

        if (bucketExists) {
            console.log('✅ LSRW bucket already exists');
            return;
        }

        // Create the bucket
        const { data, error } = await supabaseAdmin.storage.createBucket('lsrw', {
            public: true, // Make bucket public for easy access
            fileSizeLimit: 52428800, // 50MB limit
            allowedMimeTypes: [
                'audio/mpeg',
                'audio/mp3',
                'audio/wav',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/msword'
            ]
        });

        if (error) {
            throw new Error(`Failed to create bucket: ${error.message}`);
        }

        console.log('✅ LSRW bucket created successfully');
        console.log('📁 Bucket structure: lsrw/{language}/{course_code}/listening/');

    } catch (error) {
        console.error('❌ Error creating LSRW bucket:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    createLSRWBucket()
        .then(() => {
            console.log('✨ LSRW bucket setup complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Failed to setup LSRW bucket:', error);
            process.exit(1);
        });
}

module.exports = createLSRWBucket;












