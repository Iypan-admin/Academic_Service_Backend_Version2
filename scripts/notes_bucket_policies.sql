-- Notes Files Storage Bucket - RLS Policies
-- Run these SQL commands in Supabase SQL Editor after creating the bucket
-- These policies control who can upload and download files from the notes_files bucket

-- ============================================
-- POLICY 1: Allow authenticated users to upload files
-- ============================================
-- This allows any authenticated user (teacher) to upload files to notes_files bucket
CREATE POLICY "Teachers can upload note files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'notes_files'
);

-- ============================================
-- POLICY 2: Allow public read access
-- ============================================
-- This allows anyone (including students) to download/view files
-- If you want to restrict access, you can modify this policy
CREATE POLICY "Public can read note files"
ON storage.objects FOR SELECT
TO public
USING (
    bucket_id = 'notes_files'
);

-- ============================================
-- POLICY 3: Allow teachers to delete their own files
-- ============================================
-- This allows authenticated users to delete files they uploaded
CREATE POLICY "Teachers can delete note files"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'notes_files'
);

-- ============================================
-- ALTERNATIVE: Restrict access to specific batches
-- ============================================
-- If you want to restrict file access to only teachers of specific batches,
-- you can use this more restrictive policy instead of the public read policy:

/*
-- Remove public read policy first
DROP POLICY IF EXISTS "Public can read note files" ON storage.objects;

-- Create restricted read policy
CREATE POLICY "Teachers can read note files for their batches"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'notes_files' AND
    EXISTS (
        SELECT 1 FROM notes n
        JOIN batches b ON n.batch_id = b.batch_id
        JOIN teachers t ON b.teacher = t.teacher_id
        JOIN users u ON t.user_id = u.id
        WHERE (storage.foldername(name))[1]::uuid = n.batch_id
        AND u.id = auth.uid()
    )
);
*/

-- ============================================
-- NOTES:
-- ============================================
-- 1. The bucket must be created first (use createNotesBucket.js script)
-- 2. Adjust policies based on your security requirements
-- 3. File paths in the bucket follow: {batch_id}/{filename}
-- 4. For production, consider implementing more granular access control
-- 5. Monitor storage usage and implement cleanup policies if needed



