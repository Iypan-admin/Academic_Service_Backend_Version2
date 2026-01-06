-- Migration: Add session_number to lsrw_content table for Listening Module
-- Purpose: Enable session ordering and reordering for listening materials
-- Date: February 2025

-- ==============================================
-- 1. ADD SESSION_NUMBER COLUMN
-- ==============================================

-- Add session_number column (nullable initially, will be populated for listening module)
ALTER TABLE public.lsrw_content 
ADD COLUMN IF NOT EXISTS session_number INTEGER;

-- ==============================================
-- 2. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.lsrw_content.session_number IS 'Session order number for listening materials. Auto-assigned based on upload count per course. Can be reordered via drag-and-drop.';

-- ==============================================
-- 3. UPDATE EXISTING RECORDS
-- ==============================================

-- For existing listening materials, assign session numbers based on created_at order
-- This ensures existing data has session numbers
DO $$
DECLARE
    course_record RECORD;
    session_counter INTEGER;
    content_record RECORD;
BEGIN
    -- Loop through each course
    FOR course_record IN 
        SELECT DISTINCT course_id 
        FROM public.lsrw_content 
        WHERE module_type = 'listening' 
        AND (session_number IS NULL OR session_number = 0)
    LOOP
        session_counter := 1;
        
        -- Assign session numbers based on created_at order (oldest first = Session 1)
        FOR content_record IN
            SELECT id 
            FROM public.lsrw_content 
            WHERE course_id = course_record.course_id 
            AND module_type = 'listening'
            AND (session_number IS NULL OR session_number = 0)
            ORDER BY created_at ASC
        LOOP
            UPDATE public.lsrw_content
            SET session_number = session_counter
            WHERE id = content_record.id;
            
            session_counter := session_counter + 1;
        END LOOP;
    END LOOP;
END $$;

-- ==============================================
-- 4. CREATE INDEX FOR PERFORMANCE
-- ==============================================

CREATE INDEX IF NOT EXISTS idx_lsrw_content_session_number ON public.lsrw_content(course_id, module_type, session_number);

-- ==============================================
-- 5. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Listening materials now have session_number for ordering and reordering

