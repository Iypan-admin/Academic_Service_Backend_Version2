-- Fix attendance_records foreign key constraint
-- Change student_id to reference students.student_id instead of users.id

-- Drop the existing foreign key constraint
ALTER TABLE public.attendance_records 
DROP CONSTRAINT IF EXISTS attendance_records_student_id_fkey;

-- Add the correct foreign key constraint
ALTER TABLE public.attendance_records 
ADD CONSTRAINT attendance_records_student_id_fkey 
FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;

-- Update the comment to reflect the correct reference
COMMENT ON COLUMN public.attendance_records.student_id IS 'Reference to the student (student_id)';





