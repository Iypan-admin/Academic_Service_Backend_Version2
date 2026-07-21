const supabase = require("../config/supabase.js");

// Get events by date range
const getEventsByDateRange = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                error: "Start date and end date are required"
            });
        }

        // 1. Query academic_events
        const { data: academicEvents, error: eventsErr } = await supabase
            .from("academic_events")
            .select("*")
            .gte("event_start_date", start_date)
            .lte("event_start_date", end_date);

        if (eventsErr) {
            console.error("Error fetching academic_events:", eventsErr);
            return res.status(500).json({ success: false, error: eventsErr.message });
        }

        // 2. Also query gmeets (scheduled class sessions) in range for calendar view
        const { data: gmeetsData } = await supabase
            .from("gmeets")
            .select("*")
            .gte("date", start_date)
            .lte("date", end_date);

        const gmeetEvents = (gmeetsData || []).map(g => ({
            id: `gmeet-${g.meet_id}`,
            title: g.title || `Class Session #${g.session_number}`,
            description: `Google Meet link: ${g.meet_link || 'N/A'}${g.note ? '\nNotes: ' + g.note : ''}`,
            event_type: "training",
            event_start_date: g.date,
            event_end_date: g.date,
            event_start_time: g.time,
            event_end_time: null,
            status: g.status || "active",
            is_gmeet: true
        }));

        const combined = [...(academicEvents || []), ...gmeetEvents];

        res.json({
            success: true,
            data: combined,
            count: combined.length
        });
    } catch (error) {
        console.error("Get events by date range error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
};

// Get upcoming events
const getUpcomingEvents = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const today = new Date().toISOString().split("T")[0];

        const { data, error } = await supabase
            .from("academic_events")
            .select("*")
            .gte("event_start_date", today)
            .order("event_start_date", { ascending: true })
            .limit(limit);

        if (error) {
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({
            success: true,
            data: data || [],
            count: (data || []).length
        });
    } catch (error) {
        console.error("Get upcoming events error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
};

// Get all events
const getAllEvents = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("academic_events")
            .select("*")
            .order("event_start_date", { ascending: true });

        if (error) {
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({
            success: true,
            data: data || []
        });
    } catch (error) {
        console.error("Get all events error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
};

// Create event
const createEvent = async (req, res) => {
    try {
        const {
            title,
            description,
            event_type,
            event_start_date,
            event_end_date,
            event_start_time,
            event_end_time,
            status
        } = req.body;

        if (!title || !event_start_date) {
            return res.status(400).json({
                success: false,
                error: "Title and event_start_date are required"
            });
        }

        const created_by = req.user?.id || req.user?.user_id;

        const { data, error } = await supabase
            .from("academic_events")
            .insert([{
                title,
                description,
                event_type: event_type || "general",
                event_start_date,
                event_end_date: event_end_date || event_start_date,
                event_start_time: event_start_time || null,
                event_end_time: event_end_time || null,
                status: status || "active",
                created_by
            }])
            .select()
            .single();

        if (error) {
            console.error("Create event DB error:", error);
            return res.status(400).json({ success: false, error: error.message });
        }

        res.status(201).json({
            success: true,
            message: "Event created successfully",
            data
        });
    } catch (error) {
        console.error("Create event error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
};

// Update event
const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const { data, error } = await supabase
            .from("academic_events")
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            return res.status(400).json({ success: false, error: error.message });
        }

        res.json({
            success: true,
            message: "Event updated successfully",
            data
        });
    } catch (error) {
        console.error("Update event error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
};

// Delete event
const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from("academic_events")
            .delete()
            .eq("id", id);

        if (error) {
            return res.status(400).json({ success: false, error: error.message });
        }

        res.json({
            success: true,
            message: "Event deleted successfully"
        });
    } catch (error) {
        console.error("Delete event error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
};

module.exports = {
    getEventsByDateRange,
    getUpcomingEvents,
    getAllEvents,
    createEvent,
    updateEvent,
    deleteEvent
};
