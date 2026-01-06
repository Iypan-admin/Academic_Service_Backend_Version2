-- Migration: Add verification fields to lsrw_student_answers table
-- Purpose: Enable tutor verification before students can see their marks
-- Date: January 2025

-- Add verification status fields
ALTER TABLE public.lsrw_student_answers
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

-- Add comments
COMMENT ON COLUMN public.lsrw_student_answers.verified IS 'Whether tutor has verified and released the marks';
COMMENT ON COLUMN public.lsrw_student_answers.verified_by IS 'Reference to the tutor who verified';
COMMENT ON COLUMN public.lsrw_student_answers.verified_at IS 'Timestamp when marks were verified and released';

-- Create index for verification status
CREATE INDEX IF NOT EXISTS idx_lsrw_student_answers_verified ON public.lsrw_student_answers(verified);
CREATE INDEX IF NOT EXISTS idx_lsrw_student_answers_batch_verified ON public.lsrw_student_answers(batch_id, verified);











