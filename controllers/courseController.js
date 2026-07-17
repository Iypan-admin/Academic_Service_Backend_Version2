const supabase = require("../config/supabase.js");

const createCourse = async (req, res) => {
    const { course_name, program, type, language, level, mode, duration } = req.body;

    // Validate all required field
    if (!course_name || !program || !type || !language || !level || !mode || !duration) {
        return res.status(400).json({ 
            error: "All fields are required: course_name, program, type, language, level, mode, duration" 
        });
    }

    // Validate duration is a number
    if (typeof duration !== 'number') {
        return res.status(400).json({ error: "Duration must be a number" });
    }

    const { data, error } = await supabase
        .from("courses")
        .insert([{ 
            course_name, 
            program, 
            type, 
            language, 
            level, 
            mode, 
            duration 
        }])
        .select();

    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({ message: "Course created successfully", course: data });
};

const updateCourse = async (req, res) => {
    const { id } = req.params;
    const { course_name, program, type, language, level, mode, duration } = req.body;

    // Validate duration is a number if provided
    if (duration && typeof duration !== 'number') {
        return res.status(400).json({ error: "Duration must be a number" });
    }

    const { data, error } = await supabase
        .from("courses")
        .update({ 
            course_name, 
            program, 
            type, 
            language, 
            level, 
            mode, 
            duration 
        })
        .eq("id", id)
        .select();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Course updated successfully", course: data });
};

const deleteCourse = async (req, res) => {
    const { id } = req.params;

    const { error } = await supabase
        .from("courses")
        .delete()
        .eq("id", id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Course deleted successfully" });
};

module.exports = { createCourse, updateCourse, deleteCourse };