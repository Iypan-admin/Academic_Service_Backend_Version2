-- Migration: Create Reading Module Tables
-- Purpose: Enable Reading content management for courses (parallel to Listening/Speaking modules)
-- Date: January 2025

-- ==============================================
-- 1. CREATE READING_MATERIALS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.reading_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    instruction TEXT,
    file_url TEXT, -- Supabase storage URL to original file (for reference only)
    content_text TEXT NOT NULL, -- Extracted text content from file
    questions JSONB NOT NULL, -- Array of 5 MCQs: [{question, optionA, optionB, optionC, optionD, correct_answer}]
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES public.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comments
COMMENT ON TABLE public.reading_materials IS 'Stores reading module content (text materials and MCQs) for courses';
COMMENT ON COLUMN public.reading_materials.id IS 'Unique identifier for reading material';
COMMENT ON COLUMN public.reading_materials.course_id IS 'Reference to the course this material belongs to';
COMMENT ON COLUMN public.reading_materials.title IS 'Title of the reading lesson';
COMMENT ON COLUMN public.reading_materials.instruction IS 'Instructions for students';
COMMENT ON COLUMN public.reading_materials.file_url IS 'URL to original file in Supabase storage (for reference, not shown to teacher/student)';
COMMENT ON COLUMN public.reading_materials.content_text IS 'Extracted text content shown to teacher and student';
COMMENT ON COLUMN public.reading_materials.questions IS 'Array of 5 MCQ questions in JSONB format';

-- ==============================================
-- 2. CREATE READING_BATCH_MAP TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.reading_batch_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_material_id UUID NOT NULL REFERENCES public.reading_materials(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    tutor_status TEXT DEFAULT 'pending' CHECK (tutor_status IN ('pending', 'completed')),
    student_visible BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one mapping per material per batch
    UNIQUE(reading_material_id, batch_id)
);

-- Add comments
COMMENT ON TABLE public.reading_batch_map IS 'Maps reading materials to batches with tutor completion status';
COMMENT ON COLUMN public.reading_batch_map.id IS 'Unique identifier for the mapping';
COMMENT ON COLUMN public.reading_batch_map.reading_material_id IS 'Reference to reading material';
COMMENT ON COLUMN public.reading_batch_map.batch_id IS 'Reference to batch';
COMMENT ON COLUMN public.reading_batch_map.tutor_status IS 'Tutor review status: pending or completed';
COMMENT ON COLUMN public.reading_batch_map.student_visible IS 'Whether students can see this material';

-- ==============================================
-- 3. CREATE READING_ATTEMPTS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.reading_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_material_id UUID NOT NULL REFERENCES public.reading_materials(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    answers JSONB NOT NULL, -- {question1: 'A', question2: 'B', ...}
    score INTEGER NOT NULL DEFAULT 0,
    max_score INTEGER NOT NULL DEFAULT 5, -- Always 5 questions
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comments
COMMENT ON TABLE public.reading_attempts IS 'Stores student reading quiz attempts';
COMMENT ON COLUMN public.reading_attempts.id IS 'Unique identifier for the attempt';
COMMENT ON COLUMN public.reading_attempts.reading_material_id IS 'Reference to reading material';
COMMENT ON COLUMN public.reading_attempts.student_id IS 'Reference to student';
COMMENT ON COLUMN public.reading_attempts.batch_id IS 'Reference to batch';
COMMENT ON COLUMN public.reading_attempts.answers IS 'Student answers in JSONB format';
COMMENT ON COLUMN public.reading_attempts.score IS 'Calculated score out of 5';

-- ==============================================
-- 4. CREATE READING_FEEDBACK TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.reading_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.reading_attempts(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    remarks TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One feedback per attempt
    UNIQUE(attempt_id)
);

-- Add comments
COMMENT ON TABLE public.reading_feedback IS 'Stores teacher feedback for student reading attempts';
COMMENT ON COLUMN public.reading_feedback.id IS 'Unique identifier for the feedback';
COMMENT ON COLUMN public.reading_feedback.attempt_id IS 'Reference to the reading attempt';
COMMENT ON COLUMN public.reading_feedback.teacher_id IS 'Reference to the teacher who provided feedback';
COMMENT ON COLUMN public.reading_feedback.remarks IS 'Teacher feedback and remarks';

-- ==============================================
-- 5. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Indexes for reading_materials
CREATE INDEX IF NOT EXISTS idx_reading_materials_course_id ON public.reading_materials(course_id);
CREATE INDEX IF NOT EXISTS idx_reading_materials_created_at ON public.reading_materials(created_at);

-- Indexes for reading_batch_map
CREATE INDEX IF NOT EXISTS idx_reading_batch_map_material_id ON public.reading_batch_map(reading_material_id);
CREATE INDEX IF NOT EXISTS idx_reading_batch_map_batch_id ON public.reading_batch_map(batch_id);
CREATE INDEX IF NOT EXISTS idx_reading_batch_map_tutor_status ON public.reading_batch_map(tutor_status);
CREATE INDEX IF NOT EXISTS idx_reading_batch_map_student_visible ON public.reading_batch_map(student_visible);

-- Indexes for reading_attempts
CREATE INDEX IF NOT EXISTS idx_reading_attempts_student_id ON public.reading_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_reading_attempts_material_id ON public.reading_attempts(reading_material_id);
CREATE INDEX IF NOT EXISTS idx_reading_attempts_batch_id ON public.reading_attempts(batch_id);
CREATE INDEX IF NOT EXISTS idx_reading_attempts_submitted_at ON public.reading_attempts(submitted_at);

-- Indexes for reading_feedback
CREATE INDEX IF NOT EXISTS idx_reading_feedback_attempt_id ON public.reading_feedback(attempt_id);
CREATE INDEX IF NOT EXISTS idx_reading_feedback_teacher_id ON public.reading_feedback(teacher_id);

-- ==============================================
-- 6. CREATE FUNCTION TO AUTO-LINK MATERIALS TO BATCHES
-- ==============================================

-- Function to automatically link reading materials to all batches with the same course
CREATE OR REPLACE FUNCTION auto_link_reading_to_batches()
RETURNS TRIGGER AS $$
BEGIN
    -- When new reading material is created, link it to all batches with the same course_id
    INSERT INTO public.reading_batch_map (reading_material_id, batch_id, tutor_status, student_visible)
    SELECT 
        NEW.id,
        b.batch_id,
        'pending',
        false
    FROM public.batches b
    WHERE b.course_id = NEW.course_id
    ON CONFLICT (reading_material_id, batch_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-link materials to batches
DROP TRIGGER IF EXISTS trigger_auto_link_reading_to_batches ON public.reading_materials;
CREATE TRIGGER trigger_auto_link_reading_to_batches
    AFTER INSERT ON public.reading_materials
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_reading_to_batches();

-- ==============================================
-- 7. GRANT PERMISSIONS
-- ==============================================

-- Grant permissions for authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_batch_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_feedback TO authenticated;
GRANT EXECUTE ON FUNCTION auto_link_reading_to_batches() TO authenticated;

-- ==============================================
-- 8. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- All tables, indexes, functions, and triggers have been created
-- The Reading module is now ready for use

















