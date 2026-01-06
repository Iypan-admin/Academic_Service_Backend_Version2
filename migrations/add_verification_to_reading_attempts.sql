-- Migration: Add verification fields to reading_attempts table
-- Purpose: Enable teacher verification before students can see their marks
-- Date: January 2025

-- Add verification status fields
ALTER TABLE public.reading_attempts
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

-- Add comments
COMMENT ON COLUMN public.reading_attempts.verified IS 'Whether teacher has verified and released the marks';
COMMENT ON COLUMN public.reading_attempts.verified_by IS 'Reference to the teacher who verified';
COMMENT ON COLUMN public.reading_attempts.verified_at IS 'Timestamp when marks were verified and released';

-- Create index for verification status
CREATE INDEX IF NOT EXISTS idx_reading_attempts_verified ON public.reading_attempts(verified);
CREATE INDEX IF NOT EXISTS idx_reading_attempts_batch_verified ON public.reading_attempts(batch_id, verified);

















