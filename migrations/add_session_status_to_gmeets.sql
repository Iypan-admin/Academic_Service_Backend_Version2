-- Migration: Add Session Status to GMeets
-- Purpose: Allow tracking session status (Scheduled, Completed, Cancelled) with cancellation reason
-- Date: January 2025

-- Add status column to gmeets table
ALTER TABLE public.gmeets 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Completed', 'Cancelled'));

-- Add cancellation_reason column for cancelled sessions
ALTER TABLE public.gmeets 
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_gmeets_status 
ON public.gmeets(batch_id, status);

-- Add comments for documentation
COMMENT ON COLUMN public.gmeets.status IS 'Session status: Scheduled (default), Completed, or Cancelled';
COMMENT ON COLUMN public.gmeets.cancellation_reason IS 'Reason provided when session is cancelled';

