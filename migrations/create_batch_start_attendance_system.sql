-- Migration: Create Batch Start + Attendance System
-- Purpose: Enable batch lifecycle management and attendance tracking
-- Date: December 2024

-- ==============================================
-- 1. EXTEND BATCHES TABLE
-- ==============================================

-- Add new columns to batches table for lifecycle management
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS start_date TIMESTAMP NULL;
ALTER TABLE public.batches ADD COLUMN IF NOT EXISTS end_date TIMESTAMP NULL;

-- Update status constraint to include new statuses (keeping original case)
ALTER TABLE public.batches DROP CONSTRAINT IF EXISTS batches_status_check;
ALTER TABLE public.batches ADD CONSTRAINT batches_status_check 
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Started', 'Completed', 'Cancelled'));

-- Set default value for status column
ALTER TABLE public.batches ALTER COLUMN status SET DEFAULT 'Pending';

-- Add comments for new columns
COMMENT ON COLUMN public.batches.status IS 'Batch lifecycle status: pending, approved, started, completed, cancelled';
COMMENT ON COLUMN public.batches.start_date IS 'Date when batch was started for attendance tracking';
COMMENT ON COLUMN public.batches.end_date IS 'Date when batch ends';

-- ==============================================
-- 2. CREATE ATTENDANCE SESSIONS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    created_by UUID REFERENCES public.users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure unique session per batch per date
    UNIQUE(batch_id, session_date)
);

-- Add comments
COMMENT ON TABLE public.attendance_sessions IS 'Class sessions created by teachers for marking attendance';
COMMENT ON COLUMN public.attendance_sessions.id IS 'Unique identifier for attendance session';
COMMENT ON COLUMN public.attendance_sessions.batch_id IS 'Reference to the batch this session belongs to';
COMMENT ON COLUMN public.attendance_sessions.session_date IS 'Date of the attendance session';
COMMENT ON COLUMN public.attendance_sessions.created_by IS 'UUID of teacher who created the session';
COMMENT ON COLUMN public.attendance_sessions.notes IS 'Optional notes from teacher about the session';

-- ==============================================
-- 3. CREATE ATTENDANCE RECORDS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.users(id),
    status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
    marked_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure one record per student per session
    UNIQUE(session_id, student_id)
);

-- Add comments
COMMENT ON TABLE public.attendance_records IS 'Individual student attendance records for each session';
COMMENT ON COLUMN public.attendance_records.id IS 'Unique identifier for attendance record';
COMMENT ON COLUMN public.attendance_records.session_id IS 'Reference to the attendance session';
COMMENT ON COLUMN public.attendance_records.student_id IS 'Reference to the student (user ID)';
COMMENT ON COLUMN public.attendance_records.status IS 'Attendance status: present, absent, late, or excused';
COMMENT ON COLUMN public.attendance_records.marked_at IS 'Timestamp when attendance was marked';

-- ==============================================
-- 4. CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Indexes for batches
CREATE INDEX IF NOT EXISTS idx_batches_status ON public.batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_start_date ON public.batches(start_date);

-- Indexes for attendance_sessions
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_batch_id ON public.attendance_sessions(batch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_session_date ON public.attendance_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_batch_date ON public.attendance_sessions(batch_id, session_date);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_created_by ON public.attendance_sessions(created_by);

-- Indexes for attendance_records
CREATE INDEX IF NOT EXISTS idx_attendance_records_session_id ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_id ON public.attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON public.attendance_records(status);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_session ON public.attendance_records(student_id, session_id);

-- ==============================================
-- 5. CREATE HELPER FUNCTIONS
-- ==============================================

-- Function to create attendance records for all enrolled students
CREATE OR REPLACE FUNCTION create_attendance_records_for_session(
    p_session_id UUID,
    p_batch_id UUID
) RETURNS VOID AS $$
BEGIN
    -- Insert attendance records for all enrolled students
    INSERT INTO public.attendance_records (session_id, student_id, status)
    SELECT 
        p_session_id,
        e.student,
        'absent'::TEXT
    FROM public.enrollment e
    WHERE e.batch = p_batch_id 
    AND e.status = true
    ON CONFLICT (session_id, student_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ==============================================
-- 6. GRANT PERMISSIONS
-- ==============================================

-- Grant permissions for authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT EXECUTE ON FUNCTION create_attendance_records_for_session(UUID, UUID) TO authenticated;

-- ==============================================
-- 7. MIGRATION COMPLETE
-- ==============================================

-- Migration completed successfully
-- All tables, indexes, and functions have been created
-- The batch start + attendance system is now ready for use
