const supabase = require("../config/supabase.js");

// Create a GMeet
const createGMeet = async (req, res) => {
    const { batch_id, meet_link, date, time, current, note, title } = req.body;

    if (!batch_id || !meet_link || !date || !time || current === undefined || !title) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
        .from("gmeets")
        .insert([{ batch_id, meet_link, date, time, current, note, title }]);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ message: "GMeet created successfully", data });
};

// Get all GMeets for a specific batch
const getGMeetsByBatch = async (req, res) => {
    const { batch_id } = req.params;

    const { data, error } = await supabase
        .from("gmeets")
        .select("*")
        .eq("batch_id", batch_id);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(200).json(data);
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

module.exports = { createGMeet, getGMeetsByBatch, getGMeetById, updateGMeet, deleteGMeet };
