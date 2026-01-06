-- Migration: Add marks and audio_url columns to writing_feedback table
-- Purpose: Enable marks and audio feedback for writing submissions, matching speaking module
-- Date: February 2025

-- ==============================================
-- 1. ADD MARKS COLUMN
-- ==============================================

-- Add marks column (nullable)
ALTER TABLE public.writing_feedback 
ADD COLUMN IF NOT EXISTS marks INTEGER NULL;

-- ==============================================
-- 2. ADD AUDIO_URL COLUMN
-- ==============================================

-- Add audio_url column (nullable)
ALTER TABLE public.writing_feedback 
ADD COLUMN IF NOT EXISTS audio_url TEXT NULL;

-- ==============================================
-- 3. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.writing_feedback.marks IS 'Marks awarded by the teacher for the writing submission.';

COMMENT ON COLUMN public.writing_feedback.audio_url IS 'URL to audio feedback file uploaded by the teacher.';

-- ==============================================
-- 4. ADD CONSTRAINT FOR MARKS
-- ==============================================

-- Add check constraint for marks (must be >= 0)
ALTER TABLE public.writing_feedback
DROP CONSTRAINT IF EXISTS writing_feedback_marks_check;

ALTER TABLE public.writing_feedback
ADD CONSTRAINT writing_feedback_marks_check
CHECK (marks IS NULL OR marks >= 0);

-- ==============================================
-- 5. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Writing feedback now supports marks and audio feedback, matching speaking module

