-- Fix LSRW Cross-Course Mapping Issue
-- This script removes incorrect mappings where LSRW content is linked to batches
-- that don't belong to the same course

-- Step 1: Delete incorrect mappings where content course_id doesn't match batch course_id
DELETE FROM public.lsrw_batch_mapping
WHERE id IN (
    SELECT m.id
    FROM public.lsrw_batch_mapping m
    INNER JOIN public.lsrw_content c ON m.lsrw_content_id = c.id
    INNER JOIN public.batches b ON m.batch_id = b.batch_id
    WHERE c.course_id != b.course_id
);

-- Step 2: Verify the fix - Show any remaining incorrect mappings (should return 0 rows)
SELECT 
    m.id as mapping_id,
    c.id as content_id,
    c.course_id as content_course_id,
    b.batch_id,
    b.course_id as batch_course_id,
    c.title as content_title
FROM public.lsrw_batch_mapping m
INNER JOIN public.lsrw_content c ON m.lsrw_content_id = c.id
INNER JOIN public.batches b ON m.batch_id = b.batch_id
WHERE c.course_id != b.course_id;

-- If the above query returns any rows, those are incorrect mappings that need manual review












