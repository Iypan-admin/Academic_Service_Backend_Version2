-- Migration: Create Speaking Module Tables
-- Purpose: Enable Speaking content management for courses (parallel to Listening module)
-- Date: January 2025

-- ==============================================
-- 1. CREATE SPEAKING_MATERIALS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.speaking_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    instruction TEXT,
    content_text TEXT NOT NULL, -- Extracted text content from file or direct input
    original_file_url TEXT, -- URL to original file if uploaded (PDF/DOCX/TXT)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES public.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comments
COMMENT ON TABLE public.speaking_materials IS 'Stores speaking module content (text materials) for courses';
COMMENT ON COLUMN public.speaking_materials.id IS 'Unique identifier for speaking material';
COMMENT ON COLUMN public.speaking_materials.course_id IS 'Reference to the course this material belongs to';
COMMENT ON COLUMN public.speaking_materials.title IS 'Title of the speaking lesson';
COMMENT ON COLUMN public.speaking_materials.instruction IS 'Instructions for students';
COMMENT ON COLUMN public.speaking_materials.content_text IS 'Text content for students to read and record';
COMMENT ON COLUMN public.speaking_materials.original_file_url IS 'URL to original file if uploaded (for reference)';

-- ==============================================
-- 2. CREATE SPEAKING_BATCH_MAP TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.speaking_batch_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    speaking_material_id UUID NOT NULL REFERENCES public.speaking_materials(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    tutor_status TEXT DEFAULT 'pending' CHECK (tutor_status IN ('pending', 'completed')),
    student_visible BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one mapping per material per batch
    UNIQUE(speaking_material_id, batch_id)
);

-- Add comments
COMMENT ON TABLE public.speaking_batch_map IS 'Maps speaking materials to batches with tutor completion status';
COMMENT ON COLUMN public.speaking_batch_map.id IS 'Unique identifier for the mapping';
COMMENT ON COLUMN public.speaking_batch_map.speaking_material_id IS 'Reference to the speaking material';
COMMENT ON COLUMN public.speaking_batch_map.batch_id IS 'Reference to the batch';
COMMENT ON COLUMN public.speaking_batch_map.tutor_status IS 'Tutor completion status: pending or completed';
COMMENT ON COLUMN public.speaking_batch_map.student_visible IS 'Whether students can see this material';
COMMENT ON COLUMN public.speaking_batch_map.completed_at IS 'Timestamp when tutor marked as completed';

-- ==============================================
-- 3. CREATE SPEAKING_ATTEMPTS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.speaking_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    speaking_material_id UUID NOT NULL REFERENCES public.speaking_materials(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    audio_url TEXT NOT NULL, -- URL to student's recorded audio
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')), -- draft = re-recordable, submitted = locked
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Allow multiple draft attempts but only one submitted attempt
    UNIQUE(student_id, speaking_material_id, batch_id, status)
);

-- Add comments
COMMENT ON TABLE public.speaking_attempts IS 'Stores student speaking attempts (audio recordings)';
COMMENT ON COLUMN public.speaking_attempts.id IS 'Unique identifier for the attempt';
COMMENT ON COLUMN public.speaking_attempts.student_id IS 'Reference to the student';
COMMENT ON COLUMN public.speaking_attempts.speaking_material_id IS 'Reference to the speaking material';
COMMENT ON COLUMN public.speaking_attempts.batch_id IS 'Reference to the batch';
COMMENT ON COLUMN public.speaking_attempts.audio_url IS 'URL to the student audio recording';
COMMENT ON COLUMN public.speaking_attempts.status IS 'Status: draft (re-recordable) or submitted (locked)';
COMMENT ON COLUMN public.speaking_attempts.submitted_at IS 'Timestamp when student submitted the final audio';

-- ==============================================
-- 4. CREATE SPEAKING_FEEDBACK TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.speaking_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.speaking_attempts(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.users(id),
    remarks TEXT NOT NULL, -- Teacher's feedback/remarks
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One feedback per attempt (can be updated)
    UNIQUE(attempt_id)
);

-- Add comments
COMMENT ON TABLE public.speaking_feedback IS 'Stores teacher feedback for student speaking attempts';
COMMENT ON COLUMN public.speaking_feedback.id IS 'Unique identifier for the feedback';
COMMENT ON COLUMN public.speaking_feedback.attempt_id IS 'Reference to the speaking attempt';
COMMENT ON COLUMN public.speaking_feedback.teacher_id IS 'Reference to the teacher who provided feedback';
COMMENT ON COLUMN public.speaking_feedback.remarks IS 'Teacher feedback and remarks';

-- ==============================================
-- 5. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Indexes for speaking_materials
CREATE INDEX IF NOT EXISTS idx_speaking_materials_course_id ON public.speaking_materials(course_id);
CREATE INDEX IF NOT EXISTS idx_speaking_materials_created_at ON public.speaking_materials(created_at);

-- Indexes for speaking_batch_map
CREATE INDEX IF NOT EXISTS idx_speaking_batch_map_material_id ON public.speaking_batch_map(speaking_material_id);
CREATE INDEX IF NOT EXISTS idx_speaking_batch_map_batch_id ON public.speaking_batch_map(batch_id);
CREATE INDEX IF NOT EXISTS idx_speaking_batch_map_tutor_status ON public.speaking_batch_map(tutor_status);
CREATE INDEX IF NOT EXISTS idx_speaking_batch_map_student_visible ON public.speaking_batch_map(student_visible);

-- Indexes for speaking_attempts
CREATE INDEX IF NOT EXISTS idx_speaking_attempts_student_id ON public.speaking_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_speaking_attempts_material_id ON public.speaking_attempts(speaking_material_id);
CREATE INDEX IF NOT EXISTS idx_speaking_attempts_batch_id ON public.speaking_attempts(batch_id);
CREATE INDEX IF NOT EXISTS idx_speaking_attempts_status ON public.speaking_attempts(status);
CREATE INDEX IF NOT EXISTS idx_speaking_attempts_submitted_at ON public.speaking_attempts(submitted_at);

-- Indexes for speaking_feedback
CREATE INDEX IF NOT EXISTS idx_speaking_feedback_attempt_id ON public.speaking_feedback(attempt_id);
CREATE INDEX IF NOT EXISTS idx_speaking_feedback_teacher_id ON public.speaking_feedback(teacher_id);

-- ==============================================
-- 6. CREATE FUNCTION TO AUTO-LINK MATERIALS TO BATCHES
-- ==============================================

-- Function to automatically link speaking materials to all batches with the same course
CREATE OR REPLACE FUNCTION auto_link_speaking_to_batches()
RETURNS TRIGGER AS $$
BEGIN
    -- When new speaking material is created, link it to all batches with the same course_id
    INSERT INTO public.speaking_batch_map (speaking_material_id, batch_id, tutor_status, student_visible)
    SELECT 
        NEW.id,
        b.batch_id,
        'pending',
        false
    FROM public.batches b
    WHERE b.course_id = NEW.course_id
    ON CONFLICT (speaking_material_id, batch_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-link materials to batches
DROP TRIGGER IF EXISTS trigger_auto_link_speaking_to_batches ON public.speaking_materials;
CREATE TRIGGER trigger_auto_link_speaking_to_batches
    AFTER INSERT ON public.speaking_materials
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_speaking_to_batches();

-- ==============================================
-- 7. GRANT PERMISSIONS
-- ==============================================

-- Grant permissions for authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaking_materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaking_batch_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaking_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaking_feedback TO authenticated;
GRANT EXECUTE ON FUNCTION auto_link_speaking_to_batches() TO authenticated;

-- ==============================================
-- 8. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- All tables, indexes, functions, and triggers have been created
-- The Speaking module is now ready for use

















