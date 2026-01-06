-- Migration: Add marks and audio_url columns to reading_feedback table
-- Purpose: Enable marks and audio feedback for reading submissions, matching speaking module
-- Date: February 2025

-- ==============================================
-- 1. ADD MARKS COLUMN
-- ==============================================

-- Add marks column (nullable)
ALTER TABLE public.reading_feedback 
ADD COLUMN IF NOT EXISTS marks INTEGER NULL;

-- ==============================================
-- 2. ADD AUDIO_URL COLUMN
-- ==============================================

-- Add audio_url column (nullable)
ALTER TABLE public.reading_feedback 
ADD COLUMN IF NOT EXISTS audio_url TEXT NULL;

-- ==============================================
-- 3. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.reading_feedback.marks IS 'Marks awarded by the teacher for the reading submission.';

COMMENT ON COLUMN public.reading_feedback.audio_url IS 'URL to audio feedback file uploaded by the teacher.';

-- ==============================================
-- 4. ADD CONSTRAINT FOR MARKS
-- ==============================================

-- Add check constraint for marks (must be >= 0)
ALTER TABLE public.reading_feedback
DROP CONSTRAINT IF EXISTS reading_feedback_marks_check;

ALTER TABLE public.reading_feedback
ADD CONSTRAINT reading_feedback_marks_check
CHECK (marks IS NULL OR marks >= 0);

-- ==============================================
-- 5. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Reading feedback now supports marks and audio feedback, matching speaking module





