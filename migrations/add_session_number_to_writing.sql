-- Migration: Add session_number to writing_tasks table for Writing Module
-- Purpose: Enable session ordering and reordering for writing tasks
-- Date: February 2025

-- ==============================================
-- 1. ADD SESSION_NUMBER COLUMN
-- ==============================================

-- Add session_number column (nullable initially, will be populated for writing module)
ALTER TABLE public.writing_tasks 
ADD COLUMN IF NOT EXISTS session_number INTEGER;

-- ==============================================
-- 2. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.writing_tasks.session_number IS 'Session order number for writing tasks. Auto-assigned based on upload count per course. Can be reordered via drag-and-drop.';

-- ==============================================
-- 3. UPDATE EXISTING RECORDS
-- ==============================================

-- For existing writing tasks, assign session numbers based on created_at order
-- This ensures existing data has session numbers
DO $$
DECLARE
    course_record RECORD;
    session_counter INTEGER;
    task_record RECORD;
BEGIN
    -- Loop through each course
    FOR course_record IN 
        SELECT DISTINCT course_id 
        FROM public.writing_tasks 
        WHERE (session_number IS NULL OR session_number = 0)
    LOOP
        session_counter := 1;
        
        -- Assign session numbers based on created_at order (oldest first = Session 1)
        FOR task_record IN
            SELECT id 
            FROM public.writing_tasks 
            WHERE course_id = course_record.course_id 
            AND (session_number IS NULL OR session_number = 0)
            ORDER BY created_at ASC
        LOOP
            UPDATE public.writing_tasks
            SET session_number = session_counter
            WHERE id = task_record.id;
            
            session_counter := session_counter + 1;
        END LOOP;
    END LOOP;
END $$;

-- ==============================================
-- 4. CREATE INDEX FOR PERFORMANCE
-- ==============================================

CREATE INDEX IF NOT EXISTS idx_writing_tasks_session_number ON public.writing_tasks(course_id, session_number);

-- ==============================================
-- 5. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Writing tasks now have session_number for ordering and reordering

