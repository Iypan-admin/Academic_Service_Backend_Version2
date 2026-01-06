-- Migration: Add marks column to speaking_feedback table
-- Purpose: Allow teachers to provide marks (up to max_marks) when giving feedback
-- Date: February 2025

-- ==============================================
-- 1. ADD MARKS COLUMN
-- ==============================================

-- Add marks column (nullable, as existing feedback may not have marks)
ALTER TABLE public.speaking_feedback 
ADD COLUMN IF NOT EXISTS marks INTEGER;

-- ==============================================
-- 2. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.speaking_feedback.marks IS 'Marks given by teacher (0 to max_marks). Must not exceed max_marks from speaking_materials.';

-- ==============================================
-- 3. ADD CHECK CONSTRAINT
-- ==============================================

-- Add constraint to ensure marks are non-negative
-- Note: We can't add a constraint to check against max_marks directly in the table
-- as it requires joining with speaking_materials. This validation will be done in the application layer.
ALTER TABLE public.speaking_feedback
ADD CONSTRAINT speaking_feedback_marks_check CHECK (marks IS NULL OR marks >= 0);

-- ==============================================
-- 4. CREATE INDEX FOR PERFORMANCE (optional)
-- ==============================================

-- Index not strictly necessary for marks, but can be useful for queries
CREATE INDEX IF NOT EXISTS idx_speaking_feedback_marks ON public.speaking_feedback(marks) WHERE marks IS NOT NULL;

-- ==============================================
-- 5. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Teachers can now provide marks (0 to max_marks) when giving feedback on speaking attempts


