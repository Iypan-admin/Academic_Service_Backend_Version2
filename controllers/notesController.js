const supabase = require("../config/supabase.js");

exports.createNote = async (req, res) => {
    const { link, batch_id, title, note } = req.body;

    const { data, error } = await supabase
        .from("notes")
        .insert([{ link, batch_id, title, note }])
        .select();

    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({ message: "Note created successfully", note: data });
};

exports.getNotes = async (req, res) => {
    try {
        const { batch_id } = req.query;

        let query = supabase
            .from("notes")
            .select("notes_id, created_at, link, batch_id, title, note, files")
            .order("created_at", { ascending: false });

        if (batch_id) {
            query = query.eq("batch_id", batch_id);
        }

        const { data, error } = await query;

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
