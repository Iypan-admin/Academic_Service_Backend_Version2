-- Migration: Add max_marks column to reading_materials table
-- Purpose: Enable max marks tracking for reading materials
-- Date: February 2025

-- ==============================================
-- 1. ADD MAX_MARKS COLUMN
-- ==============================================

-- Add max_marks column (nullable, default 0)
ALTER TABLE public.reading_materials 
ADD COLUMN IF NOT EXISTS max_marks INTEGER DEFAULT 0;

-- ==============================================
-- 2. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.reading_materials.max_marks IS 'Maximum marks for the reading material. Used for grading and assessment.';

-- ==============================================
-- 3. UPDATE EXISTING RECORDS (Optional)
-- ==============================================

-- Set default value for existing records that might have NULL
UPDATE public.reading_materials 
SET max_marks = 0 
WHERE max_marks IS NULL;

-- ==============================================
-- 4. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Reading materials now have max_marks column for assessment tracking





