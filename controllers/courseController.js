const supabase = require("../config/supabase.js");

const createCourse = async (req, res) => {
    const { course_name, program, type, language, level, mode, duration } = req.body;

    // Validate required fields (type is now optional)
    if (!course_name || !program || !language || !level || !mode || !duration) {
        return res.status(400).json({ 
            error: "Required fields: course_name, program, language, level, mode, duration (type is optional)" 
        });
    }

    // Validate duration is a number
    if (typeof duration !== 'number') {
        return res.status(400).json({ error: "Duration must be a number" });
    }

    // Prepare insert data - type can be null if not provided
    const insertData = {
            course_name, 
            program, 
            language, 
            level, 
            mode, 
            duration 
    };

    // Only include type if it has a value (not null, not empty string)
    if (type && type.trim() !== '') {
        insertData.type = type;
    } else {
        insertData.type = null;
    }

    const { data, error } = await supabase
        .from("courses")
        .insert([insertData])
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

    // Prepare update data
    const updateData = {};
    
    // Only update fields that are provided
    if (course_name !== undefined) updateData.course_name = course_name;
    if (program !== undefined) updateData.program = program;
    if (language !== undefined) updateData.language = language;
    if (level !== undefined) updateData.level = level;
    if (mode !== undefined) updateData.mode = mode;
    if (duration !== undefined) updateData.duration = duration;
    
    // Handle type - can be null, empty string, or value
    if (type !== undefined) {
        updateData.type = (type && type.trim() !== '') ? type : null;
    }

    const { data, error } = await supabase
        .from("courses")
        .update(updateData)
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