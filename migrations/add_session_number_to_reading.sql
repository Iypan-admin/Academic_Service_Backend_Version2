-- Migration: Add session_number to reading_materials table for Reading Module
-- Purpose: Enable session ordering and reordering for reading materials
-- Date: February 2025

-- ==============================================
-- 1. ADD SESSION_NUMBER COLUMN
-- ==============================================

-- Add session_number column (nullable initially, will be populated for reading module)
ALTER TABLE public.reading_materials 
ADD COLUMN IF NOT EXISTS session_number INTEGER;

-- ==============================================
-- 2. ADD COMMENTS
-- ==============================================

COMMENT ON COLUMN public.reading_materials.session_number IS 'Session order number for reading materials. Auto-assigned based on upload count per course. Can be reordered via drag-and-drop.';

-- ==============================================
-- 3. UPDATE EXISTING RECORDS
-- ==============================================

-- For existing reading materials, assign session numbers based on created_at order
-- This ensures existing data has session numbers
DO $$
DECLARE
    course_record RECORD;
    session_counter INTEGER;
    material_record RECORD;
BEGIN
    -- Loop through each course
    FOR course_record IN 
        SELECT DISTINCT course_id 
        FROM public.reading_materials 
        WHERE (session_number IS NULL OR session_number = 0)
    LOOP
        session_counter := 1;
        
        -- Assign session numbers based on created_at order (oldest first = Session 1)
        FOR material_record IN
            SELECT id 
            FROM public.reading_materials 
            WHERE course_id = course_record.course_id 
            AND (session_number IS NULL OR session_number = 0)
            ORDER BY created_at ASC
        LOOP
            UPDATE public.reading_materials
            SET session_number = session_counter
            WHERE id = material_record.id;
            
            session_counter := session_counter + 1;
        END LOOP;
    END LOOP;
END $$;

-- ==============================================
-- 4. CREATE INDEX FOR PERFORMANCE
-- ==============================================

CREATE INDEX IF NOT EXISTS idx_reading_materials_session_number ON public.reading_materials(course_id, session_number);

-- ==============================================
-- 5. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- Reading materials now have session_number for ordering and reordering





