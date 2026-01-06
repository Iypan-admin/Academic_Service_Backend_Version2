const supabase = require("../config/supabase.js");
const nodemailer = require("nodemailer");
require("dotenv").config(); // to load .env


const createBatch = async (req, res) => {
    const { duration, center, teacher, assistant_tutor, course_id, time_from, time_to, max_students = 10 } = req.body;

    if (!duration || !center || !teacher || !course_id || !time_from || !time_to) {
        return res.status(400).json({
            error: "All fields are required: duration, center, teacher, course_id, time_from, time_to"
        });
    }

    try {
        // 1. Get the latest batch_name to increment
        const { data: lastBatch, error: fetchError } = await supabase
            .from("batches")
            .select("batch_name")
            .like("batch_name", "B%")
            .order("batch_name", { ascending: false })
            .limit(1)
            .single();

        let newBatchNumber = 118; // default start
        if (lastBatch && lastBatch.batch_name) {
            const match = lastBatch.batch_name.match(/^B(\d+)/);
            if (match) {
                newBatchNumber = parseInt(match[1]) + 1;
            }
        }

        // 2. Get course name
        const { data: courseExists, error: courseError } = await supabase
            .from("courses")
            .select("course_name")
            .eq("id", course_id)
            .single();

        if (courseError || !courseExists) {
            return res.status(400).json({ error: "Invalid course ID" });
        }

        // 3. Construct batch_name
        const courseName = courseExists.course_name.toUpperCase();
        const formatToAmPm = (time) => {
            const [hours, minutes] = time.split(':');
            const date = new Date();
            date.setHours(hours, minutes);
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).replace(/\s/g, '');
        };

        const formattedFrom = formatToAmPm(time_from);
        const formattedTo = formatToAmPm(time_to);

        const batch_name = `B${newBatchNumber}-${courseName}-${formattedFrom}-${formattedTo}`;

        // 4. Insert into batches with status and created_by
        const batchData = {
                batch_name,
                duration,
                center,
                teacher,
                course_id,
                time_from,
                time_to,
                max_students,
                status: 'Pending', // Set status as Pending for approval
                created_by: req.user.id // Store UUID for proper foreign key relationship
        };

        // Add assistant_tutor if provided (optional)
        if (assistant_tutor) {
            batchData.assistant_tutor = assistant_tutor;
        }

        const { data, error } = await supabase
            .from("batches")
            .insert([batchData])
            .select(`
                *,
                course:courses(id, course_name, type)
            `)
            .single();

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        res.status(201).json({
            message: "Batch created successfully and is pending approval",
            batch: {
                ...data,
                course_name: data.course?.course_name,
                course_type: data.course?.type
            }
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getBatches = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userId = req.user.id;
        
        let query = supabase.from("batches").select(`
                batch_id,
                batch_name,
                duration,
                max_students,
                created_at,
                time_from,
                time_to,
                status,
                total_sessions,
                created_by,
                approved_by,
                approved_at,
                rejection_reason,
                center:centers(center_id, center_name),
                teacher:teachers!batches_teacher_fkey(
                    teacher_id,
                    user:users(id, name)
                ),
                assistant_tutor:teachers!batches_assistant_tutor_fkey(
                    teacher_id,
                    user:users(id, name)
                ),
                course:courses(id, course_name, type),
                enrollment:enrollment(batch)
            `);

        // Filter based on user role
        if (userRole === 'academic') {
            // Academic Admin can see:
            // 1. Batches they created
            // 2. Batches created by Super Admin (role: 'admin')
            // 3. Batches created by Manager (role: 'manager')
            // We'll filter this in the transformation step since we need to check creator role
        }
        // Manager and Admin can see all batches (no additional filter)

        const { data, error } = await query;

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        // 🔄 Transform + add student_count + fetch user names + merge info
        const transformedData = await Promise.all(data.map(async (batch) => {
            // Fetch creator name
            let creatorName = 'Unknown';
            let creatorRole = null;
            if (batch.created_by) {
                try {
                    const { data: creatorData } = await supabase
                        .from('users')
                        .select('name, role')
                        .eq('id', batch.created_by)
                        .single();
                    if (creatorData) {
                        creatorName = creatorData.name || (creatorData.role === 'academic' ? 'Academic Coordinator' : creatorData.role);
                        creatorRole = creatorData.role;
                    }
                } catch (error) {
                    console.log('Error fetching creator:', error.message);
                }
            }

            // Fetch approver name
            let approverName = null;
            let approverRole = null;
            if (batch.approved_by) {
                try {
                    const { data: approverData } = await supabase
                        .from('users')
                        .select('name, role')
                        .eq('id', batch.approved_by)
                        .single();
                    if (approverData) {
                        approverName = approverData.name || (approverData.role === 'admin' ? 'Super Admin' : 
                                                           approverData.role === 'manager' ? 'Manager' : 
                                                           approverData.role);
                        approverRole = approverData.role;
                    }
                } catch (error) {
                    console.log('Error fetching approver:', error.message);
                }
            }

            // 🔄 Fetch merge information for this batch
            let mergeInfo = null;
            try {
                const { data: mergeData, error: mergeError } = await supabase
                    .from('batch_merge_members')
                    .select(`
                        merge_group_id,
                        batch_merge_groups!inner(
                            merge_group_id,
                            group_name,
                            created_at,
                            is_active
                        )
                    `)
                    .eq('batch_id', batch.batch_id)
                    .eq('batch_merge_groups.is_active', true)
                    .limit(1)
                    .single();

                if (mergeData && !mergeError) {
                    // Get all batches in this merge group
                    const { data: mergedBatches } = await supabase
                        .from('batch_merge_members')
                        .select('batch_id')
                        .eq('merge_group_id', mergeData.merge_group_id);

                    mergeInfo = {
                        merge_group_id: mergeData.batch_merge_groups.merge_group_id,
                        merge_group_name: mergeData.batch_merge_groups.group_name,
                        merged_at: mergeData.batch_merge_groups.created_at,
                        is_merged: true,
                        total_merged_batches: mergedBatches?.length || 1
                    };
                }
            } catch (error) {
                // No merge info found (not an error)
                mergeInfo = { is_merged: false };
            }

            return {
                ...batch,
                center_name: batch.center?.center_name,
                teacher_name: batch.teacher?.user?.name,
                assistant_tutor_name: batch.assistant_tutor?.user?.name || null,
                course_name: batch.course?.course_name,
                course_type: batch.course?.type,
                student_count: batch.enrollment ? batch.enrollment.length : 0,
                // Use fetched user names
                created_by: creatorName,
                creator_role: creatorRole,
                creator_id: batch.created_by, // Keep creator ID for filtering
                approved_by: approverName,
                approver_role: approverRole,
                // Add merge information
                merge_info: mergeInfo,
                // cleanup nested
                center: undefined,
                teacher: undefined,
                assistant_tutor: batch.assistant_tutor ? {
                    teacher_id: batch.assistant_tutor.teacher_id,
                    name: batch.assistant_tutor.user?.name
                } : null,
                course: undefined,
                enrollment: undefined
            };
        }));

        // Filter data based on user role
        let filteredData = transformedData;
        if (userRole === 'academic') {
            // Academic Admin can see:
            // 1. Batches they created (check by creator ID)
            // 2. Batches created by Super Admin (role: 'admin')
            // 3. Batches created by Manager (role: 'manager')
            filteredData = transformedData.filter(batch => {
                // Check if this batch was created by the current academic user
                const isOwnBatch = batch.creator_id === userId;
                // Check if batch was created by admin or manager
                const isAdminOrManagerBatch = batch.creator_role === 'admin' || batch.creator_role === 'manager';
                
                return isOwnBatch || isAdminOrManagerBatch;
            });
        }

        res.json({
            success: true,
            data: filteredData
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};


const getBatchById = async (req, res) => {
    const { id } = req.params;
    const userRole = req.user?.role;
    const userId = req.user?.id;

    console.log('🔍 getBatchById called:', {
        batchId: id,
        userRole,
        userId
    });

    const { data, error } = await supabase
        .from("batches")
        .select(`
            *,
            course:courses(id, course_name),
            teacher:teachers!batches_teacher_fkey(
                teacher_id,
                user:users(id, name)
            ),
            assistant_tutor:teachers!batches_assistant_tutor_fkey(
                teacher_id,
                user:users(id, name)
            ),
            center:centers(center_id, center_name)
        `)
        .eq("batch_id", id)
        .single();

    if (error) {
        console.error('❌ Error fetching batch:', error);
        return res.status(400).json({ error: error.message });
    }

    // Transform the data to flatten nested objects
    const transformedData = {
        ...data,
        course_name: data.course?.course_name,
        teacher_name: data.teacher?.user?.name,
        assistant_tutor_name: data.assistant_tutor?.user?.name || null,
        center_name: data.center?.center_name,
        assistant_tutor: data.assistant_tutor ? {
            teacher_id: data.assistant_tutor.teacher_id,
            name: data.assistant_tutor.user?.name
        } : null
    };
    
    // Remove nested objects cleanly
    delete transformedData.course;
    delete transformedData.teacher;
    delete transformedData.center;

    console.log('✅ Batch fetched successfully:', transformedData);
    res.json({
        success: true,
        data: transformedData
    });
};

const updateBatch = async (req, res) => {
    const { id } = req.params;
    const { duration, center, teacher, assistant_tutor, course_id, time_from, time_to, max_students } = req.body;

    console.log('🔍 updateBatch called with:', { id, duration, center, teacher, assistant_tutor, course_id, time_from, time_to, max_students });

    try {
        // 1. Get old batch to keep batch number
        const { data: oldBatch, error: oldBatchError } = await supabase
            .from("batches")
            .select("batch_name")
            .eq("batch_id", id)
            .single();

        if (oldBatchError || !oldBatch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Extract number part (B118 → 118)
        const match = oldBatch.batch_name.match(/^B(\d+)/);
        const batchNumber = match ? match[1] : "000";

        // 2. Get course name
        const { data: course, error: courseError } = await supabase
            .from("courses")
            .select("course_name")
            .eq("id", course_id)
            .single();

        if (courseError || !course) {
            return res.status(400).json({ error: "Invalid course ID" });
        }

        // 3. Format time → 09:00 → 09:00AM
        const formatToAmPm = (time) => {
            const [hours, minutes] = time.split(':');
            const d = new Date();
            d.setHours(hours, minutes);
            return d.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true
            }).replace(/\s/g, "");
        };

        const formattedFrom = formatToAmPm(time_from);
        const formattedTo = formatToAmPm(time_to);

        // 4. Rebuild batch_name
        const batch_name = `B${batchNumber}-${course.course_name.toUpperCase()}-${formattedFrom}-${formattedTo}`;

        // 5. Update DB
        const updateData = { batch_name, duration, center, teacher, course_id, time_from, time_to, max_students };
        
        // Add assistant_tutor if provided (can be null to remove)
        if (assistant_tutor !== undefined) {
            updateData.assistant_tutor = assistant_tutor || null;
        }
        
        console.log('📝 Updating batch with data:', updateData);
        
        const { data, error } = await supabase
            .from("batches")
            .update(updateData)
            .eq("batch_id", id)
            .select();

        if (error) {
            console.error('❌ Database update error:', error);
            return res.status(400).json({ error: error.message });
        }

        console.log('✅ Batch updated successfully:', data);
        res.json({ message: "Batch updated successfully", batch: data });
    } catch (err) {
        console.error("Update batch error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};


const deleteBatch = async (req, res) => {
    try {
    const { id } = req.params;

        // Check if batch has any enrollments
        const { data: enrollments, error: enrollmentError } = await supabase
            .from("enrollment")
            .select("enrollment_id")
            .eq("batch", id)
            .limit(1);

        if (enrollmentError) {
            console.error("Error checking enrollments:", enrollmentError);
            return res.status(500).json({ 
                success: false,
                error: "Error checking batch enrollments" 
            });
        }

        // If enrollments exist, prevent deletion
        if (enrollments && enrollments.length > 0) {
            return res.status(400).json({ 
                success: false,
                error: "Cannot delete batch: There are students enrolled in this batch. Please remove all enrollments first." 
            });
        }

        // Delete the batch
        const { error } = await supabase
            .from("batches")
            .delete()
            .eq("batch_id", id);

        if (error) {
            console.error("Error deleting batch:", error);
            return res.status(400).json({ 
                success: false,
                error: error.message 
            });
        }

        res.json({ 
            success: true, 
            message: "Batch deleted successfully" 
        });
    } catch (error) {
        console.error("Server error in deleteBatch:", error);
        res.status(500).json({ 
            success: false,
            error: "Internal server error" 
        });
    }
};


const approveStudent = async (req, res) => {
    const { student_id } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // Fetch student details including state, center, and status
    const { data: student, error: fetchError } = await supabase
        .from("students")
        .select(`state:states!students_state_fkey(state_name), center:centers!students_center_fkey(center_name), status, email, name`)
        .eq("student_id", student_id)
        .single();

    if (fetchError || !student) {
        return res.status(400).json({ error: "Student not found or database error" });
    }

    if (student.status) {
        return res.status(400).json({ error: "Student is already approved" });
    }

    // Extract codes
    const stateCode = student.state?.state_name?.slice(0, 2).toUpperCase() || "XX";
    const centerCode = student.center?.center_name?.slice(0, 2).toUpperCase() || "YY";
    const nextNumber = Math.floor(1000 + Math.random() * 9000);
    const registrationNumber = `ISML${stateCode}${centerCode}${nextNumber}`;

    // Approve student in DB
    const { data, error } = await supabase
        .from("students")
        .update({ status: true, registration_number: registrationNumber })
        .eq("student_id", student_id)
        .select();

    if (error) {
        return res.status(400).json({ error: error.message });
    }

    // Setup mail transport
    const transporter = nodemailer.createTransport({
        service: "Gmail",
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASSWORD
        }
    });

    const mailOptions = {
        from: `"ISML Team" <${process.env.MAIL_USER}>`,
        to: student.email,
        subject: "🎉 Congratulations! Your ISML Registration is Approved 🎉",
        html: `
    <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px; color:#333;">
      <div style="max-width:600px; margin:0 auto; background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.1); overflow:hidden;">
        
        <div style="background:#2563eb; padding:20px; text-align:center; color:white;">
          <h1 style="margin:0; font-size:24px;">Welcome to ISML 🎓</h1>
        </div>
        
        <div style="padding:20px;">
          <p style="font-size:16px;">Hi <b>${student.name}</b>,</p>
          <p style="font-size:15px; line-height:1.6;">
            🎉 Congratulations! Your <b>ISML Registration</b> has been successfully <span style="color:green; font-weight:bold;">approved</span>.
          </p>

          <div style="margin:20px 0; padding:15px; border:2px dashed #2563eb; border-radius:8px; text-align:center;">
            <p style="margin:0; font-size:16px;">Your Registration Number:</p>
            <h2 style="margin:10px 0; font-size:22px; color:#2563eb;">${registrationNumber}</h2>
          </div>

          <p style="font-size:15px;">
            You can now access ISML’s courses and resources. We’re excited to have you onboard! 🚀
          </p>
          
          <a href="https://studentportal.iypan.com/login" target="_blank"
            style="display:inline-block; margin-top:20px; padding:12px 20px; background:#2563eb; color:white; text-decoration:none; border-radius:6px; font-size:16px;">
            Access Your Dashboard →
          </a>
        </div>

        <div style="background:#f1f5f9; padding:15px; text-align:center; font-size:12px; color:#555;">
          <p style="margin:0;">Regards,<br/>Team <b>ISML</b></p>
        </div>
      </div>
    </div>
  `,
    };


    // Send email
    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.error("❌ Email sending failed:", err);
        } else {
            console.log("✅ Email sent:", info.response);
        }
    });

    res.json({ message: "Student approved successfully and email sent", student: data });
};

// Update student batch assignment (for enrolled students only)
const updateStudentBatch = async (req, res) => {
    try {
        const { student_id, batch_id } = req.body;

        if (!student_id || !batch_id) {
            return res.status(400).json({ error: "Student ID and Batch ID are required" });
        }

        // Check if student exists and is approved
        const { data: student, error: studentError } = await supabase
            .from("students")
            .select("student_id, status, name")
            .eq("student_id", student_id)
            .single();

        if (studentError || !student) {
            return res.status(404).json({ error: "Student not found" });
        }

        if (!student.status) {
            return res.status(400).json({ error: "Student must be approved before batch assignment" });
        }

        // Check if batch exists
        const { data: batch, error: batchError } = await supabase
            .from("batches")
            .select("batch_id, batch_name")
            .eq("batch_id", batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Check if student already has an enrollment
        const { data: existingEnrollment, error: enrollmentError } = await supabase
            .from("enrollment")
            .select("enrollment_id, batch")
            .eq("student", student_id)
            .single();

        if (enrollmentError && enrollmentError.code !== "PGRST116") {
            return res.status(500).json({ error: "Error checking existing enrollment" });
        }

        if (existingEnrollment) {
            // Update existing enrollment
            const { data, error: updateError } = await supabase
                .from("enrollment")
                .update({ batch: batch_id })
                .eq("enrollment_id", existingEnrollment.enrollment_id)
                .select()
                .single();

            if (updateError) {
                return res.status(500).json({ error: "Failed to update enrollment" });
            }

            res.json({ 
                message: "Student batch assignment updated successfully", 
                enrollment: data,
                student: student,
                batch: batch
            });
        } else {
            // Create new enrollment
            const { data, error: createError } = await supabase
                .from("enrollment")
                .insert([{
                    student: student_id,
                    batch: batch_id,
                    status: true,
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (createError) {
                return res.status(500).json({ error: "Failed to create enrollment" });
            }

            res.json({ 
                message: "Student batch assignment created successfully", 
                enrollment: data,
                student: student,
                batch: batch
            });
        }

    } catch (error) {
        console.error("Update student batch error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};


// Get pending batches for approval (Manager and Admin only)
const getPendingBatches = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("batches")
            .select(`
                batch_id,
                batch_name,
                duration,
                max_students,
                created_at,
                time_from,
                time_to,
                status,
                created_by,
                approved_by,
                approved_at,
                rejection_reason,
                center:centers(center_id, center_name),
                teacher:teachers!batches_teacher_fkey(
                    teacher_id,
                    user:users(id, name)
                ),
                assistant_tutor:teachers!batches_assistant_tutor_fkey(
                    teacher_id,
                    user:users(id, name)
                ),
                course:courses(id, course_name, type)
            `)
            .eq('status', 'Pending')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        // Transform the response + fetch user names
        const transformedData = await Promise.all(data.map(async (batch) => {
            // Fetch creator name
            let creatorName = 'Unknown';
            let creatorRole = null;
            if (batch.created_by) {
                try {
                    const { data: creatorData } = await supabase
                        .from('users')
                        .select('name, role')
                        .eq('id', batch.created_by)
                        .single();
                    if (creatorData) {
                        creatorName = creatorData.name || (creatorData.role === 'academic' ? 'Academic Coordinator' : creatorData.role);
                        creatorRole = creatorData.role;
                    }
                } catch (error) {
                    console.log('Error fetching creator:', error.message);
                }
            }

            // Fetch approver name
            let approverName = null;
            let approverRole = null;
            if (batch.approved_by) {
                try {
                    const { data: approverData } = await supabase
                        .from('users')
                        .select('name, role')
                        .eq('id', batch.approved_by)
                        .single();
                    if (approverData) {
                        approverName = approverData.name || (approverData.role === 'admin' ? 'Super Admin' : 
                                                           approverData.role === 'manager' ? 'Manager' : 
                                                           approverData.role);
                        approverRole = approverData.role;
                    }
                } catch (error) {
                    console.log('Error fetching approver:', error.message);
                }
            }

            return {
                ...batch,
                center_name: batch.center?.center_name,
                teacher_name: batch.teacher?.user?.name,
                assistant_tutor_name: batch.assistant_tutor?.user?.name || null,
                course_name: batch.course?.course_name,
                course_type: batch.course?.type,
                // Use fetched user names
                created_by: creatorName,
                creator_role: creatorRole,
                approved_by: approverName,
                approver_role: approverRole,
                // cleanup nested
                center: undefined,
                teacher: undefined,
                assistant_tutor: batch.assistant_tutor ? {
                    teacher_id: batch.assistant_tutor.teacher_id,
                    name: batch.assistant_tutor.user?.name
                } : null,
                course: undefined
            };
        }));

        res.json({
            success: true,
            data: transformedData
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};

// Approve batch
const approveBatch = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Store the approver's UUID for proper database relationship
        const { data, error } = await supabase
            .from('batches')
            .update({
                status: 'Approved',
                approved_by: req.user.id, // Store UUID for proper foreign key relationship
                approved_at: new Date().toISOString()
            })
            .eq('batch_id', id)
            .select();

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "Batch not found" });
        }

        res.json({
            success: true,
            message: "Batch approved successfully",
            data: data[0]
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};

// Reject batch
const rejectBatch = async (req, res) => {
    try {
        const { id } = req.params;
        const { rejection_reason } = req.body;
        const userId = req.user.id;

        if (!rejection_reason) {
            return res.status(400).json({ error: "Rejection reason is required" });
        }

        // Store the approver's UUID for proper database relationship
        const { data, error } = await supabase
            .from('batches')
            .update({
                status: 'Rejected',
                approved_by: req.user.id, // Store UUID for proper foreign key relationship
                approved_at: new Date().toISOString(),
                rejection_reason: rejection_reason
            })
            .eq('batch_id', id)
            .select();

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "Batch not found" });
        }

        res.json({
            success: true,
            message: "Batch rejected successfully",
            data: data[0]
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};

// ✅ Corrected Export
// ==================== BATCH REQUEST MANAGEMENT FUNCTIONS ====================

// Create batch request (Center Admin)
const createBatchRequest = async (req, res) => {
    const { duration, teacher_id, course_id, time_from, time_to, max_students = 10, mode = 'Offline', justification } = req.body;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;

    try {
        // Only center admins can create requests
        if (currentUserRole !== 'center') {
            return res.status(403).json({ 
                error: 'Only center admins can create batch requests' 
            });
        }

        // Validate required fields
        if (!duration || !teacher_id || !course_id || !time_from || !time_to) {
            return res.status(400).json({
                error: "All fields are required: duration, teacher_id, course_id, time_from, time_to"
            });
        }

        // Get center admin's center
        const { data: centerData, error: centerError } = await supabase
            .from('centers')
            .select('center_id, state')
            .eq('center_admin', currentUserId)
            .single();

        if (centerError || !centerData) {
            return res.status(404).json({ 
                error: 'Center not found for this admin' 
            });
        }

        // Validate course exists
        const { data: courseExists, error: courseError } = await supabase
            .from("courses")
            .select("id, course_name")
            .eq("id", course_id)
            .single();

        if (courseError || !courseExists) {
            return res.status(400).json({ error: "Invalid course ID" });
        }

        // Validate teacher exists
        const { data: teacherExists, error: teacherError } = await supabase
            .from("teachers")
            .select("teacher_id")
            .eq("teacher_id", teacher_id)
            .single();

        if (teacherError || !teacherExists) {
            return res.status(400).json({ error: "Invalid teacher ID" });
        }

        // Create the request
        const { data: requestData, error: insertError } = await supabase
            .from('batch_requests')
            .insert([{
                center_id: centerData.center_id,
                requested_by: currentUserId,
                state_id: centerData.state,
                duration,
                teacher_id,
                course_id,
                time_from,
                time_to,
                max_students,
                mode,
                justification
            }])
            .select()
            .single();

        if (insertError) {
            console.error('Error creating batch request:', insertError.message);
            return res.status(500).json({ error: 'Error creating batch request' });
        }

        res.status(201).json({ 
            message: 'Batch request created successfully', 
            data: requestData
        });
    } catch (error) {
        console.error('Error in createBatchRequest:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get batch requests for state admin
const getBatchRequestsForState = async (req, res) => {
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;

    try {
        // Only state admins can view requests
        if (currentUserRole !== 'state') {
            return res.status(403).json({ 
                error: 'Only state admins can view batch requests' 
            });
        }

        // Get the state admin's state
        const { data: stateData, error: stateError } = await supabase
            .from('states')
            .select('state_id')
            .eq('state_admin', currentUserId)
            .single();

        if (stateError || !stateData) {
            return res.status(404).json({ 
                error: 'State not found for this admin' 
            });
        }

        // Get all requests for this state
        const { data: requests, error: requestsError } = await supabase
            .from('batch_requests_with_details')
            .select('*')
            .eq('state_id', stateData.state_id)
            .order('created_at', { ascending: false });

        if (requestsError) {
            console.error('Error fetching batch requests:', requestsError.message);
            return res.status(500).json({ 
                error: 'Error fetching batch requests' 
            });
        }

        res.status(200).json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Error in getBatchRequestsForState:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get batch requests for academic admin
const getBatchRequestsForAcademic = async (req, res) => {
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;

    try {
        // Only academic admins can view requests
        if (currentUserRole !== 'academic') {
            return res.status(403).json({ 
                error: 'Only academic admins can view batch requests' 
            });
        }

        // Get all requests that are state approved
        const { data: requests, error: requestsError } = await supabase
            .from('batch_requests_with_details')
            .select('*')
            .eq('status', 'state_approved')
            .order('created_at', { ascending: false });

        if (requestsError) {
            console.error('Error fetching batch requests:', requestsError.message);
            return res.status(500).json({ 
                error: 'Error fetching batch requests' 
            });
        }

        res.status(200).json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Error in getBatchRequestsForAcademic:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Approve batch request (State Admin)
const approveBatchRequest = async (req, res) => {
    const { id } = req.params;
    const { notes = '' } = req.body;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;

    try {
        // Only state admins can approve requests
        if (currentUserRole !== 'state') {
            return res.status(403).json({ 
                error: 'Only state admins can approve batch requests' 
            });
        }

        // Update request status
        const { data: requestData, error: updateError } = await supabase
            .from('batch_requests')
            .update({
                status: 'state_approved',
                state_reviewed_by: currentUserId,
                state_reviewed_at: new Date().toISOString(),
                state_approval_notes: notes
            })
            .eq('request_id', id)
            .eq('status', 'pending')
            .select()
            .single();

        if (updateError || !requestData) {
            return res.status(404).json({ 
                error: 'Request not found or already processed' 
            });
        }

        res.status(200).json({ 
            message: 'Batch request approved successfully',
            data: requestData
        });
    } catch (error) {
        console.error('Error in approveBatchRequest:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Reject batch request (State Admin or Academic Admin)
const rejectBatchRequest = async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;

    try {
        // Only state and academic admins can reject requests
        if (currentUserRole !== 'state' && currentUserRole !== 'academic') {
            return res.status(403).json({ 
                error: 'Only state and academic admins can reject batch requests' 
            });
        }

        if (!reason) {
            return res.status(400).json({ 
                error: 'Rejection reason is required' 
            });
        }

        // Update request status
        const { data: requestData, error: updateError } = await supabase
            .from('batch_requests')
            .update({
                status: 'rejected',
                rejected_by: currentUserId,
                rejected_at: new Date().toISOString(),
                rejection_reason: reason
            })
            .eq('request_id', id)
            .in('status', ['pending', 'state_approved'])
            .select()
            .single();

        if (updateError || !requestData) {
            return res.status(404).json({ 
                error: 'Request not found or already processed' 
            });
        }

        res.status(200).json({ 
            message: 'Batch request rejected successfully',
            data: requestData
        });
    } catch (error) {
        console.error('Error in rejectBatchRequest:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Create batch from approved request (Academic Admin)
const createBatchFromRequest = async (req, res) => {
    const { id } = req.params;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;

    try {
        // Only academic admins can create batches from requests
        if (currentUserRole !== 'academic') {
            return res.status(403).json({ 
                error: 'Only academic admins can create batches from requests' 
            });
        }

        // Get the approved request
        const { data: requestData, error: requestError } = await supabase
            .from('batch_requests_with_details')
            .select('*')
            .eq('request_id', id)
            .eq('status', 'state_approved')
            .single();

        if (requestError || !requestData) {
            return res.status(404).json({ 
                error: 'Approved request not found' 
            });
        }

        // Generate batch name (reuse existing logic)
        const { data: lastBatch } = await supabase
            .from("batches")
            .select("batch_name")
            .like("batch_name", "B%")
            .order("batch_name", { ascending: false })
            .limit(1)
            .single();

        let newBatchNumber = 118;
        if (lastBatch && lastBatch.batch_name) {
            const match = lastBatch.batch_name.match(/^B(\d+)/);
            if (match) {
                newBatchNumber = parseInt(match[1]) + 1;
            }
        }

        const formatToAmPm = (time) => {
            const [hours, minutes] = time.split(':');
            const date = new Date();
            date.setHours(hours, minutes);
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).replace(/\s/g, '');
        };

        const formattedFrom = formatToAmPm(requestData.time_from);
        const formattedTo = formatToAmPm(requestData.time_to);
        const batch_name = `B${newBatchNumber}-${requestData.course_name.toUpperCase()}-${formattedFrom}-${formattedTo}`;

        // Create the batch
        const { data: batchData, error: batchError } = await supabase
            .from("batches")
            .insert([{
                batch_name,
                duration: requestData.duration,
                center: requestData.center_id,
                teacher: requestData.teacher_id,
                course_id: requestData.course_id,
                time_from: requestData.time_from,
                time_to: requestData.time_to,
                max_students: requestData.max_students,
                status: 'Pending', // Set to pending for further approval workflow
                created_by: currentUserId
            }])
            .select()
            .single();

        if (batchError) {
            console.error('Error creating batch:', batchError.message);
            return res.status(500).json({ error: 'Error creating batch' });
        }

        // Update request status
        const { error: updateError } = await supabase
            .from('batch_requests')
            .update({
                status: 'academic_approved',
                academic_reviewed_by: currentUserId,
                academic_reviewed_at: new Date().toISOString(),
                created_batch_id: batchData.batch_id
            })
            .eq('request_id', id);

        if (updateError) {
            console.error('Error updating request:', updateError.message);
            return res.status(500).json({ error: 'Error updating request status' });
        }

        res.status(201).json({
            message: "Batch created successfully from request",
            data: {
                request: requestData,
                batch: batchData
            }
        });
    } catch (error) {
        console.error('Error in createBatchFromRequest:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Start batch (Academic Admin only)
const startBatch = async (req, res) => {
    try {
        const { id } = req.params;
        const { start_date, end_date, total_sessions } = req.body;

        // Check if batch exists and is approved
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('batch_id, status, batch_name')
            .eq('batch_id', id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ 
                success: false, 
                error: 'Batch not found.' 
            });
        }

        if (batch.status !== 'Approved') {
            return res.status(400).json({ 
                success: false, 
                error: `Batch must be approved before starting. Current status: ${batch.status}` 
            });
        }

        // Update batch status to started with total_sessions
        const updateData = {
                status: 'Started',
                start_date: start_date || new Date().toISOString(),
                end_date: end_date || null
        };

        if (total_sessions !== undefined && total_sessions !== null) {
            updateData.total_sessions = parseInt(total_sessions);
        }

        const { data: updatedBatch, error: updateError } = await supabase
            .from('batches')
            .update(updateData)
            .eq('batch_id', id)
            .select()
            .single();

        if (updateError) {
            console.error('Error starting batch:', updateError);
            return res.status(400).json({ 
                success: false, 
                error: updateError.message 
            });
        }

        // Optionally auto-create empty gmeet rows if total_sessions is provided
        if (total_sessions && total_sessions > 0) {
            try {
                // Check existing sessions for this batch
                const { data: existingSessions } = await supabase
                    .from('gmeets')
                    .select('session_number')
                    .eq('batch_id', id);

                const existingSessionNumbers = existingSessions?.map(s => s.session_number).filter(Boolean) || [];
                
                // Create empty sessions for missing session numbers
                const sessionsToCreate = [];
                for (let i = 1; i <= total_sessions; i++) {
                    if (!existingSessionNumbers.includes(i)) {
                        sessionsToCreate.push({
                            batch_id: id,
                            session_number: i,
                            title: `Session ${i}`,
                            meet_link: null,
                            date: null,
                            time: null,
                            current: false,
                            note: null
                        });
                    }
                }

                if (sessionsToCreate.length > 0) {
                    const { error: gmeetError } = await supabase
                        .from('gmeets')
                        .insert(sessionsToCreate);

                    if (gmeetError) {
                        console.error('Error creating initial sessions:', gmeetError);
                        // Don't fail the batch start if session creation fails
                    }
                }
            } catch (sessionError) {
                console.error('Error in session creation:', sessionError);
                // Don't fail the batch start if session creation fails
            }
        }

        res.json({
            success: true,
            data: {
                batch: updatedBatch,
                message: 'Batch started successfully.'
            }
        });

    } catch (error) {
        console.error('Server error in startBatch:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
};

// Complete batch (Academic Admin only)
const completeBatch = async (req, res) => {
    try {
        const { id } = req.params;
        const { end_date } = req.body;

        // Check if batch exists and is started
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('batch_id, status, batch_name')
            .eq('batch_id', id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ 
                success: false, 
                error: 'Batch not found.' 
            });
        }

        if (batch.status !== 'Started') {
            return res.status(400).json({ 
                success: false, 
                error: `Batch must be started before completing. Current status: ${batch.status}` 
            });
        }

        // Update batch status to completed
        const { data: updatedBatch, error: updateError } = await supabase
            .from('batches')
            .update({
                status: 'Completed',
                end_date: end_date || new Date().toISOString()
            })
            .eq('batch_id', id)
            .select()
            .single();

        if (updateError) {
            console.error('Error completing batch:', updateError);
            return res.status(400).json({ 
                success: false, 
                error: updateError.message 
            });
        }

        res.json({
            success: true,
            data: {
                batch: updatedBatch,
                message: 'Batch completed successfully.'
            }
        });

    } catch (error) {
        console.error('Server error in completeBatch:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
};

// Get started batches for attendance
const getStartedBatches = async (req, res) => {
    try {
        const { data: batches, error } = await supabase
            .from('batches')
            .select(`
                batch_id,
                batch_name,
                status,
                start_date,
                end_date,
                teacher,
                courses!inner(course_name),
                users!inner(name)
            `)
            .eq('status', 'Started')
            .order('start_date', { ascending: false });

        if (error) {
            console.error('Error fetching started batches:', error);
            return res.status(400).json({ 
                success: false, 
                error: error.message 
            });
        }

        // Transform data to include teacher info
        const transformedBatches = batches.map(batch => ({
            batch_id: batch.batch_id,
            batch_name: batch.batch_name,
            status: batch.status,
            start_date: batch.start_date,
            end_date: batch.end_date,
            course_name: batch.courses?.course_name,
            teacher_name: batch.users?.name
        }));

        res.json({ 
            success: true, 
            data: transformedBatches 
        });

    } catch (error) {
        console.error('Server error in getStartedBatches:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
};


// =====================================================
// BATCH MERGE FUNCTIONS
// =====================================================

// Get eligible batches for merging (must be Started, same course)
const getBatchesForMerge = async (req, res) => {
    try {
        let query = supabase
            .from('batches')
            .select(`
                batch_id,
                batch_name,
                status,
                center:centers(center_id, center_name),
                teacher:teachers(
                    teacher_id,
                    user:users(name)
                ),
                course:courses(id, course_name),
                batch_merge_members(merge_group_id)
            `)
            .eq('status', 'Started');

        const { data, error } = await query;

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // Helper function to extract level from batch name (e.g., "A1-B2" from "B121-ON-FR-IMM-R-A1-B2-10:30AM")
        const extractLevel = (batchName) => {
            if (!batchName) return '';
            // Look for pattern like A1-B2 or A2-B2
            const match = batchName.match(/(A\d+-B\d+)/);
            return match ? match[1] : '';
        };

        const transformedBatches = data.map(batch => {
            const level = extractLevel(batch.batch_name);
            return {
                batch_id: batch.batch_id,
                batch_name: batch.batch_name,
                level: level, // Add level field
                status: batch.status,
                center_name: batch.center?.center_name,
                teacher_name: batch.teacher?.user?.name,
                course_name: batch.course?.course_name,
                is_merged: batch.batch_merge_members && batch.batch_merge_members.length > 0,
                merge_group_id: batch.batch_merge_members?.[0]?.merge_group_id || null
            };
        });

        res.json({ success: true, data: transformedBatches });

    } catch (error) {
        console.error('Server error in getBatchesForMerge:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Create a new merge group with batches
const createMergeGroup = async (req, res) => {
    try {
        const { merge_name, batch_ids, notes } = req.body;

        if (!merge_name || !batch_ids || !Array.isArray(batch_ids) || batch_ids.length < 2) {
            return res.status(400).json({ 
                error: 'merge_name and at least 2 batch_ids are required' 
            });
        }

        const { data: batches, error: batchError } = await supabase
            .from('batches')
            .select('batch_id, batch_name, status, course_id')
            .in('batch_id', batch_ids);

        if (batchError || !batches || batches.length !== batch_ids.length) {
            return res.status(400).json({ error: 'One or more batch IDs are invalid' });
        }

        const nonStarted = batches.filter(b => b.status !== 'Started');
        if (nonStarted.length > 0) {
            return res.status(400).json({ 
                error: 'All batches must have status "Started"' 
            });
        }

        const { data: existingMerges } = await supabase
            .from('batch_merge_members')
            .select('batch_id')
            .in('batch_id', batch_ids);

        if (existingMerges && existingMerges.length > 0) {
            return res.status(400).json({ 
                error: 'One or more batches are already in a merge group' 
            });
        }

        const { data: mergeGroup, error: mergeError } = await supabase
            .from('batch_merge_groups')
            .insert([{
                merge_name,
                created_by: req.user.id,
                notes,
                status: 'active'
            }])
            .select()
            .single();

        if (mergeError) {
            return res.status(400).json({ error: mergeError.message });
        }

        const membersData = batch_ids.map(batch_id => ({
            merge_group_id: mergeGroup.merge_group_id,
            batch_id,
            added_by: req.user.id
        }));

        const { error: membersError } = await supabase
            .from('batch_merge_members')
            .insert(membersData);

        if (membersError) {
            await supabase
                .from('batch_merge_groups')
                .delete()
                .eq('merge_group_id', mergeGroup.merge_group_id);
            return res.status(400).json({ error: membersError.message });
        }

        const { data: fullDetails } = await supabase
            .from('batch_merge_info')
            .select('*')
            .eq('merge_group_id', mergeGroup.merge_group_id)
            .single();

        res.status(201).json({
            success: true,
            message: 'Merge group created successfully',
            data: fullDetails
        });

    } catch (error) {
        console.error('Server error in createMergeGroup:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all merge groups
const getMergeGroups = async (req, res) => {
    try {
        const { status } = req.query;
        let query = supabase.from('batch_merge_info').select('*').order('created_at', { ascending: false });
        if (status) query = query.eq('status', status);
        const { data, error } = await query;
        if (error) return res.status(400).json({ error: error.message });
        
        // Get batch details for each merge group
        const enrichedData = await Promise.all((data || []).map(async (group) => {
            // Get batch IDs in this merge group
            const { data: members } = await supabase
                .from('batch_merge_members')
                .select('batch_id')
                .eq('merge_group_id', group.merge_group_id);
            
            const batchIds = members?.map(m => m.batch_id) || [];
            
            // Get batch details
            const { data: batches } = await supabase
                .from('batches')
                .select('batch_id, batch_name')
                .in('batch_id', batchIds);
            
            return {
                ...group,
                batches: batches || []
            };
        }));
        
        res.json({ success: true, data: enrichedData });
    } catch (error) {
        console.error('Server error in getMergeGroups:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Delete merge group
const deleteMergeGroup = async (req, res) => {
    try {
        const { merge_group_id } = req.params;
        await supabase.from('batch_merge_members').delete().eq('merge_group_id', merge_group_id);
        const { error } = await supabase.from('batch_merge_groups').delete().eq('merge_group_id', merge_group_id);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true, message: 'Merge group deleted successfully' });
    } catch (error) {
        console.error('Server error in deleteMergeGroup:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Merge Batches
module.exports = {
    createBatch,
    getBatches, 
    getBatchById, 
    updateBatch, 
    deleteBatch, 
    approveStudent,
    updateStudentBatch,
    getPendingBatches,
    approveBatch,
    rejectBatch,
    // Batch Request Management Functions
    createBatchRequest,
    getBatchRequestsForState,
    getBatchRequestsForAcademic,
    approveBatchRequest,
    rejectBatchRequest,
    createBatchFromRequest,
    // Batch Start + Attendance Functions
    startBatch,
    completeBatch,
    getStartedBatches,
    // Batch Merge Functions
    getBatchesForMerge,
    createMergeGroup,
    getMergeGroups,
    deleteMergeGroup
};
