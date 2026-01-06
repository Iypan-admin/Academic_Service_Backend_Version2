const supabase = require("../config/supabase.js");

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

// Create a GMeet
const createGMeet = async (req, res) => {
    const { batch_id, meet_link, date, time, current, note, title, session_number } = req.body;

    if (!batch_id || !title) {
        return res.status(400).json({ error: "Missing required fields: batch_id and title are required" });
    }

    const insertData = { batch_id, title };
    
    // Optional fields
    if (meet_link !== undefined) insertData.meet_link = meet_link;
    if (date !== undefined) insertData.date = date;
    if (time !== undefined) insertData.time = time;
    if (current !== undefined) insertData.current = current;
    if (note !== undefined) insertData.note = note;
    if (session_number !== undefined) insertData.session_number = session_number;

    const { data, error } = await supabase
        .from("gmeets")
        .insert([insertData]);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ message: "GMeet created successfully", data });
};

// Get all GMeets for a specific batch (including merged batches)
const getGMeetsByBatch = async (req, res) => {
    const { batch_id } = req.params;

    try {
        // Get all batch IDs in the merge group (including the original batch)
        const mergedBatchIds = await getMergedBatchIds(batch_id);

        // First, try to get batch info to check total_sessions
        const { data: batchInfo } = await supabase
            .from("batches")
            .select("total_sessions")
            .eq("batch_id", batch_id)
            .single();

        const { data, error } = await supabase
            .from("gmeets")
            .select("*")
            .in("batch_id", mergedBatchIds);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Sort: if session_number exists, sort by it first, then by date/time
        const sortedData = data.sort((a, b) => {
            // If both have session_number, sort by it
            if (a.session_number !== null && b.session_number !== null) {
                return a.session_number - b.session_number;
            }
            // If only one has session_number, prioritize it
            if (a.session_number !== null && b.session_number === null) return -1;
            if (a.session_number === null && b.session_number !== null) return 1;
            // If neither has session_number, sort by date then time
            if (a.date && b.date) {
                const dateCompare = new Date(a.date) - new Date(b.date);
                if (dateCompare !== 0) return dateCompare;
                if (a.time && b.time) return a.time.localeCompare(b.time);
                return 0;
            }
            return 0;
        });

        res.status(200).json(sortedData);
    } catch (error) {
        console.error('Error fetching GMeets:', error);
        res.status(500).json({ error: "Failed to fetch GMeets" });
    }
};

// Get a specific GMeet by meet_id
const getGMeetById = async (req, res) => {
    const { meet_id } = req.params;

    const { data, error } = await supabase
        .from("gmeets")
        .select("*")
        .eq("meet_id", meet_id)
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json(data);
};

// Update a GMeet
const updateGMeet = async (req, res) => {
    const { meet_id } = req.params;
    const updates = req.body;

    const { data, error } = await supabase
        .from("gmeets")
        .update(updates)
        .eq("meet_id", meet_id)
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: "GMeet updated successfully", data });
};

// Delete a GMeet
const deleteGMeet = async (req, res) => {
    const { meet_id } = req.params;

    const { error } = await supabase
        .from("gmeets")
        .delete()
        .eq("meet_id", meet_id);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: "GMeet deleted successfully" });
};

// Get all today's live classes for all batches (Admin/Manager/Academic Admin)
const getTodayLiveClasses = async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

        // Fetch all today's gmeets with batch details
        const { data: todayGmeets, error: gmeetsError } = await supabase
            .from("gmeets")
            .select(`
                *,
                batch:batches!inner(
                    batch_id,
                    batch_name,
                    time_from,
                    time_to,
                    course:courses(course_name),
                    teacher:teachers!batches_teacher_fkey(
                        teacher_id,
                        user:users(id, name)
                    )
                )
            `)
            .eq("date", today)
            .order("time", { ascending: true });

        if (gmeetsError) {
            console.error('Error fetching today\'s gmeets:', gmeetsError);
            return res.status(500).json({ error: gmeetsError.message });
        }

        // Transform the data to include batch information
        const transformedData = todayGmeets.map(gmeet => ({
            meet_id: gmeet.meet_id,
            batch_id: gmeet.batch_id,
            batch_name: gmeet.batch?.batch_name,
            course_name: gmeet.batch?.course?.course_name,
            tutor_name: gmeet.batch?.teacher?.user?.name,
            date: gmeet.date,
            time_from: gmeet.batch?.time_from,
            time_to: gmeet.batch?.time_to,
            class_time: gmeet.time,
            class_link: gmeet.meet_link,
            title: gmeet.title,
            note: gmeet.note
        }));

        res.status(200).json(transformedData);
    } catch (error) {
        console.error('Error fetching today\'s live classes:', error);
        res.status(500).json({ error: "Failed to fetch today's live classes" });
    }
};

// Get all classes for all batches (Admin/Manager/Academic Admin) - for history view
const getAllClasses = async (req, res) => {
    try {
        // Fetch all gmeets with batch details, ordered by date (newest first)
        const { data: allGmeets, error: gmeetsError } = await supabase
            .from("gmeets")
            .select(`
                *,
                batch:batches!inner(
                    batch_id,
                    batch_name,
                    time_from,
                    time_to,
                    course:courses(course_name),
                    teacher:teachers!batches_teacher_fkey(
                        teacher_id,
                        user:users(id, name)
                    )
                )
            `)
            .order("date", { ascending: false })
            .order("time", { ascending: true });

        if (gmeetsError) {
            console.error('Error fetching all gmeets:', gmeetsError);
            return res.status(500).json({ error: gmeetsError.message });
        }

        // Transform the data to include batch information
        const transformedData = allGmeets.map(gmeet => ({
            meet_id: gmeet.meet_id,
            batch_id: gmeet.batch_id,
            batch_name: gmeet.batch?.batch_name,
            course_name: gmeet.batch?.course?.course_name,
            tutor_name: gmeet.batch?.teacher?.user?.name,
            date: gmeet.date,
            time_from: gmeet.batch?.time_from,
            time_to: gmeet.batch?.time_to,
            class_time: gmeet.time,
            class_link: gmeet.meet_link,
            title: gmeet.title,
            note: gmeet.note
        }));

        res.status(200).json(transformedData);
    } catch (error) {
        console.error('Error fetching all classes:', error);
        res.status(500).json({ error: "Failed to fetch all classes" });
    }
};

module.exports = { createGMeet, getGMeetsByBatch, getGMeetById, updateGMeet, deleteGMeet, getTodayLiveClasses, getAllClasses };
