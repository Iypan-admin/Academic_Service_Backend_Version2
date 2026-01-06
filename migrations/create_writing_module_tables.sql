-- =====================================================
-- WRITING MODULE DATABASE SCHEMA
-- =====================================================
-- This migration creates tables for the Writing module
-- Following the same pattern as Speaking and Reading modules
-- =====================================================

-- 1. writing_tasks table - Stores writing tasks uploaded by Academic Admin
CREATE TABLE IF NOT EXISTS public.writing_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    instruction TEXT,
    content_type TEXT NOT NULL CHECK (content_type IN ('image', 'document', 'text')),
    content_text TEXT, -- For text content
    file_url TEXT, -- For image/document files (stored in Supabase storage)
    file_type TEXT, -- 'image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES public.users(id),
    
    -- Ensure at least one content type is provided
    CONSTRAINT writing_tasks_content_check CHECK (
        (content_type = 'text' AND content_text IS NOT NULL) OR
        (content_type IN ('image', 'document') AND file_url IS NOT NULL)
    )
);

-- 2. writing_batch_map table - Maps writing tasks to batches (auto-created by trigger)
CREATE TABLE IF NOT EXISTS public.writing_batch_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    writing_task_id UUID NOT NULL REFERENCES public.writing_tasks(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    tutor_status TEXT DEFAULT 'pending' CHECK (tutor_status IN ('pending', 'read', 'completed')),
    student_visible BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one mapping per task per batch
    UNIQUE(writing_task_id, batch_id)
);

-- 3. writing_submissions table - Stores student writing submissions (images)
CREATE TABLE IF NOT EXISTS public.writing_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    writing_task_id UUID NOT NULL REFERENCES public.writing_tasks(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(student_id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    submission_image_url TEXT NOT NULL, -- Image URL stored in Supabase storage
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one submission per student per task
    UNIQUE(writing_task_id, student_id)
);

-- 4. writing_feedback table - Stores teacher feedback for student submissions
CREATE TABLE IF NOT EXISTS public.writing_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES public.writing_submissions(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.users(id),
    feedback_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reviewed' CHECK (status IN ('reviewed', 'needs_improvement', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One feedback per submission (can be updated)
    UNIQUE(submission_id)
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_writing_tasks_course_id ON public.writing_tasks(course_id);
CREATE INDEX IF NOT EXISTS idx_writing_tasks_created_at ON public.writing_tasks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_writing_batch_map_task_id ON public.writing_batch_map(writing_task_id);
CREATE INDEX IF NOT EXISTS idx_writing_batch_map_batch_id ON public.writing_batch_map(batch_id);
CREATE INDEX IF NOT EXISTS idx_writing_batch_map_tutor_status ON public.writing_batch_map(tutor_status);
CREATE INDEX IF NOT EXISTS idx_writing_batch_map_student_visible ON public.writing_batch_map(student_visible);

CREATE INDEX IF NOT EXISTS idx_writing_submissions_task_id ON public.writing_submissions(writing_task_id);
CREATE INDEX IF NOT EXISTS idx_writing_submissions_student_id ON public.writing_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_writing_submissions_batch_id ON public.writing_submissions(batch_id);
CREATE INDEX IF NOT EXISTS idx_writing_submissions_submitted_at ON public.writing_submissions(submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_writing_feedback_submission_id ON public.writing_feedback(submission_id);
CREATE INDEX IF NOT EXISTS idx_writing_feedback_teacher_id ON public.writing_feedback(teacher_id);
CREATE INDEX IF NOT EXISTS idx_writing_feedback_status ON public.writing_feedback(status);

-- =====================================================
-- TRIGGER: Auto-link writing tasks to batches
-- =====================================================
-- When a writing task is created, automatically create mappings
-- for all batches that belong to the same course

CREATE OR REPLACE FUNCTION auto_link_writing_to_batches()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert mappings for all batches with the same course_id
    INSERT INTO public.writing_batch_map (writing_task_id, batch_id)
    SELECT NEW.id, b.batch_id
    FROM public.batches b
    WHERE b.course_id = NEW.course_id
    ON CONFLICT (writing_task_id, batch_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_auto_link_writing_to_batches ON public.writing_tasks;
CREATE TRIGGER trigger_auto_link_writing_to_batches
    AFTER INSERT ON public.writing_tasks
    FOR EACH ROW
    EXECUTE FUNCTION auto_link_writing_to_batches();

-- =====================================================
-- TRIGGER: Auto-update updated_at timestamp
-- =====================================================

CREATE OR REPLACE FUNCTION update_writing_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_writing_submissions_updated_at ON public.writing_submissions;
CREATE TRIGGER trigger_update_writing_submissions_updated_at
    BEFORE UPDATE ON public.writing_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_writing_submissions_updated_at();

CREATE OR REPLACE FUNCTION update_writing_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_writing_feedback_updated_at ON public.writing_feedback;
CREATE TRIGGER trigger_update_writing_feedback_updated_at
    BEFORE UPDATE ON public.writing_feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_writing_feedback_updated_at();

CREATE OR REPLACE FUNCTION update_writing_batch_map_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_writing_batch_map_updated_at ON public.writing_batch_map;
CREATE TRIGGER trigger_update_writing_batch_map_updated_at
    BEFORE UPDATE ON public.writing_batch_map
    FOR EACH ROW
    EXECUTE FUNCTION update_writing_batch_map_updated_at();

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

