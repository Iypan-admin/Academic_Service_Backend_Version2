const supabase = require("../config/supabase.js");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
require("dotenv").config(); // to load .env

const createBatch = async (req, res) => {
    const { duration, center, teacher, course_id, time_from, time_to } = req.body;

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
        const courseName = courseExists.course_name.toUpperCase(); // Keep as it is
        // Convert to AM/PM format
        const formatToAmPm = (time) => {
            const [hours, minutes] = time.split(':');
            const date = new Date();
            date.setHours(hours, minutes);
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).replace(/\s/g, ''); // Remove space before AM/PM
        };

        const formattedFrom = formatToAmPm(time_from);
        const formattedTo = formatToAmPm(time_to);

        const batch_name = `B${newBatchNumber}-${courseName}-${formattedFrom}-${formattedTo}`;



        // 4. Insert into batches
        const { data, error } = await supabase
            .from("batches")
            .insert([{
                batch_name,
                duration,
                center,
                teacher,
                course_id,
                time_from,
                time_to
            }])
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
            message: "Batch created successfully",
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
        // 🔥 Batches with student count
        const { data, error } = await supabase
            .from("batches")
            .select(`
                batch_id,
                batch_name,
                duration,
                status,
                created_at,
                time_from,
                time_to,
                center:centers(center_id, center_name),
                teacher:teachers!batches_teacher_fkey(
                    teacher_id,
                    user:users(id, name)
                ),
                course:courses(id, course_name, type),
                enrollment:enrollment(batch)   -- join enrollment to count students
            `);

        if (error) {
            console.error("Database error:", error);
            return res.status(400).json({ error: error.message });
        }

        // 🔄 Transform + add student_count
        const transformedData = data.map(batch => ({
            ...batch,
            center_name: batch.center?.center_name,
            teacher_name: batch.teacher?.user?.name,
            course_name: batch.course?.course_name,
            course_type: batch.course?.type,
            student_count: batch.enrollment ? batch.enrollment.length : 0, // 👈 count here
            // cleanup nested
            center: undefined,
            teacher: undefined,
            course: undefined,
            enrollment: undefined
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


const getBatchById = async (req, res) => {
    const { id } = req.params;

    try {
        const { data, error } = await supabase
            .from("batches")
            .select(`
                *,
                center:centers(center_id, center_name),
                teacher:teachers!batches_teacher_fkey(
                    teacher_id,
                    user:users(id, name)
                ),
                course:courses(id, course_name, type, level),
                assistant:teachers!batches_assistant_tutor_fkey(
                    teacher_id,
                    user:users(id, name)
                ),
                enrollment:enrollment(batch)
            `)
            .eq("batch_id", id)
            .single();

        if (error) return res.status(400).json({ error: error.message });
        if (!data) return res.status(404).json({ error: "Batch not found" });

        const transformed = {
            ...data,
            center_name: data.center?.center_name,
            teacher_name: data.teacher?.user?.name,
            course_name: data.course?.course_name,
            course_type: data.course?.type,
            assistant_tutor_name: data.assistant?.user?.name,
            student_count: data.enrollment ? data.enrollment.length : 0,
            center: undefined,
            teacher: undefined,
            course: undefined,
            assistant: undefined,
            enrollment: undefined
        };

        res.json({
            success: true,
            data: transformed
        });
    } catch (error) {
        console.error("Get batch by ID error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const updateBatch = async (req, res) => {
    const { id } = req.params;
    const { duration, center, teacher, course_id, time_from, time_to } = req.body;

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
        const { data, error } = await supabase
            .from("batches")
            .update({ batch_name, duration, center, teacher, course_id, time_from, time_to })
            .eq("batch_id", id)
            .select();

        if (error) return res.status(400).json({ error: error.message });

        res.json({ message: "Batch updated successfully", batch: data });
    } catch (err) {
        console.error("Update batch error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};


const deleteBatch = async (req, res) => {
    const { id } = req.params;

    const { error } = await supabase.from("batches").delete().eq("batch_id", id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: "Batch deleted successfully" });
};


const approveStudent = async (req, res) => {
    const { student_id } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // Fetch student details including state, center, and status
    const { data: student, error: fetchError } = await supabase
        .from("students")
        .select(`state:states(state_name), center:centers!students_center_fkey(center_name), status, email, name`)
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

let registrationNumber;
let exists = true;

while (exists) {
    const nextNumber = Math.floor(1000 + Math.random() * 9000);
    registrationNumber = `ISML${stateCode}${centerCode}${nextNumber}`;

    const { data: existingStudent } = await supabase
        .from("students")
        .select("student_id")
        .eq("registration_number", registrationNumber)
        .maybeSingle();

    if (!existingStudent) {
        exists = false;
    }
}
    // Approve student in DB
    const defaultPassword = "Isml@20$14!";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const { data, error } = await supabase
        .from("students")
        .update({ 
            status: true, 
            registration_number: registrationNumber,
            password: hashedPassword 
        })
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
            <p style="margin:10px 0 0 0; font-size:14px; color:#555;">Default Password: <b>${defaultPassword}</b></p>
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

// ==================== BATCH REQUEST CONTROLLER METHODS ====================

const createBatchRequest = async (req, res) => {
    const { duration, teacher_id, course_id, time_from, time_to, max_students, mode, justification } = req.body;

    if (!duration || !teacher_id || !course_id || !time_from || !time_to || !max_students || !mode) {
        return res.status(400).json({ error: "Missing required fields for batch request" });
    }

    try {
        // Fetch user center and state
        const { data: userProfile, error: profileErr } = await supabase
            .from("users")
            .select("center_id, state_id")
            .eq("id", req.user.id)
            .single();

        if (profileErr || !userProfile) {
            return res.status(400).json({ error: "Failed to fetch center/state profile for request" });
        }

        const { data, error } = await supabase
            .from("batch_requests")
            .insert([{
                center_id: userProfile.center_id,
                state_id: userProfile.state_id,
                requested_by: req.user.id,
                duration,
                teacher_id,
                course_id,
                time_from,
                time_to,
                max_students,
                mode,
                justification,
                status: "pending"
            }])
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        res.status(201).json({ message: "Batch request created successfully", data });
    } catch (error) {
        console.error("Create batch request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getBatchRequestsForState = async (req, res) => {
    try {
        const { data: adminProfile, error: profileErr } = await supabase
            .from("users")
            .select("state_id")
            .eq("id", req.user.id)
            .single();

        if (profileErr || !adminProfile) {
            return res.status(400).json({ error: "Failed to fetch state profile for state admin" });
        }

        const { data, error } = await supabase
            .from("batch_requests_with_details")
            .select("*")
            .eq("state_id", adminProfile.state_id)
            .order("created_at", { ascending: false });

        if (error) return res.status(400).json({ error: error.message });

        res.json({ success: true, data });
    } catch (error) {
        console.error("Get state batch requests error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getBatchRequestsForAcademic = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("batch_requests_with_details")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) return res.status(400).json({ error: error.message });

        res.json({ success: true, data });
    } catch (error) {
        console.error("Get academic batch requests error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const approveBatchRequest = async (req, res) => {
    const { requestId } = req.params;
    const { notes } = req.body;

    try {
        const updates = {};
        if (req.user.role === "state") {
            updates.status = "state_approved";
            updates.state_reviewed_by = req.user.id;
            updates.state_reviewed_at = new Date();
            updates.state_approval_notes = notes || "Approved by State Admin";
        } else if (req.user.role === "academic") {
            updates.status = "academic_approved";
            updates.academic_reviewed_by = req.user.id;
            updates.academic_reviewed_at = new Date();
            updates.academic_approval_notes = notes || "Approved by Academic Admin";
        } else {
            return res.status(403).json({ error: "Access Denied. Role not authorized to approve requests." });
        }

        const { data, error } = await supabase
            .from("batch_requests")
            .update(updates)
            .eq("request_id", requestId)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        res.json({ message: "Batch request approved successfully", data });
    } catch (error) {
        console.error("Approve batch request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const rejectBatchRequest = async (req, res) => {
    const { requestId } = req.params;
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({ error: "Rejection reason is required" });
    }

    try {
        const { data, error } = await supabase
            .from("batch_requests")
            .update({
                status: "rejected",
                rejection_reason: reason,
                rejected_by: req.user.id,
                rejected_at: new Date()
            })
            .eq("request_id", requestId)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        res.json({ message: "Batch request rejected successfully", data });
    } catch (error) {
        console.error("Reject batch request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const createBatchFromRequest = async (req, res) => {
    const { requestId } = req.params;

    try {
        // 1. Fetch batch request details
        const { data: request, error: reqErr } = await supabase
            .from("batch_requests")
            .select("*")
            .eq("request_id", requestId)
            .single();

        if (reqErr || !request) {
            return res.status(404).json({ error: "Batch request not found" });
        }

        if (request.status !== "state_approved" && request.status !== "pending") {
            // Note: In some workflows it can be approved directly or after state approval
        }

        // 2. Fetch the latest batch number
        const { data: lastBatch } = await supabase
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

        // 3. Get course name
        const { data: courseExists, error: courseError } = await supabase
            .from("courses")
            .select("course_name, type")
            .eq("id", request.course_id)
            .single();

        if (courseError || !courseExists) {
            return res.status(400).json({ error: "Invalid course ID associated with request" });
        }

        // 4. Construct batch name
        const formatToAmPm = (time) => {
            const [hours, minutes] = time.split(':');
            const d = new Date();
            d.setHours(hours, minutes);
            return d.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).replace(/\s/g, '');
        };

        const formattedFrom = formatToAmPm(request.time_from);
        const formattedTo = formatToAmPm(request.time_to);
        const batch_name = `B${newBatchNumber}-${courseExists.course_name.toUpperCase()}-${formattedFrom}-${formattedTo}`;

        // 5. Insert batch
        const { data: batchData, error: batchErr } = await supabase
            .from("batches")
            .insert([{
                batch_name,
                duration: request.duration,
                center: request.center_id,
                teacher: request.teacher_id,
                course_id: request.course_id,
                time_from: request.time_from,
                time_to: request.time_to
            }])
            .select()
            .single();

        if (batchErr) return res.status(400).json({ error: batchErr.message });

        // 6. Update batch request status and created_batch_id
        await supabase
            .from("batch_requests")
            .update({
                status: "academic_approved",
                created_batch_id: batchData.batch_id,
                academic_reviewed_by: req.user.id,
                academic_reviewed_at: new Date(),
                academic_approval_notes: "Batch created successfully from request"
            })
            .eq("request_id", requestId);

        res.status(201).json({
            message: "Batch created successfully from request",
            data: batchData
        });
    } catch (error) {
        console.error("Create batch from request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ==================== BATCH MERGE CONTROLLER METHODS ====================

const getEligibleBatchesForMerge = async (req, res) => {
    try {
        const { data: batches, error: batchErr } = await supabase
            .from("batches")
            .select(`
                batch_id,
                batch_name,
                center:centers(center_name),
                teacher:teachers(user:users(name)),
                course:courses(course_name, level)
            `)
            .eq("status", "Started");

        if (batchErr) return res.status(400).json({ error: batchErr.message });

        const { data: mergedMembers, error: memberErr } = await supabase
            .from("batch_merge_members")
            .select("batch_id");

        const mergedSet = new Set(mergedMembers ? mergedMembers.map(m => m.batch_id) : []);

        const transformed = batches.map(b => ({
            batch_id: b.batch_id,
            batch_name: b.batch_name,
            level: b.course?.level || "N/A",
            course_name: b.course?.course_name || "N/A",
            teacher_name: b.teacher?.user?.name || "N/A",
            center_name: b.center?.center_name || "N/A",
            is_merged: mergedSet.has(b.batch_id)
        }));

        res.json({ success: true, data: transformed });
    } catch (error) {
        console.error("Get eligible batches for merge error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const createMergeGroup = async (req, res) => {
    const { merge_name, batch_ids, notes } = req.body;

    if (!merge_name || !batch_ids || !Array.isArray(batch_ids) || batch_ids.length < 2) {
        return res.status(400).json({ error: "Merge name and at least 2 batches are required" });
    }

    try {
        // 1. Create the merge group
        const { data: group, error: groupErr } = await supabase
            .from("batch_merge_groups")
            .insert([{
                merge_name,
                notes,
                created_by: req.user.id,
                status: "active"
            }])
            .select()
            .single();

        if (groupErr) return res.status(400).json({ error: groupErr.message });

        // 2. Link the batches to the group
        const membersToInsert = batch_ids.map(batch_id => ({
            merge_group_id: group.merge_group_id,
            batch_id,
            added_by: req.user.id
        }));

        const { error: membersErr } = await supabase
            .from("batch_merge_members")
            .insert(membersToInsert);

        if (membersErr) {
            // Rollback group creation if member linking fails
            await supabase.from("batch_merge_groups").delete().eq("merge_group_id", group.merge_group_id);
            return res.status(400).json({ error: membersErr.message });
        }

        res.status(201).json({ success: true, data: group });
    } catch (error) {
        console.error("Create merge group error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const getMergeGroups = async (req, res) => {
    const { status } = req.query;

    try {
        let query = supabase.from("batch_merge_info").select("*");
        if (status) {
            query = query.eq("status", status);
        }

        const { data, error } = await query;
        if (error) return res.status(400).json({ error: error.message });

        // Group rows by merge_group_id
        const groups = {};
        data.forEach(row => {
            if (!groups[row.merge_group_id]) {
                groups[row.merge_group_id] = {
                    merge_group_id: row.merge_group_id,
                    merge_name: row.merge_name,
                    created_by: row.created_by,
                    created_by_name: row.created_by_name,
                    status: row.status,
                    notes: row.notes,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    batches: []
                };
            }
            if (row.batch_id) {
                groups[row.merge_group_id].batches.push({
                    batch_id: row.batch_id,
                    batch_name: row.batch_name,
                    added_at: row.added_at,
                    added_by: row.added_by,
                    added_by_name: row.added_by_name
                });
            }
        });

        res.json({ success: true, data: Object.values(groups) });
    } catch (error) {
        console.error("Get merge groups error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const deleteMergeGroup = async (req, res) => {
    const { merge_group_id } = req.params;

    try {
        // 1. Delete members first (foreign key constraint)
        const { error: membersErr } = await supabase
            .from("batch_merge_members")
            .delete()
            .eq("merge_group_id", merge_group_id);

        if (membersErr) return res.status(400).json({ error: membersErr.message });

        // 2. Delete merge group
        const { error: groupErr } = await supabase
            .from("batch_merge_groups")
            .delete()
            .eq("merge_group_id", merge_group_id);

        if (groupErr) return res.status(400).json({ error: groupErr.message });

        res.json({ success: true, message: "Merge group deleted successfully" });
    } catch (error) {
        console.error("Delete merge group error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const approveBatch = async (req, res) => {
    const { id } = req.params;

    try {
        const { data, error } = await supabase
            .from("batches")
            .update({
                status: "Approved",
                approved_by: req.user.id,
                approved_at: new Date().toISOString()
            })
            .eq("batch_id", id)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        res.json({ success: true, data });
    } catch (error) {
        console.error("Approve batch error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const rejectBatch = async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    try {
        const { data, error } = await supabase
            .from("batches")
            .update({
                status: "Rejected",
                rejection_reason
            })
            .eq("batch_id", id)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        res.json({ success: true, data });
    } catch (error) {
        console.error("Reject batch error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const startBatch = async (req, res) => {
    const { id } = req.params;
    const { start_date, total_sessions } = req.body;

    try {
        const { data, error } = await supabase
            .from("batches")
            .update({
                status: "Started",
                start_date: start_date || new Date().toISOString(),
                total_sessions: parseInt(total_sessions) || null
            })
            .eq("batch_id", id)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        res.json({ success: true, data });
    } catch (error) {
        console.error("Start batch error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

const completeBatch = async (req, res) => {
    const { id } = req.params;
    const { end_date } = req.body;

    try {
        const { data, error } = await supabase
            .from("batches")
            .update({
                status: "Completed",
                end_date: end_date || new Date().toISOString()
            })
            .eq("batch_id", id)
            .select()
            .single();

        if (error) return res.status(400).json({ error: error.message });

        res.json({ success: true, data });
    } catch (error) {
        console.error("Complete batch error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ✅ Corrected Export
module.exports = {
    createBatch,
    getBatches,
    getBatchById,
    updateBatch,
    deleteBatch,
    approveStudent,
    createBatchRequest,
    getBatchRequestsForState,
    getBatchRequestsForAcademic,
    approveBatchRequest,
    rejectBatchRequest,
    createBatchFromRequest,
    getEligibleBatchesForMerge,
    createMergeGroup,
    getMergeGroups,
    deleteMergeGroup,
    approveBatch,
    rejectBatch,
    startBatch,
    completeBatch
};
