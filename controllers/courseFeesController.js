const supabase = require("../config/supabase.js");

// Get all course fees
const getAllCourseFees = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("course_fees")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Get course fee by ID
const getCourseFeeById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("course_fees")
            .select("*")
            .eq("id", id)
            .single();

        if (error) {
            console.error("Database error:", error);
            return res.status(404).json({ error: "Course fee not found" });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Create new course fee
const createCourseFee = async (req, res) => {
    const { course_name, duration, total_fees } = req.body;

    // Validate required fields
    if (!course_name || duration === undefined || total_fees === undefined) {
        return res.status(400).json({ 
            error: "All fields are required: course_name, duration, total_fees" 
        });
    }

    // Validate duration is a number
    if (typeof duration !== 'number' || duration <= 0) {
        return res.status(400).json({ error: "Duration must be a positive number" });
    }

    // Validate total_fees is a number
    if (typeof total_fees !== 'number' || total_fees <= 0) {
        return res.status(400).json({ error: "Total fees must be a positive number" });
    }

    try {
        const { data, error } = await supabase
            .from("course_fees")
            .insert([{ 
                course_name: course_name.trim(), 
                duration, 
                total_fees 
            }])
            .select();

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        res.status(201).json({ 
            message: "Course fee created successfully", 
            success: true,
            data: data[0] 
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Update course fee
const updateCourseFee = async (req, res) => {
    const { id } = req.params;
    const { course_name, duration, total_fees } = req.body;

    // Validate duration if provided
    if (duration !== undefined && (typeof duration !== 'number' || duration <= 0)) {
        return res.status(400).json({ error: "Duration must be a positive number" });
    }

    // Validate total_fees if provided
    if (total_fees !== undefined && (typeof total_fees !== 'number' || total_fees <= 0)) {
        return res.status(400).json({ error: "Total fees must be a positive number" });
    }

    try {
        const updateData = {};
        if (course_name !== undefined) updateData.course_name = course_name.trim();
        if (duration !== undefined) updateData.duration = duration;
        if (total_fees !== undefined) updateData.total_fees = total_fees;

        const { data, error } = await supabase
            .from("course_fees")
            .update(updateData)
            .eq("id", id)
            .select();

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "Course fee not found" });
        }

        res.json({ 
            message: "Course fee updated successfully", 
            success: true,
            data: data[0] 
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Delete course fee
const deleteCourseFee = async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from("course_fees")
            .delete()
            .eq("id", id);

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        res.json({ 
            message: "Course fee deleted successfully",
            success: true 
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = {
    getAllCourseFees,
    getCourseFeeById,
    createCourseFee,
    updateCourseFee,
    deleteCourseFee
};

