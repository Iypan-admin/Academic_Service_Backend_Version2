-- Migration: Create LSRW (Listening, Speaking, Reading, Writing) Module Tables
-- Purpose: Enable LSRW content management for courses
-- Date: January 2025

-- ==============================================
-- 1. CREATE LSRW_CONTENT TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.lsrw_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    instruction TEXT,
    max_marks INTEGER DEFAULT 0,
    audio_url TEXT,
    question_doc_url TEXT,
    questions JSONB, -- Parsed questions from docx: [{q1: "text", options: ["a", "b", "c"], answer: "b"}, ...]
    module_type TEXT NOT NULL DEFAULT 'listening' CHECK (module_type IN ('listening', 'speaking', 'reading', 'writing')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES public.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comments
COMMENT ON TABLE public.lsrw_content IS 'Stores LSRW module content (audio, questions, etc.) for courses';
COMMENT ON COLUMN public.lsrw_content.id IS 'Unique identifier for LSRW content';
COMMENT ON COLUMN public.lsrw_content.course_id IS 'Reference to the course this content belongs to';
COMMENT ON COLUMN public.lsrw_content.title IS 'Title of the lesson';
COMMENT ON COLUMN public.lsrw_content.instruction IS 'Instructions for students';
COMMENT ON COLUMN public.lsrw_content.max_marks IS 'Maximum marks for this lesson';
COMMENT ON COLUMN public.lsrw_content.audio_url IS 'URL to the audio file in Supabase storage';
COMMENT ON COLUMN public.lsrw_content.question_doc_url IS 'URL to the question document in Supabase storage';
COMMENT ON COLUMN public.lsrw_content.questions IS 'Parsed questions in JSON format';
COMMENT ON COLUMN public.lsrw_content.module_type IS 'Type of LSRW module: listening, speaking, reading, or writing';

-- ==============================================
-- 2. CREATE LSRW_BATCH_MAPPING TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.lsrw_batch_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lsrw_content_id UUID NOT NULL REFERENCES public.lsrw_content(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    tutor_status TEXT DEFAULT 'pending' CHECK (tutor_status IN ('pending', 'completed')),
    student_visible BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one mapping per content per batch
    UNIQUE(lsrw_content_id, batch_id)
);

-- Add comments
COMMENT ON TABLE public.lsrw_batch_mapping IS 'Maps LSRW content to batches with tutor completion status';
COMMENT ON COLUMN public.lsrw_batch_mapping.id IS 'Unique identifier for the mapping';
COMMENT ON COLUMN public.lsrw_batch_mapping.lsrw_content_id IS 'Reference to the LSRW content';
COMMENT ON COLUMN public.lsrw_batch_mapping.batch_id IS 'Reference to the batch';
COMMENT ON COLUMN public.lsrw_batch_mapping.tutor_status IS 'Tutor completion status: pending or completed';
COMMENT ON COLUMN public.lsrw_batch_mapping.student_visible IS 'Whether students can see this content';
COMMENT ON COLUMN public.lsrw_batch_mapping.completed_at IS 'Timestamp when tutor marked as completed';

-- ==============================================
-- 3. CREATE LSRW_STUDENT_ANSWERS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.lsrw_student_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    lsrw_content_id UUID NOT NULL REFERENCES public.lsrw_content(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    answers JSONB NOT NULL, -- {q1: "a", q2: "b", ...}
    score INTEGER DEFAULT 0,
    max_marks INTEGER DEFAULT 0,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one submission per student per content
    UNIQUE(student_id, lsrw_content_id, batch_id)
);

-- Add comments
COMMENT ON TABLE public.lsrw_student_answers IS 'Stores student answers and scores for LSRW content';
COMMENT ON COLUMN public.lsrw_student_answers.id IS 'Unique identifier for the answer submission';
COMMENT ON COLUMN public.lsrw_student_answers.student_id IS 'Reference to the student';
COMMENT ON COLUMN public.lsrw_student_answers.lsrw_content_id IS 'Reference to the LSRW content';
COMMENT ON COLUMN public.lsrw_student_answers.batch_id IS 'Reference to the batch';
COMMENT ON COLUMN public.lsrw_student_answers.answers IS 'Student answers in JSON format';
COMMENT ON COLUMN public.lsrw_student_answers.score IS 'Calculated score';
COMMENT ON COLUMN public.lsrw_student_answers.max_marks IS 'Maximum marks for this content';

-- ==============================================
-- 4. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Indexes for lsrw_content
CREATE INDEX IF NOT EXISTS idx_lsrw_content_course_id ON public.lsrw_content(course_id);
CREATE INDEX IF NOT EXISTS idx_lsrw_content_module_type ON public.lsrw_content(module_type);
CREATE INDEX IF NOT EXISTS idx_lsrw_content_created_at ON public.lsrw_content(created_at);

-- Indexes for lsrw_batch_mapping
CREATE INDEX IF NOT EXISTS idx_lsrw_batch_mapping_content_id ON public.lsrw_batch_mapping(lsrw_content_id);
CREATE INDEX IF NOT EXISTS idx_lsrw_batch_mapping_batch_id ON public.lsrw_batch_mapping(batch_id);
CREATE INDEX IF NOT EXISTS idx_lsrw_batch_mapping_tutor_status ON public.lsrw_batch_mapping(tutor_status);
CREATE INDEX IF NOT EXISTS idx_lsrw_batch_mapping_student_visible ON public.lsrw_batch_mapping(student_visible);

-- Indexes for lsrw_student_answers
CREATE INDEX IF NOT EXISTS idx_lsrw_student_answers_student_id ON public.lsrw_student_answers(student_id);
CREATE INDEX IF NOT EXISTS idx_lsrw_student_answers_content_id ON public.lsrw_student_answers(lsrw_content_id);
CREATE INDEX IF NOT EXISTS idx_lsrw_student_answers_batch_id ON public.lsrw_student_answers(batch_id);
CREATE INDEX IF NOT EXISTS idx_lsrw_student_answers_submitted_at ON public.lsrw_student_answers(submitted_at);

-- ==============================================
-- 5. CREATE FUNCTION TO AUTO-LINK CONTENT TO BATCHES
-- ==============================================

-- Function to automatically link LSRW content to all batches with the same course
CREATE OR REPLACE FUNCTION auto_link_lsrw_to_batches()
RETURNS TRIGGER AS $$
BEGIN
    -- When new LSRW content is created, link it to all batches with the same course_id
    INSERT INTO public.lsrw_batch_mapping (lsrw_content_id, batch_id, tutor_status, student_visible)
    SELECT 
        NEW.id,
        b.batch_id,
        'pending',
        false
    FROM public.batches b
    WHERE b.course_id = NEW.course_id
    ON CONFLICT (lsrw_content_id, batch_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-link content to batches
DROP TRIGGER IF EXISTS trigger_auto_link_lsrw_to_batches ON public.lsrw_content;
CREATE TRIGGER trigger_auto_link_lsrw_to_batches
    AFTER INSERT ON public.lsrw_content
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_lsrw_to_batches();

-- ==============================================
-- 6. GRANT PERMISSIONS
-- ==============================================

-- Grant permissions for authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lsrw_content TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lsrw_batch_mapping TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lsrw_student_answers TO authenticated;
GRANT EXECUTE ON FUNCTION auto_link_lsrw_to_batches() TO authenticated;

-- ==============================================
-- 7. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- All tables, indexes, functions, and triggers have been created
-- The LSRW module is now ready for use

