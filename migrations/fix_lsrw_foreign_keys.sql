-- Fix LSRW Foreign Key Constraints
-- This script fixes the foreign key references from auth.users to public.users

-- Drop existing foreign key constraints if they exist
ALTER TABLE public.lsrw_content 
    DROP CONSTRAINT IF EXISTS lsrw_content_created_by_fkey;

ALTER TABLE public.lsrw_batch_mapping 
    DROP CONSTRAINT IF EXISTS lsrw_batch_mapping_completed_by_fkey;

-- Add correct foreign key constraints referencing public.users
ALTER TABLE public.lsrw_content 
    ADD CONSTRAINT lsrw_content_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE public.lsrw_batch_mapping 
    ADD CONSTRAINT lsrw_batch_mapping_completed_by_fkey 
    FOREIGN KEY (completed_by) REFERENCES public.users(id);

-- Make created_by and completed_by nullable to handle cases where user doesn't exist
ALTER TABLE public.lsrw_content 
    ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.lsrw_batch_mapping 
    ALTER COLUMN completed_by DROP NOT NULL;












