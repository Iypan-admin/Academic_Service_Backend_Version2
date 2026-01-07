const supabase = require("../config/supabase.js");

// Helper function to check if user is authorized for batch operations
const isUserAuthorizedForBatch = async (userId, userRole, batchTeacherId, batchAssistantTutorId = null) => {
    console.log('🔍 isUserAuthorizedForBatch called:', {
        userId,
        userRole,
        batchTeacherId,
        batchAssistantTutorId
    });
    
    if (['academic', 'manager', 'admin'].includes(userRole)) {
        console.log('✅ Admin role - authorized');
        return true; // Admin roles can access all batches
    }
    
    if (userRole === 'teacher') {
        // Check if user is the main teacher
        if (batchTeacherId) {
        console.log('🔍 Looking up teacher record for teacher_id:', batchTeacherId);
        const { data: teacherRecord, error: teacherError } = await supabase
            .from('teachers')
            .select('*')
            .eq('teacher_id', batchTeacherId)
            .single();
        
            if (!teacherError && teacherRecord && teacherRecord.teacher === userId) {
                console.log('✅ User is the main teacher - authorized');
                return true;
            }
        }
        
        // Check if user is the assistant tutor
        if (batchAssistantTutorId) {
            console.log('🔍 Looking up assistant tutor record for teacher_id:', batchAssistantTutorId);
            const { data: assistantTutorRecord, error: assistantTutorError } = await supabase
                .from('teachers')
                .select('*')
                .eq('teacher_id', batchAssistantTutorId)
                .single();
            
            if (!assistantTutorError && assistantTutorRecord && assistantTutorRecord.teacher === userId) {
                console.log('✅ User is the assistant tutor - authorized');
                return true;
        }
        }
        
        console.log('❌ User is neither main teacher nor assistant tutor');
        return false;
    }
    
    console.log('❌ No authorization - role not allowed');
    return false;
};

// Create attendance session and auto-create records for all enrolled students
const createAttendanceSession = async (req, res) => {
    try {
        const { batch_id, session_date, notes } = req.body;
        const teacherId = req.user.id;
        const userRole = req.user.role;

        if (!batch_id || !session_date) {
            return res.status(400).json({ 
                success: false, 
                error: "Batch ID and session date are required." 
            });
        }

        // 1. Validate batch exists and is started
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('status, teacher, assistant_tutor, batch_name')
            .eq('batch_id', batch_id)
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
                error: `Attendance can only be marked for 'Started' batches. Current status: ${batch.status}` 
            });
        }

        // 2. Verify teacher is assigned to this batch (or admin role) or an approved sub teacher on session_date
        let isAuthorized = await isUserAuthorizedForBatch(teacherId, userRole, batch.teacher, batch.assistant_tutor);

        if (!isAuthorized && userRole === 'teacher') {
            // Resolve current user's teachers.teacher_id
            const { data: meTeacher, error: meErr } = await supabase
                .from('teachers')
                .select('teacher_id')
                .eq('teacher', teacherId)
                .single();

            if (!meErr && meTeacher) {
                const { data: subRows, error: subErr } = await supabase
                    .from('teacher_batch_requests')
                    .select('approved_at, date_from, date_to, sub_teacher_id')
                    .eq('batch_id', batch_id)
                    .in('status', ['APPROVED','Approved'])
                    .in('sub_teacher_id', [meTeacher.teacher_id, teacherId]);

                if (!subErr) {
                    isAuthorized = (subRows || []).some(r => {
                        const visStart = r.approved_at
                            ? new Date(r.approved_at).toISOString().slice(0,10)
                            : r.date_from;
                        // Use the requested session_date for window check
                        return visStart <= session_date && r.date_to >= session_date;
                    });
                }
            }
        }
        
        if (!isAuthorized) {
            return res.status(403).json({ 
                success: false, 
                error: 'You are not authorized to create sessions for this batch.' 
            });
        }

        // 3. Check if session already exists for this date
        const { data: existingSession, error: existingError } = await supabase
            .from('attendance_sessions')
            .select('id')
            .eq('batch_id', batch_id)
            .eq('session_date', session_date)
            .single();

        if (existingSession) {
            return res.status(409).json({ 
                success: false, 
                error: `Attendance session for ${session_date} already exists for this batch.` 
            });
        }

        // 4. Create the attendance session
        const { data: session, error: createSessionError } = await supabase
            .from('attendance_sessions')
            .insert([{
                batch_id,
                session_date,
                created_by: teacherId,
                notes: notes || null
            }])
            .select()
            .single();

        if (createSessionError) {
            console.error('Error creating attendance session:', createSessionError);
            return res.status(400).json({ 
                success: false, 
                error: createSessionError.message 
            });
        }

        // 5. Get all enrolled students for the batch
        const { data: enrollments, error: enrollmentsError } = await supabase
            .from('enrollment')
            .select(`
                student
            `)
            .eq('batch', batch_id)
            .eq('status', true);

        if (enrollmentsError) {
            console.error('Error fetching enrolled students:', enrollmentsError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch enrolled students.' 
            });
        }

        console.log('🔍 Enrolled students with user_id:', enrollments);
        console.log('🔍 Number of enrolled students:', enrollments.length);

        if (enrollments.length === 0) {
            console.log('⚠️ No enrolled students found for this batch');
            return res.status(400).json({ 
                success: false, 
                error: 'No students are enrolled in this batch.' 
            });
        }

        // 6. Create attendance records for each enrolled student
        const attendanceRecords = enrollments.map(enrollment => ({
            session_id: session.id,
            student_id: enrollment.student, // enrollment.student is the student_id
            status: 'absent'
        }));

        console.log('🔍 Attendance records to create:', attendanceRecords);

        const { data: records, error: createRecordsError } = await supabase
            .from('attendance_records')
            .insert(attendanceRecords)
            .select();

        if (createRecordsError) {
            console.error('Error creating attendance records:', createRecordsError);
            // Optionally, delete the session if record creation fails
            await supabase.from('attendance_sessions').delete().eq('id', session.id);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to create attendance records for students.' 
            });
        }

        res.status(201).json({
            success: true,
            data: {
                session,
                recordsCreated: records.length,
                message: 'Attendance session created successfully.'
            }
        });

    } catch (error) {
        console.error('Server error in createAttendanceSession:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
};

// Get attendance data for a batch (role-based access)
const getBatchAttendance = async (req, res) => {
    try {
        const { id } = req.params;
        const userRole = req.user.role;
        const userId = req.user.id;
        const selectedDate = (req.query && req.query.date) ? req.query.date : new Date().toISOString().slice(0,10);

        // Validate batch exists
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('batch_id, teacher, assistant_tutor, status, batch_name')
            .eq('batch_id', id)
            .single();

        console.log('🔍 Batch lookup result:', {
            batch,
            batchError,
            batchId: id
        });

        if (batchError || !batch) {
            return res.status(404).json({ 
                success: false, 
                error: 'Batch not found.' 
            });
        }

        // Role-based access control
        let isAuthorized = await isUserAuthorizedForBatch(userId, userRole, batch.teacher, batch.assistant_tutor);

        // If not authorized yet and role is teacher, allow approved sub-teacher within visibility window
        if (!isAuthorized && userRole === 'teacher') {
            // Resolve current user's teachers.teacher_id
            const { data: meTeacher, error: meErr } = await supabase
                .from('teachers')
                .select('teacher_id')
                .eq('teacher', userId)
                .single();

            if (!meErr && meTeacher) {
                const { data: subRows, error: subErr } = await supabase
                    .from('teacher_batch_requests')
                    .select('approved_at, date_from, date_to, sub_teacher_id')
                    .eq('batch_id', id)
                    .in('status', ['APPROVED','Approved'])
                    .in('sub_teacher_id', [meTeacher.teacher_id, userId]);

                if (!subErr) {
                    isAuthorized = (subRows || []).some(r => {
                        const visStart = r.approved_at 
                            ? new Date(r.approved_at).toISOString().slice(0,10) 
                            : r.date_from;
                        return visStart <= selectedDate && r.date_to >= selectedDate;
                    });
                }
            }
        }
        
        console.log('🔍 Authorization check:', {
            userRole,
            userId,
            batchTeacher: batch.teacher,
            batchId: id,
            isAuthorized
        });
        
        if (!isAuthorized) {
            return res.status(403).json({ 
                success: false, 
                error: 'You are not authorized to view attendance for this batch.' 
            });
        }

        // Get all sessions for the batch
        const { data: sessions, error: sessionsError } = await supabase
            .from('attendance_sessions')
            .select(`
                id,
                session_date,
                notes,
                created_at,
                created_by,
                users!attendance_sessions_created_by_fkey(name)
            `)
            .eq('batch_id', id)
            .order('session_date', { ascending: false });

        if (sessionsError) {
            console.error('Error fetching sessions:', sessionsError);
            return res.status(400).json({ 
                success: false, 
                error: sessionsError.message 
            });
        }

        // Get attendance records for all sessions
        const { data: allRecords, error: recordsError } = await supabase
            .from('attendance_records')
            .select(`
                id,
                session_id,
                student_id,
                status,
                marked_at
            `)
            .in('session_id', sessions.map(s => s.id));

        if (recordsError) {
            console.error('Error fetching records:', recordsError);
            return res.status(400).json({ 
                success: false, 
                error: recordsError.message 
            });
        }

        // Get student details for all student_ids in records
        const studentIds = [...new Set(allRecords.map(record => record.student_id))];
        const { data: students, error: studentsError } = await supabase
            .from('students')
            .select('student_id, name')
            .in('student_id', studentIds);

        if (studentsError) {
            console.error('Error fetching students:', studentsError);
            return res.status(400).json({ 
                success: false, 
                error: studentsError.message 
            });
        }

        // Create a map of student_id to student name
        const studentMap = {};
        students.forEach(student => {
            studentMap[student.student_id] = student.name;
        });

        // Group records by session
        const sessionsWithRecords = sessions.map(session => {
            const sessionRecords = allRecords.filter(record => record.session_id === session.id);
            
            console.log(`🔍 Session ${session.id} records:`, {
                sessionId: session.id,
                sessionRecords,
                totalRecords: sessionRecords.length
            });
            
            // Filter records based on user role
            let filteredRecords = sessionRecords;
            if (userRole === 'student') {
                filteredRecords = sessionRecords.filter(record => record.student_id === userId);
            }

            const mappedRecords = filteredRecords.map(record => ({
                id: record.id,
                student_id: record.student_id,
                student_name: studentMap[record.student_id] || 'Unknown Student',
                status: record.status,
                marked_at: record.marked_at
            }));

            console.log(`🔍 Session ${session.id} mapped records:`, mappedRecords);

            return {
                ...session,
                created_by_name: session.users?.name,
                records: mappedRecords
            };
        });

        res.json({ 
            success: true, 
            data: {
                batch: {
                    batch_id: batch.batch_id,
                    batch_name: batch.batch_name,
                    status: batch.status
                },
                sessions: sessionsWithRecords
            }
        });

    } catch (error) {
        console.error('Server error in getBatchAttendance:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
};

// Update individual attendance record
const updateAttendanceRecord = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const teacherId = req.user.id;

        if (!status || !['present', 'absent', 'late', 'excused'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                error: "Valid status is required (present, absent, late, excused)." 
            });
        }

        // 1. Validate record exists and teacher has access
        const { data: record, error: recordError } = await supabase
            .from('attendance_records')
            .select(`
                id,
                session_id,
                attendance_sessions!inner(
                    batch_id,
                    session_date,
                    batches!inner(teacher, assistant_tutor, status)
                )
            `)
            .eq('id', id)
            .single();

        if (recordError || !record) {
            return res.status(404).json({ 
                success: false, 
                error: 'Attendance record not found.' 
            });
        }

        // Check if batch is started
        if (record.attendance_sessions.batches.status !== 'Started') {
            return res.status(400).json({ 
                success: false, 
                error: 'Attendance can only be marked for started batches.' 
            });
        }

        // Check if teacher is assigned to this batch (or admin role) OR is approved sub on session date
        const userRole = req.user.role;
        let isAuthorized = await isUserAuthorizedForBatch(teacherId, userRole, record.attendance_sessions.batches.teacher, record.attendance_sessions.batches.assistant_tutor);

        if (!isAuthorized && userRole === 'teacher') {
            // Resolve current user's teachers.teacher_id
            const { data: meTeacher, error: meErr } = await supabase
                .from('teachers')
                .select('teacher_id')
                .eq('teacher', teacherId)
                .single();

            if (!meErr && meTeacher) {
                const { data: subRows, error: subErr } = await supabase
                    .from('teacher_batch_requests')
                    .select('approved_at, date_from, date_to, sub_teacher_id')
                    .eq('batch_id', record.attendance_sessions.batch_id)
                    .in('status', ['APPROVED','Approved'])
                    .in('sub_teacher_id', [meTeacher.teacher_id, teacherId]);

                if (!subErr) {
                    const sessionDate = new Date(record.attendance_sessions.session_date).toISOString().slice(0,10);
                    isAuthorized = (subRows || []).some(r => {
                        const visStart = r.approved_at
                            ? new Date(r.approved_at).toISOString().slice(0,10)
                            : r.date_from;
                        return visStart <= sessionDate && r.date_to >= sessionDate;
                    });
                }
            }
        }
        
        if (!isAuthorized) {
            return res.status(403).json({ 
                success: false, 
                error: 'You are not authorized to update this attendance record.' 
            });
        }

        // 2. Update the attendance record
        const { data, error } = await supabase
            .from('attendance_records')
            .update({
                status,
                marked_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error updating attendance record:', error);
            return res.status(400).json({ 
                success: false, 
                error: error.message 
            });
        }

        res.json({ 
            success: true, 
            data: {
                record: data,
                message: 'Attendance record updated successfully.'
            }
        });

    } catch (error) {
        console.error('Server error in updateAttendanceRecord:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
};

// Debug endpoint to check teacher assignment
const debugTeacherAssignment = async (req, res) => {
    try {
        const { batchId } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;

        console.log('🔍 Debug teacher assignment:', {
            batchId,
            userId,
            userRole
        });

        // Get batch info
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('batch_id, teacher, status, batch_name')
            .eq('batch_id', batchId)
            .single();

        if (batchError || !batch) {
            return res.json({
                success: false,
                error: 'Batch not found',
                batchError
            });
        }

        // Get teacher info
        const { data: teacherRecord, error: teacherError } = await supabase
            .from('teachers')
            .select('*')
            .eq('teacher_id', batch.teacher)
            .single();

        // Get user info
        const { data: userRecord, error: userError } = await supabase
            .from('users')
            .select('id, name, role')
            .eq('id', userId)
            .single();

        res.json({
            success: true,
            data: {
                batch,
                teacherRecord,
                teacherError,
                teacherColumns: teacherRecord ? Object.keys(teacherRecord) : null,
                userRecord,
                userError,
                isAuthorized: teacherRecord && teacherRecord.teacher === userId
            }
        });

    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// Bulk update attendance records
const bulkUpdateAttendanceRecords = async (req, res) => {
    try {
        const { records } = req.body;
        const teacherId = req.user.id;
        const userRole = req.user.role;

        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Records array is required"
            });
        }

        for (const record of records) {
            const { id, status } = record;

            if (!id || !['present', 'absent', 'late', 'excused'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid record data"
                });
            }

            // Fetch record with batch info for authorization
            const { data: existing, error: fetchErr } = await supabase
                .from('attendance_records')
                .select(`
                    id,
                    attendance_sessions!inner(
                        session_date,
                        batches!inner(teacher, assistant_tutor, status)
                    )
                `)
                .eq('id', id)
                .single();

            if (fetchErr || !existing) {
                return res.status(404).json({
                    success: false,
                    error: `Attendance record not found: ${id}`
                });
            }

            if (existing.attendance_sessions.batches.status !== 'Started') {
                return res.status(400).json({
                    success: false,
                    error: "Batch not started"
                });
            }

            // Authorization check
            const isAuthorized = await isUserAuthorizedForBatch(
                teacherId,
                userRole,
                existing.attendance_sessions.batches.teacher,
                existing.attendance_sessions.batches.assistant_tutor
            );

            if (!isAuthorized) {
                return res.status(403).json({
                    success: false,
                    error: "Not authorized to update attendance"
                });
            }

            await supabase
                .from('attendance_records')
                .update({
                    status,
                    marked_at: new Date().toISOString()
                })
                .eq('id', id);
        }

        res.json({
            success: true,
            message: "Attendance updated successfully"
        });

    } catch (error) {
        console.error("Bulk update error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};


module.exports = {
  createAttendanceSession,
  getBatchAttendance,
  updateAttendanceRecord,
  bulkUpdateAttendanceRecords,
  debugTeacherAssignment
};
