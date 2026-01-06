const express = require("express");
const { getMergedBatchIds } = require("../utils/batchMergeHelper");
const supabase = require("../config/supabase.js");

const router = express.Router();

// Simple authentication check - just verify token exists
const checkAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: "Access Denied. No Token Provided." });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Access Denied. Token is missing." });
    }
    // Token exists, proceed (full verification happens in controllers if needed)
    next();
};

// GET /api/classes/notes/:batchId - Get notes for a batch (including merged batches)
router.get("/notes/:batchId", checkAuth, async (req, res) => {
    try {
        const { batchId } = req.params;
        console.log('📚 Notes request for batch:', batchId);
        
        // Get all batch IDs in the merge group (including the original batch)
        const mergedBatchIds = await getMergedBatchIds(batchId);
        console.log('🔗 Merged batch IDs:', mergedBatchIds);

        // Fetch notes from all merged batches
        const { data, error } = await supabase
            .from("notes")
            .select("notes_id, created_at, link, batch_id, title, note")
            .in("batch_id", mergedBatchIds)
            .order("created_at", { ascending: false });

        if (error) {
            console.error('❌ Error fetching notes:', error);
            return res.status(500).json({ error: "Failed to fetch notes" });
        }

        console.log('✅ Found notes:', data?.length || 0);
        res.status(200).json(data);
    } catch (error) {
        console.error('❌ Error in student notes route:', error);
        res.status(500).json({ error: "Failed to fetch notes" });
    }
});

// GET /api/classes/gmeets/:batchId - Get schedules for a batch (including merged batches)
router.get("/gmeets/:batchId", checkAuth, async (req, res) => {
    try {
        const { batchId } = req.params;
        console.log('📅 GMeets request for batch:', batchId);
        
        // Get all batch IDs in the merge group (including the original batch)
        const mergedBatchIds = await getMergedBatchIds(batchId);
        console.log('🔗 Merged batch IDs:', mergedBatchIds);

        // Fetch schedules from all merged batches
        const { data, error } = await supabase
            .from("gmeets")
            .select("*")
            .in("batch_id", mergedBatchIds)
            .order("date", { ascending: true })
            .order("time", { ascending: true });

        if (error) {
            console.error('❌ Error fetching gmeets:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log('✅ Found schedules:', data?.length || 0);
        res.status(200).json(data);
    } catch (error) {
        console.error('❌ Error in student gmeets route:', error);
        res.status(500).json({ error: "Failed to fetch schedules" });
    }
});

module.exports = router;
