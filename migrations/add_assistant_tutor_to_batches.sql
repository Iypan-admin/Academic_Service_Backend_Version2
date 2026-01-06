-- Migration: Add Assistant Tutor to Batches Table
-- Purpose: Allow batches to have an optional assistant tutor with same permissions as main teacher
-- Date: January 2025

-- Add assistant_tutor column to batches table (optional, can be NULL)
ALTER TABLE public.batches 
ADD COLUMN IF NOT EXISTS assistant_tutor UUID REFERENCES public.teachers(teacher_id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_batches_assistant_tutor 
ON public.batches(assistant_tutor);

-- Add comment for documentation
COMMENT ON COLUMN public.batches.assistant_tutor IS 'Optional assistant tutor for the batch. Has same permissions as main teacher.';

