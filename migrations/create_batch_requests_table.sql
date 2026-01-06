-- Migration: Create batch_requests table for Center Admin → State Admin → Academic Admin workflow
-- Purpose: Enable center admins to request batch creation with approval workflow
-- Date: December 2024

-- Create batch_requests table
CREATE TABLE IF NOT EXISTS batch_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id UUID NOT NULL REFERENCES centers(center_id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Center Admin
    state_id UUID NOT NULL REFERENCES states(state_id) ON DELETE CASCADE,
    
    -- Batch Details
    duration INTEGER NOT NULL,
    teacher_id UUID NOT NULL REFERENCES teachers(teacher_id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    time_from TIME NOT NULL,
    time_to TIME NOT NULL,
    max_students INTEGER DEFAULT 10,
    mode TEXT DEFAULT 'Offline' CHECK (mode IN ('Online', 'Offline')),
    
    -- Request Details
    justification TEXT, -- Optional justification from Center Admin
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'state_approved', 'academic_approved', 'rejected')),
    
    -- State Admin Review
    state_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    state_reviewed_at TIMESTAMP,
    state_approval_notes TEXT,
    
    -- Academic Admin Review
    academic_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    academic_reviewed_at TIMESTAMP,
    academic_approval_notes TEXT,
    
    -- Rejection Details
    rejection_reason TEXT,
    rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMP,
    
    -- Final Batch Creation
    created_batch_id UUID REFERENCES batches(batch_id) ON DELETE SET NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_batch_requests_status ON batch_requests(status);
CREATE INDEX IF NOT EXISTS idx_batch_requests_center_id ON batch_requests(center_id);
CREATE INDEX IF NOT EXISTS idx_batch_requests_state_id ON batch_requests(state_id);
CREATE INDEX IF NOT EXISTS idx_batch_requests_requested_by ON batch_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_batch_requests_created_at ON batch_requests(created_at);

-- Add comments for documentation
COMMENT ON TABLE batch_requests IS 'Stores batch creation requests from center admins awaiting state and academic admin approval';
COMMENT ON COLUMN batch_requests.request_id IS 'Unique identifier for the batch request';
COMMENT ON COLUMN batch_requests.center_id IS 'Center where the batch will be created';
COMMENT ON COLUMN batch_requests.requested_by IS 'Center admin who created the request';
COMMENT ON COLUMN batch_requests.state_id IS 'State where the center is located';
COMMENT ON COLUMN batch_requests.duration IS 'Course duration in hours';
COMMENT ON COLUMN batch_requests.teacher_id IS 'Teacher assigned to the batch';
COMMENT ON COLUMN batch_requests.course_id IS 'Course for the batch';
COMMENT ON COLUMN batch_requests.time_from IS 'Batch start time';
COMMENT ON COLUMN batch_requests.time_to IS 'Batch end time';
COMMENT ON COLUMN batch_requests.max_students IS 'Maximum number of students';
COMMENT ON COLUMN batch_requests.mode IS 'Online or Offline mode';
COMMENT ON COLUMN batch_requests.justification IS 'Optional justification provided by center admin';
COMMENT ON COLUMN batch_requests.status IS 'Current status: pending, state_approved, academic_approved, or rejected';
COMMENT ON COLUMN batch_requests.state_reviewed_by IS 'State admin who reviewed the request';
COMMENT ON COLUMN batch_requests.academic_reviewed_by IS 'Academic admin who reviewed the request';
COMMENT ON COLUMN batch_requests.rejection_reason IS 'Reason for rejection if status is rejected';
COMMENT ON COLUMN batch_requests.created_batch_id IS 'ID of the batch created after academic approval';

-- Create a function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_batch_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_batch_requests_updated_at
    BEFORE UPDATE ON batch_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_batch_requests_updated_at();

-- Create a view for easy querying of batch requests with user details
CREATE OR REPLACE VIEW batch_requests_with_details AS
SELECT 
    br.request_id,
    br.center_id,
    c.center_name,
    br.requested_by,
    requester.name as requester_name,
    requester.full_name as requester_full_name,
    br.state_id,
    s.state_name,
    br.duration,
    br.teacher_id,
    t.teacher as teacher_user_id,
    teacher_user.name as teacher_name,
    br.course_id,
    course.course_name,
    course.type as course_type,
    br.time_from,
    br.time_to,
    br.max_students,
    br.mode,
    br.justification,
    br.status,
    br.state_reviewed_by,
    state_reviewer.name as state_reviewer_name,
    br.state_reviewed_at,
    br.state_approval_notes,
    br.academic_reviewed_by,
    academic_reviewer.name as academic_reviewer_name,
    br.academic_reviewed_at,
    br.academic_approval_notes,
    br.rejection_reason,
    br.rejected_by,
    rejector.name as rejected_by_name,
    br.rejected_at,
    br.created_batch_id,
    created_batch.batch_name as created_batch_name,
    br.created_at,
    br.updated_at
FROM batch_requests br
LEFT JOIN centers c ON br.center_id = c.center_id
LEFT JOIN users requester ON br.requested_by = requester.id
LEFT JOIN states s ON br.state_id = s.state_id
LEFT JOIN teachers t ON br.teacher_id = t.teacher_id
LEFT JOIN users teacher_user ON t.teacher = teacher_user.id
LEFT JOIN courses course ON br.course_id = course.id
LEFT JOIN users state_reviewer ON br.state_reviewed_by = state_reviewer.id
LEFT JOIN users academic_reviewer ON br.academic_reviewed_by = academic_reviewer.id
LEFT JOIN users rejector ON br.rejected_by = rejector.id
LEFT JOIN batches created_batch ON br.created_batch_id = created_batch.batch_id;

-- Add comment to the view
COMMENT ON VIEW batch_requests_with_details IS 'Complete view of batch requests with all related user, center, state, and course information';
