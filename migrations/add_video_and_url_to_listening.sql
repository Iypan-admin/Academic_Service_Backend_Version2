-- Migration: Add Video Upload and External Media URL Support to Listening Module
-- Purpose: Enhance listening module to support video files and external media URLs
-- Date: January 2025

-- ==============================================
-- 1. ADD NEW COLUMNS TO LSRW_CONTENT TABLE
-- ==============================================

-- Add video_file_path column
ALTER TABLE public.lsrw_content 
ADD COLUMN IF NOT EXISTS video_file_path TEXT;

-- Add external_media_url column
ALTER TABLE public.lsrw_content 
ADD COLUMN IF NOT EXISTS external_media_url TEXT;

-- Add media_type column with enum constraint
ALTER TABLE public.lsrw_content 
ADD COLUMN IF NOT EXISTS media_type TEXT 
CHECK (media_type IN ('audio', 'video', 'audio_url', 'video_url'));

-- ==============================================
-- 2. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.lsrw_content.video_file_path IS 'URL to the video file in Supabase storage (for listening module)';
COMMENT ON COLUMN public.lsrw_content.external_media_url IS 'External media URL (YouTube, Vimeo, Google Drive, etc.)';
COMMENT ON COLUMN public.lsrw_content.media_type IS 'Type of media: audio (uploaded audio), video (uploaded video), audio_url (external audio URL), video_url (external video URL)';

-- ==============================================
-- 3. UPDATE EXISTING RECORDS
-- ==============================================

-- Set media_type for existing records based on audio_url presence
UPDATE public.lsrw_content 
SET media_type = 'audio' 
WHERE media_type IS NULL 
  AND audio_url IS NOT NULL 
  AND module_type = 'listening';

-- ==============================================
-- 4. CREATE INDEX FOR PERFORMANCE
-- ==============================================

CREATE INDEX IF NOT EXISTS idx_lsrw_content_media_type ON public.lsrw_content(media_type);

-- ==============================================
-- 5. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- The listening module now supports audio files, video files, and external media URLs




