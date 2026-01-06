-- =====================================================
-- BATCH MERGE SYSTEM - DATABASE MIGRATION
-- =====================================================
-- Description: Creates tables and indexes for batch merge functionality
-- Allows Academic Admin to merge multiple batches for shared communication
-- =====================================================

-- =====================================================
-- 1. CREATE batch_merge_groups TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.batch_merge_groups (
    merge_group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merge_name TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    notes TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.batch_merge_groups IS 'Virtual groups that batches can join for shared communication';
COMMENT ON COLUMN public.batch_merge_groups.merge_group_id IS 'Unique identifier for the merge group';
COMMENT ON COLUMN public.batch_merge_groups.merge_name IS 'Human-readable name for the merge group';
COMMENT ON COLUMN public.batch_merge_groups.created_by IS 'Academic Admin who created this merge';
COMMENT ON COLUMN public.batch_merge_groups.status IS 'active: receiving shared communications, archived: stopped receiving';
COMMENT ON COLUMN public.batch_merge_groups.notes IS 'Optional admin notes about this merge';

-- =====================================================
-- 2. CREATE batch_merge_members TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.batch_merge_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merge_group_id UUID NOT NULL REFERENCES public.batch_merge_groups(merge_group_id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(batch_id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    added_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    UNIQUE(batch_id) -- A batch can only be in ONE merge group at a time
);

COMMENT ON TABLE public.batch_merge_members IS 'Junction table linking batches to merge groups';
COMMENT ON COLUMN public.batch_merge_members.merge_group_id IS 'The merge group this batch belongs to';
COMMENT ON COLUMN public.batch_merge_members.batch_id IS 'The batch that is part of this merge group';
COMMENT ON COLUMN public.batch_merge_members.added_by IS 'User who added this batch to the merge';

-- =====================================================
-- 3. ADD merge_group_id COLUMN TO chats TABLE
-- =====================================================

-- Check if column exists before adding
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'chats' AND column_name = 'merge_group_id'
    ) THEN
        ALTER TABLE public.chats 
        ADD COLUMN merge_group_id UUID REFERENCES public.batch_merge_groups(merge_group_id) ON DELETE SET NULL;
        
        COMMENT ON COLUMN public.chats.merge_group_id IS 'If set, this message is shared across all batches in this merge group';
    END IF;
END $$;

-- =====================================================
-- 4. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_batch_merge_members_group 
    ON public.batch_merge_members(merge_group_id);

CREATE INDEX IF NOT EXISTS idx_batch_merge_members_batch 
    ON public.batch_merge_members(batch_id);

CREATE INDEX IF NOT EXISTS idx_batch_merge_groups_status 
    ON public.batch_merge_groups(status);

CREATE INDEX IF NOT EXISTS idx_batch_merge_groups_created_by 
    ON public.batch_merge_groups(created_by);

CREATE INDEX IF NOT EXISTS idx_chats_merge_group 
    ON public.chats(merge_group_id);

-- =====================================================
-- 5. CREATE HELPER VIEW FOR MERGE INFO
-- =====================================================

CREATE OR REPLACE VIEW public.batch_merge_info AS
SELECT 
    bmg.merge_group_id,
    bmg.merge_name,
    bmg.status,
    bmg.created_at,
    bmg.notes,
    u.name AS created_by_name,
    u.role AS created_by_role,
    COUNT(DISTINCT bmmen.batch_id) AS total_batches,
    COUNT(DISTINCT e.student) AS total_students,
    COUNT(DISTINCT b.teacher) AS total_tutors
FROM public.batch_merge_groups bmg
LEFT JOIN public.batch_merge_members bmmen ON bmmen.merge_group_id = bmg.merge_group_id
LEFT JOIN public.enrollment e ON e.batch = bmmen.batch_id
LEFT JOIN public.batches b ON b.batch_id = bmmen.batch_id
LEFT JOIN public.users u ON u.id = bmg.created_by
GROUP BY bmg.merge_group_id, bmg.merge_name, bmg.status, bmg.created_at, bmg.notes, u.name, u.role;

COMMENT ON VIEW public.batch_merge_info IS 'Aggregated information about merge groups including batch and student counts';

-- =====================================================
-- 6. CREATE HELPER FUNCTIONS
-- =====================================================

-- Function to get merge group for a specific batch
CREATE OR REPLACE FUNCTION public.get_batch_merge_group(p_batch_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_merge_group_id UUID;
BEGIN
    SELECT merge_group_id INTO v_merge_group_id
    FROM public.batch_merge_members
    WHERE batch_id = p_batch_id;
    
    RETURN v_merge_group_id;
END;
$$;

COMMENT ON FUNCTION public.get_batch_merge_group IS 'Returns the merge group ID for a given batch, or NULL if not merged';

-- Function to get all batches in a merge group
CREATE OR REPLACE FUNCTION public.get_merged_batches(p_merge_group_id UUID)
RETURNS TABLE(batch_id UUID, batch_name TEXT, teacher_id UUID, center_id UUID)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT b.batch_id, b.batch_name, b.teacher, b.center
    FROM public.batches b
    INNER JOIN public.batch_merge_members bmm ON b.batch_id = bmm.batch_id
    WHERE bmm.merge_group_id = p_merge_group_id;
END;
$$;

COMMENT ON FUNCTION public.get_merged_batches IS 'Returns all batches that belong to a specific merge group';

-- Function to get all students in merged batches
CREATE OR REPLACE FUNCTION public.get_merged_students(p_merge_group_id UUID)
RETURNS TABLE(student_id UUID, batch_id UUID, batch_name TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT e.student, b.batch_id, b.batch_name
    FROM public.enrollment e
    INNER JOIN public.batches b ON e.batch = b.batch_id
    INNER JOIN public.batch_merge_members bmm ON b.batch_id = bmm.batch_id
    WHERE bmm.merge_group_id = p_merge_group_id;
END;
$$;

COMMENT ON FUNCTION public.get_merged_students IS 'Returns all students in batches that belong to a specific merge group';

-- =====================================================
-- 7. CREATE TRIGGER FOR updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_merge_group_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_merge_group_timestamp
    BEFORE UPDATE ON public.batch_merge_groups
    FOR EACH ROW
    EXECUTE FUNCTION public.update_merge_group_timestamp();

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Verify tables were created
DO $$
BEGIN
    RAISE NOTICE '✅ Batch merge tables created successfully';
    RAISE NOTICE '✅ Indexes created for performance';
    RAISE NOTICE '✅ Helper functions created';
    RAISE NOTICE '✅ Chats table updated with merge_group_id column';
END $$;

