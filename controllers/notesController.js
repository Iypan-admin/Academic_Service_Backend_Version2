const supabase = require("../config/supabase.js");
const { supabaseAdmin } = require("../config/supabase.js");
const path = require('path');

// Helper function to get all batch IDs in a merge group (including the original batch)
const getMergedBatchIds = async (batch_id) => {
    try {
        // First check if this batch is part of a merge group
        const { data: mergeMember, error: memberError } = await supabase
            .from('batch_merge_members')
            .select('merge_group_id')
            .eq('batch_id', batch_id)
            .single();

        if (memberError || !mergeMember) {
            // Not part of any merge group, return only this batch
            return [batch_id];
        }

        // Get all batch IDs in this merge group
        const { data: allMembers, error: membersError } = await supabase
            .from('batch_merge_members')
            .select('batch_id')
            .eq('merge_group_id', mergeMember.merge_group_id);

        if (membersError || !allMembers) {
            return [batch_id];
        }

        return allMembers.map(member => member.batch_id);
    } catch (error) {
        console.error('Error getting merged batch IDs:', error);
        return [batch_id];
    }
};

exports.createNote = async (req, res) => {
    try {
        const { link, batch_id, title, note, files } = req.body;
        const uploadedFiles = req.files || [];

        // Validate that either link or files are provided
        if (!link && (!uploadedFiles || uploadedFiles.length === 0) && (!files || files.length === 0)) {
            return res.status(400).json({ error: "Either link or files must be provided" });
        }

        let fileUrls = [];

        // Handle file uploads if files are present
        if (uploadedFiles && uploadedFiles.length > 0) {
            const uploadPromises = uploadedFiles.map(async (file) => {
                try {
                    // Generate unique filename
                    const timestamp = Date.now();
                    const randomString = Math.random().toString(36).substring(2, 15);
                    const fileExt = path.extname(file.originalname);
                    const fileName = `${timestamp}_${randomString}${fileExt}`;
                    const filePath = `${batch_id}/${fileName}`;

                    // Upload to Supabase storage
                    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
                        .from('notes_files')
                        .upload(filePath, file.buffer, {
                            contentType: file.mimetype,
                            upsert: false
                        });

                    if (uploadError) {
                        console.error('Upload error:', uploadError);
                        throw new Error(`Failed to upload file ${file.originalname}: ${uploadError.message}`);
                    }

                    // Get public URL
                    const { data: urlData } = supabaseAdmin.storage
                        .from('notes_files')
                        .getPublicUrl(filePath);

                    return urlData.publicUrl;
                } catch (error) {
                    console.error(`Error uploading file ${file.originalname}:`, error);
                    throw error;
                }
            });

            try {
                fileUrls = await Promise.all(uploadPromises);
            } catch (error) {
                return res.status(500).json({ error: error.message });
            }
        } else if (files && Array.isArray(files) && files.length > 0) {
            // If files are already URLs (from frontend), use them directly
            fileUrls = files;
        }

        // Insert note into database
        const noteData = {
            batch_id,
            title,
            note: note || null,
            link: link || null,
            files: fileUrls.length > 0 ? fileUrls : null
        };

        const { data, error } = await supabase
            .from("notes")
            .insert([noteData])
            .select();

        if (error) {
            console.error('Database error:', error);
            return res.status(400).json({ error: error.message });
        }

        res.status(201).json({ message: "Note created successfully", note: data });
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ error: error.message || "Failed to create note" });
    }
};

exports.getNotes = async (req, res) => {
    try {
        const { batch_id } = req.query;

        if (!batch_id) {
            return res.status(400).json({ error: "Batch ID is required." });
        }

        // Get all batch IDs in the merge group (including the original batch)
        const mergedBatchIds = await getMergedBatchIds(batch_id);

        const { data, error } = await supabase
            .from("notes")
            .select("notes_id, created_at, link, batch_id, title, note, files") // Include files array
            .in("batch_id", mergedBatchIds)
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch notes", details: error.message });
    }
};


exports.getNoteById = async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase.from("notes").select("*").eq("notes_id", id).single();

    if (error) return res.status(400).json({ error: error.message });

    res.json(data);
};

exports.updateNote = async (req, res) => {
    const { id } = req.params;
    const { link, batch_id, title, note } = req.body;

    const { data, error } = await supabase
        .from("notes")
        .update({ link, batch_id, title, note })
        .eq("notes_id", id)
        .select();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Note updated successfully", note: data });
};

exports.deleteNote = async (req, res) => {
    const { id } = req.params;

    const { error } = await supabase.from("notes").delete().eq("notes_id", id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Note deleted successfully" });
};
