-- Migration: Add max_marks column to writing_tasks table
-- Purpose: Enable max marks tracking for writing tasks
-- Date: February 2025

-- ==============================================
-- 1. ADD MAX_MARKS COLUMN
-- ==============================================

-- Add max_marks column (nullable, default 0)
ALTER TABLE public.writing_tasks 
ADD COLUMN IF NOT EXISTS max_marks INTEGER DEFAULT 0;

-- ==============================================
-- 2. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.writing_tasks.max_marks IS 'Maximum marks for the writing task. Used for grading and assessment.';

-- ==============================================
-- 3. UPDATE EXISTING RECORDS (Optional)
-- ==============================================

-- Set default value for existing records that might have NULL
UPDATE public.writing_tasks 
SET max_marks = 0 
WHERE max_marks IS NULL;

-- ==============================================
-- 4. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Writing tasks now have max_marks column for assessment tracking

