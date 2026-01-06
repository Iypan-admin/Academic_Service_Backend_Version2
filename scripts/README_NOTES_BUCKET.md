# Notes Files Storage Bucket Setup

This guide explains how to create and configure the `notes_files` storage bucket for the notes feature.

## Prerequisites

1. Supabase project set up
2. Environment variables configured:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`)

## Method 1: Using the Node.js Script (Recommended)

1. Navigate to the Academic Service backend directory:
   ```bash
   cd Academic_Service_backend-main
   ```

2. Run the bucket creation script:
   ```bash
   node scripts/createNotesBucket.js
   ```

3. The script will:
   - Check if the bucket already exists
   - Create the bucket if it doesn't exist
   - Configure file size limits (10MB) and allowed MIME types

## Method 2: Using Supabase Dashboard

1. Go to your Supabase Dashboard
2. Navigate to **Storage** → **Buckets**
3. Click **New bucket**
4. Configure the bucket:
   - **Name**: `notes_files`
   - **Public**: Yes (for easier file access)
   - **File size limit**: 10 MB (10485760 bytes)
   - **Allowed MIME types**: 
     - `application/pdf`
     - `application/msword`
     - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
     - `application/vnd.ms-powerpoint`
     - `application/vnd.openxmlformats-officedocument.presentationml.presentation`
     - `application/vnd.ms-excel`
     - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
     - `text/plain`

## Setting Up RLS Policies (Optional but Recommended)

After creating the bucket, you can set up Row Level Security (RLS) policies:

1. Go to Supabase Dashboard → **SQL Editor**
2. Copy and paste the SQL commands from `scripts/notes_bucket_policies.sql`
3. Run the SQL commands

### Policy Options:

- **Public Read Access**: Anyone can download files (simpler, less secure)
- **Restricted Access**: Only teachers of specific batches can access files (more secure)

Choose based on your security requirements.

## Verifying the Setup

After creating the bucket, you can verify it by:

1. Checking the Supabase Dashboard → Storage → Buckets
2. The `notes_files` bucket should appear in the list
3. Try uploading a note with a file from the frontend

## Troubleshooting

### Error: "Bucket not found"
- Make sure you've run the bucket creation script
- Check that the bucket name is exactly `notes_files`
- Verify your Supabase credentials are correct

### Error: "Permission denied"
- Check that `SUPABASE_SERVICE_ROLE_KEY` is set correctly
- Ensure you're using the service role key (not anon key) for bucket creation

### Files not uploading
- Check file size (must be ≤ 10MB)
- Verify file type is in the allowed MIME types list
- Check browser console and server logs for specific errors

## File Structure

Files are stored in the bucket with the following structure:
```
notes_files/
  └── {batch_id}/
      ├── {timestamp}_{random}.pdf
      ├── {timestamp}_{random}.docx
      └── ...
```

This structure:
- Organizes files by batch
- Prevents filename conflicts
- Makes it easier to manage and clean up files



