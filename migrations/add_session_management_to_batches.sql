-- Migration: Add Session Management to Batches
-- Purpose: Allow batch start to specify total sessions and track session numbers in gmeets
-- Date: January 2025

-- Add total_sessions column to batches table
ALTER TABLE public.batches 
ADD COLUMN IF NOT EXISTS total_sessions INTEGER;

-- Add session_number column to gmeets table for ordering sessions
ALTER TABLE public.gmeets 
ADD COLUMN IF NOT EXISTS session_number INTEGER;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_gmeets_session_number 
ON public.gmeets(batch_id, session_number);

-- Add comments for documentation
COMMENT ON COLUMN public.batches.total_sessions IS 'Total number of sessions planned for this batch. Set when batch starts.';
COMMENT ON COLUMN public.gmeets.session_number IS 'Session number (1, 2, 3, etc.) for ordering sessions within a batch.';

