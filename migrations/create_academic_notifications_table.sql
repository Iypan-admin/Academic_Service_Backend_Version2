-- Create academic_notifications table for Academic Coordinator notifications
-- This is separate from teacher_notifications for better separation of concerns

CREATE TABLE IF NOT EXISTS academic_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_coordinator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message text NOT NULL,
    type text NOT NULL, -- e.g., 'STUDENT_REGISTERED', 'BATCH_CREATED', 'TEACHER_ASSIGNED', etc.
    related_id uuid, -- ID of related entity (student_id, batch_id, etc.)
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_academic_notifications_coordinator ON academic_notifications(academic_coordinator_id);
CREATE INDEX IF NOT EXISTS idx_academic_notifications_type ON academic_notifications(type);
CREATE INDEX IF NOT EXISTS idx_academic_notifications_is_read ON academic_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_academic_notifications_created_at ON academic_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_academic_notifications_related_id ON academic_notifications(related_id);

-- Add comments for documentation
COMMENT ON TABLE academic_notifications IS 'Stores notifications for Academic Coordinators';
COMMENT ON COLUMN academic_notifications.academic_coordinator_id IS 'Reference to the academic coordinator user who should receive this notification';
COMMENT ON COLUMN academic_notifications.message IS 'The notification message content';
COMMENT ON COLUMN academic_notifications.type IS 'Type of notification (STUDENT_REGISTERED, BATCH_CREATED, etc.)';
COMMENT ON COLUMN academic_notifications.related_id IS 'ID of the related entity (student_id, batch_id, etc.)';
COMMENT ON COLUMN academic_notifications.is_read IS 'Whether the notification has been read';
COMMENT ON COLUMN academic_notifications.created_at IS 'When the notification was created';

