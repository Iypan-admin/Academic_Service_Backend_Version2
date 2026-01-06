-- Migration: Add audio feedback support to speaking_feedback table
-- This allows teachers to provide feedback as text, audio, or both

-- Add audio_url column to speaking_feedback table
ALTER TABLE public.speaking_feedback 
ADD COLUMN IF NOT EXISTS audio_url TEXT;

-- Update the table comment
COMMENT ON COLUMN public.speaking_feedback.audio_url IS 'Optional audio feedback URL from teacher (voice note or audio feedback)';

-- Migration completed successfully

















