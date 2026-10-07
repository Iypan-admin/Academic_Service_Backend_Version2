const supabase = require('../config/supabase');

/**
 * Attendance Feature Launch Date (YYYY-MM-DD in IST): 2026-10-07
 * Legacy/test sessions created prior to this date are strictly excluded.
 */
const FEATURE_START_DATE = '2026-10-07';

/**
 * Helper: Format date as YYYY-MM-DD in Asia/Kolkata
 */
const getTodayIST = () => {
    try {
        const d = new Date();
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(d);
        return parts; // Returns YYYY-MM-DD
    } catch (_) {
        return new Date().toISOString().split('T')[0];
    }
};

/**
 * Helper: Ensure timestamps without explicit timezone get parsed as UTC
 */
const normalizeUtcTimestamp = (ts) => {
    if (!ts) return null;
    const s = String(ts);
    const timePart = s.split('T')[1] || s.split(' ')[1] || '';
    if (timePart.endsWith('Z') || timePart.includes('+') || timePart.includes('-')) return s;
    return `${s}Z`;
};

/**
 * 1. Get attendance data for a batch (Sessions + Records with student details)
 * Used by Tutor Attendance Page and Academic Manager View
 */
const getBatchAttendance = async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId) {
            return res.status(400).json({ success: false, error: 'Batch ID is required' });
        }

        // Fetch batch details
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select(`
                *,
                courses (id, course_name, language),
                teacher_info:teachers!batches_teacher_fkey(
                    teacher_id,
                    user:users(id, name, full_name)
                )
            `)
            .eq('batch_id', batchId)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }

        const rawFullName = batch.teacher_info?.user?.full_name?.trim();
        const rawCodeName = batch.teacher_info?.user?.name?.trim();
        batch.teacher_name = rawFullName || rawCodeName || 'Unassigned';

        // Fetch enrolled students
        const { data: enrollments, error: enrollError } = await supabase
            .from('enrollment')
            .select(`
                student,
                students (
                    student_id,
                    name,
                    email,
                    registration_number,
                    phone
                )
            `)
            .eq('batch', batchId)
            .eq('status', true);

        if (enrollError) {
            console.warn('Enrollment fetch note:', enrollError.message);
        }

        const enrolledStudents = (enrollments || [])
            .map(e => e.students)
            .filter(Boolean)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Fetch attendance sessions for this batch (from feature launch date onwards)
        const { data: sessions, error: sessionsError } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('batch_id', batchId)
            .gte('session_date', FEATURE_START_DATE)
            .order('session_date', { ascending: false });

        if (sessionsError) {
            console.error('Error fetching sessions:', sessionsError);
            return res.status(500).json({ success: false, error: 'Failed to fetch attendance sessions' });
        }

        const sessionIds = (sessions || []).map(s => s.id);
        let records = [];

        if (sessionIds.length > 0) {
            const { data: recs, error: recsError } = await supabase
                .from('attendance_records')
                .select('*')
                .in('session_id', sessionIds);

            if (!recsError && recs) {
                records = recs;
            }
        }

        // Student map for fast lookup
        const studentMap = new Map();
        enrolledStudents.forEach(s => studentMap.set(s.student_id, s));

        // Format sessions with records and student details
        const todayDate = getTodayIST();
        let isTodayMarked = false;

        const formattedSessions = (sessions || []).map(session => {
            const sDate = session.session_date ? session.session_date.split('T')[0] : '';
            if (sDate === todayDate) {
                isTodayMarked = true;
            }

            const sessionRecs = records.filter(r => r.session_id === session.id);
            
            // Map student details into each record
            const detailedRecords = enrolledStudents.map(student => {
                const existingRec = sessionRecs.find(r => r.student_id === student.student_id);
                return {
                    id: existingRec?.id || null,
                    session_id: session.id,
                    student_id: student.student_id,
                    student_name: student.name || 'Student',
                    student_email: student.email || '',
                    student_reg_no: student.registration_number || '',
                    status: existingRec ? existingRec.status : null,
                    marked_at: normalizeUtcTimestamp(existingRec?.marked_at)
                };
            });

            const presentCount = detailedRecords.filter(r => r.status === 'present').length;
            const absentCount = detailedRecords.filter(r => r.status === 'absent').length;
            const lateCount = detailedRecords.filter(r => r.status === 'late').length;
            const total = detailedRecords.length;
            const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 0;

            return {
                id: session.id,
                batch_id: session.batch_id,
                session_date: sDate,
                notes: session.notes,
                created_at: session.created_at,
                total_students: total,
                present_count: presentCount,
                absent_count: absentCount,
                late_count: lateCount,
                attendance_percentage: percentage,
                records: detailedRecords
            };
        });

        // Summary calculations
        const totalSessions = formattedSessions.length;
        const totalPresent = formattedSessions.reduce((acc, s) => acc + s.present_count, 0);
        const totalPossible = totalSessions * enrolledStudents.length;
        const overallPercentage = totalPossible > 0 ? Math.round((totalPresent / totalPossible) * 100) : 0;

        return res.json({
            success: true,
            data: {
                batch,
                enrolled_students: enrolledStudents,
                total_enrolled: enrolledStudents.length,
                is_today_marked: isTodayMarked,
                today_date: todayDate,
                stats: {
                    total_sessions: totalSessions,
                    total_enrolled: enrolledStudents.length,
                    overall_attendance_percentage: overallPercentage
                },
                sessions: formattedSessions
            }
        });
    } catch (error) {
        console.error('Error in getBatchAttendance:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 2. Create Attendance Session (and initialize records for all enrolled students)
 */
const createAttendanceSession = async (req, res) => {
    try {
        const { batch_id, session_date, notes } = req.body;

        if (!batch_id) {
            return res.status(400).json({ success: false, error: 'batch_id is required' });
        }

        const dateStr = session_date || getTodayIST();
        const userId = req.user?.id || req.user?.user_id || req.user?.teacher_id || null;

        // Check if session already exists for this batch and date
        let { data: existingSession } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('batch_id', batch_id)
            .eq('session_date', dateStr)
            .maybeSingle();

        let session = existingSession;

        if (!session) {
            const { data: newSession, error: createError } = await supabase
                .from('attendance_sessions')
                .insert({
                    batch_id,
                    session_date: dateStr,
                    notes: notes || null,
                    created_by: userId
                })
                .select('*')
                .single();

            if (createError) {
                console.error('Failed to create session:', createError);
                return res.status(500).json({ success: false, error: createError.message });
            }
            session = newSession;
        }

        // Get enrolled students
        const { data: enrollments } = await supabase
            .from('enrollment')
            .select('student')
            .eq('batch', batch_id)
            .eq('status', true);

        const studentIds = (enrollments || []).map(e => e.student).filter(Boolean);

        // Note: We do NOT auto-insert pre-selected 'present' records here.
        // Records will be inserted/updated when tutor explicitly marks student attendance.

        return res.json({
            success: true,
            message: 'Attendance session ready',
            session
        });
    } catch (error) {
        console.error('Error in createAttendanceSession:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 3. Bulk Update Attendance Records (Save student statuses)
 */
const bulkUpdateAttendanceRecords = async (req, res) => {
    try {
        const { records } = req.body;

        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ success: false, error: 'No records provided' });
        }

        const now = new Date().toISOString();
        const updatesWithId = [];
        const insertsWithoutId = [];

        for (const r of records) {
            if (r.id) {
                updatesWithId.push(r);
            } else if (r.session_id && r.student_id) {
                insertsWithoutId.push(r);
            }
        }

        // Update records with ID
        for (const item of updatesWithId) {
            if (!item.status) {
                await supabase
                    .from('attendance_records')
                    .delete()
                    .eq('id', item.id);
            } else {
                await supabase
                    .from('attendance_records')
                    .update({
                        status: item.status,
                        marked_at: now
                    })
                    .eq('id', item.id);
            }
        }

        // Insert or upsert records without ID
        for (const item of insertsWithoutId) {
            if (!item.status) continue;

            // Check if record exists for this session & student
            const { data: existing } = await supabase
                .from('attendance_records')
                .select('id')
                .eq('session_id', item.session_id)
                .eq('student_id', item.student_id)
                .maybeSingle();

            if (existing) {
                await supabase
                    .from('attendance_records')
                    .update({
                        status: item.status,
                        marked_at: now
                    })
                    .eq('id', existing.id);
            } else {
                await supabase
                    .from('attendance_records')
                    .insert({
                        session_id: item.session_id,
                        student_id: item.student_id,
                        status: item.status,
                        marked_at: now
                    });
            }
        }

        return res.json({
            success: true,
            message: 'Attendance saved successfully'
        });
    } catch (error) {
        console.error('Error in bulkUpdateAttendanceRecords:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 4. Update Single Attendance Record
 */
const updateAttendanceRecord = async (req, res) => {
    try {
        const { recordId } = req.params;
        const { status } = req.body;

        if (!recordId) {
            return res.status(400).json({ success: false, error: 'Record ID is required' });
        }

        const { data, error } = await supabase
            .from('attendance_records')
            .update({
                status: status || 'present',
                marked_at: new Date().toISOString()
            })
            .eq('id', recordId)
            .select('*')
            .single();

        if (error) {
            return res.status(500).json({ success: false, error: error.message });
        }

        return res.json({ success: true, record: data });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 5. Get Live Class Attendance Information (For Live Studio Attendance Modal)
 */
const getLiveClassAttendance = async (req, res) => {
    try {
        const { liveClassId } = req.params;

        if (!liveClassId) {
            return res.status(400).json({ success: false, error: 'Live Class ID is required' });
        }

        // Fetch live class
        const { data: liveClass, error: classError } = await supabase
            .from('live_classes')
            .select(`
                id,
                batch_id,
                title,
                scheduled_start,
                actual_start,
                status,
                batches (
                    batch_id,
                    batch_name
                )
            `)
            .eq('id', liveClassId)
            .single();

        if (classError || !liveClass) {
            return res.status(404).json({ success: false, error: 'Live class not found' });
        }

        const batchId = liveClass.batch_id;
        const todayDate = getTodayIST();

        // Enrolled students
        const { data: enrollments } = await supabase
            .from('enrollment')
            .select(`
                student,
                students (
                    student_id,
                    name,
                    email,
                    registration_number
                )
            `)
            .eq('batch', batchId)
            .eq('status', true);

        const enrolledStudents = (enrollments || [])
            .map(e => e.students)
            .filter(Boolean)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // Check if an attendance session exists for this batch on today
        const { data: session } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('batch_id', batchId)
            .eq('session_date', todayDate)
            .maybeSingle();

        let records = [];
        if (session) {
            const { data: recs } = await supabase
                .from('attendance_records')
                .select('*')
                .eq('session_id', session.id);
            records = recs || [];
        }

        const studentListWithStatus = enrolledStudents.map(s => {
            const rec = records.find(r => r.student_id === s.student_id);
            return {
                student_id: s.student_id,
                record_id: rec?.id || null,
                name: s.name || 'Student',
                email: s.email || '',
                reg_no: s.registration_number || '',
                status: rec ? rec.status : null,
                marked_at: normalizeUtcTimestamp(rec?.marked_at)
            };
        });

        const isMarked = !!session && records.length > 0;
        const presentCount = studentListWithStatus.filter(s => s.status === 'present').length;
        const absentCount = studentListWithStatus.filter(s => s.status === 'absent').length;

        return res.json({
            success: true,
            data: {
                liveClass,
                batch_id: batchId,
                batch_name: liveClass.batches?.batch_name || 'Class',
                session_id: session?.id || null,
                session_date: todayDate,
                is_marked: isMarked,
                total_enrolled: enrolledStudents.length,
                present_count: presentCount,
                absent_count: absentCount,
                students: studentListWithStatus
            }
        });
    } catch (error) {
        console.error('Error in getLiveClassAttendance:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 6. Mark Live Class Attendance (1-click or customized from Tutor Studio)
 */
const markLiveClassAttendance = async (req, res) => {
    try {
        const { liveClassId } = req.params;
        const { session_date, notes, records } = req.body;

        if (!liveClassId) {
            return res.status(400).json({ success: false, error: 'Live Class ID is required' });
        }

        // Fetch live class
        const { data: liveClass, error: classError } = await supabase
            .from('live_classes')
            .select('id, batch_id, title')
            .eq('id', liveClassId)
            .single();

        if (classError || !liveClass) {
            return res.status(404).json({ success: false, error: 'Live class not found' });
        }

        const batchId = liveClass.batch_id;
        const dateStr = session_date || getTodayIST();
        const userId = req.user?.id || req.user?.user_id || req.user?.teacher_id || null;

        // 1. Find or create session
        let { data: session } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('batch_id', batchId)
            .eq('session_date', dateStr)
            .maybeSingle();

        if (!session) {
            const { data: newSession, error: sErr } = await supabase
                .from('attendance_sessions')
                .insert({
                    batch_id: batchId,
                    session_date: dateStr,
                    notes: notes || `Live Class: ${liveClass.title}`,
                    created_by: userId
                })
                .select('*')
                .single();

            if (sErr) {
                return res.status(500).json({ success: false, error: sErr.message });
            }
            session = newSession;
        }

        // 2. Save student records
        const now = new Date().toISOString();
        if (Array.isArray(records) && records.length > 0) {
            for (const item of records) {
                if (!item.student_id) continue;

                if (!item.status) {
                    await supabase
                        .from('attendance_records')
                        .delete()
                        .eq('session_id', session.id)
                        .eq('student_id', item.student_id);
                    continue;
                }

                const { data: existing } = await supabase
                    .from('attendance_records')
                    .select('id')
                    .eq('session_id', session.id)
                    .eq('student_id', item.student_id)
                    .maybeSingle();

                if (existing) {
                    await supabase
                        .from('attendance_records')
                        .update({
                            status: item.status,
                            marked_at: now
                        })
                        .eq('id', existing.id);
                } else {
                    await supabase
                        .from('attendance_records')
                        .insert({
                            session_id: session.id,
                            student_id: item.student_id,
                            status: item.status,
                            marked_at: now
                        });
                }
            }
        }

        return res.json({
            success: true,
            message: 'Live class attendance recorded successfully',
            session_id: session.id
        });
    } catch (error) {
        console.error('Error in markLiveClassAttendance:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 7. Academic Manager & Admin Overview (Batch-wise attendance summaries & filters)
 */
const getAcademicAttendanceOverview = async (req, res) => {
    try {
        const { batchId, date, status, teacherId } = req.query || {};
        const todayDate = date || getTodayIST();

        // 1. Fetch batches
        let batchQuery = supabase.from('batches').select(`
            batch_id,
            batch_name,
            course_id,
            teacher,
            teacher_rel:teachers!batches_teacher_fkey(
                teacher_id,
                user:users(id, name, full_name)
            ),
            start_date,
            end_date,
            status,
            courses (
                id,
                course_name,
                language
            )
        `);

        if (batchId) {
            batchQuery = batchQuery.eq('batch_id', batchId);
        }
        if (teacherId) {
            batchQuery = batchQuery.eq('teacher', teacherId);
        }

        const { data: batches, error: batchError } = await batchQuery;
        if (batchError) {
            return res.status(500).json({ success: false, error: batchError.message });
        }

        const batchIds = (batches || []).map(b => b.batch_id);

        // 2. Fetch all enrollments for these batches
        const { data: allEnrollments } = await supabase
            .from('enrollment')
            .select('batch, student')
            .in('batch', batchIds)
            .eq('status', true);

        // Group enrollment counts by batch
        const studentCountByBatch = new Map();
        (allEnrollments || []).forEach(e => {
            const count = studentCountByBatch.get(e.batch) || 0;
            studentCountByBatch.set(e.batch, count + 1);
        });

        // 3. Fetch attendance sessions (from feature launch date onwards)
        const { data: sessions } = await supabase
            .from('attendance_sessions')
            .select('*')
            .in('batch_id', batchIds)
            .gte('session_date', FEATURE_START_DATE)
            .order('session_date', { ascending: false });

        // 4. Fetch live classes scheduled across these batches
        const { data: scheduledClasses } = await supabase
            .from('live_classes')
            .select('id, batch_id, title, scheduled_start, status')
            .in('batch_id', batchIds)
            .neq('status', 'CANCELLED');

        // Batches with scheduled live class on todayDate in Asia/Kolkata (IST)
        const scheduledBatchMap = new Map();
        (scheduledClasses || []).forEach(c => {
            if (!c.scheduled_start) return;
            try {
                const classDateIST = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Asia/Kolkata',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).format(new Date(c.scheduled_start));
                if (classDateIST === todayDate) {
                    const list = scheduledBatchMap.get(c.batch_id) || [];
                    list.push(c);
                    scheduledBatchMap.set(c.batch_id, list);
                }
            } catch (_) {}
        });

        // 5. Fetch records for today's sessions
        const todaySessions = (sessions || []).filter(s => {
            const sDate = s.session_date ? s.session_date.split('T')[0] : '';
            return sDate === todayDate;
        });

        const todaySessionIds = todaySessions.map(s => s.id);
        let todayRecords = [];
        if (todaySessionIds.length > 0) {
            const { data: tRecs } = await supabase
                .from('attendance_records')
                .select('*')
                .in('session_id', todaySessionIds);
            todayRecords = tRecs || [];
        }

        // Build batch-wise overview
        const overview = (batches || []).map(batch => {
            const bSessions = (sessions || []).filter(s => s.batch_id === batch.batch_id);
            const todaySession = bSessions.find(s => {
                const sDate = s.session_date ? s.session_date.split('T')[0] : '';
                return sDate === todayDate;
            });

            const enrolledCount = studentCountByBatch.get(batch.batch_id) || 0;
            const batchClasses = scheduledBatchMap.get(batch.batch_id) || [];
            const hasScheduledClass = batchClasses.length > 0;

            let todayPresent = 0;
            let todayAbsent = 0;
            let hasMarkedRecords = false;

            if (todaySession) {
                const recs = todayRecords.filter(r => r.session_id === todaySession.id);
                todayPresent = recs.filter(r => r.status === 'present').length;
                todayAbsent = recs.filter(r => r.status === 'absent').length;
                hasMarkedRecords = recs.length > 0 && recs.some(r => r.status);
            }

            const isMarked = !!todaySession && hasMarkedRecords;

            // Determine status for this date:
            // - 'marked': attendance was recorded for this date
            // - 'pending': live class was scheduled on this date, but tutor has not marked attendance
            // - 'no_class': no live class was scheduled on this date (not pending)
            let todayStatus = 'no_class';
            if (isMarked) {
                todayStatus = 'marked';
            } else if (hasScheduledClass) {
                todayStatus = 'pending';
            } else if (todaySession) {
                todayStatus = 'pending';
            }

            const lastSessionDate = bSessions[0]?.session_date ? bSessions[0].session_date.split('T')[0] : null;

            const rawFullName = batch.teacher_rel?.user?.full_name?.trim();
            const rawCodeName = batch.teacher_rel?.user?.name?.trim();
            const cleanTeacherName = rawFullName || rawCodeName || 'Unassigned';

            return {
                batch_id: batch.batch_id,
                batch_name: batch.batch_name,
                course_name: batch.courses?.course_name || 'Language Course',
                course_language: batch.courses?.language || '',
                language: batch.courses?.language || '',
                teacher_id: batch.teacher_rel?.teacher_id || batch.teacher,
                teacher_name: cleanTeacherName,
                enrolled_students: enrolledCount,
                total_enrolled: enrolledCount,
                total_sessions: bSessions.length,
                last_session_date: lastSessionDate,
                has_scheduled_class: hasScheduledClass,
                scheduled_classes_count: batchClasses.length,
                is_marked_today: isMarked,
                today_present: todayPresent,
                today_absent: todayAbsent,
                today_status: todayStatus
            };
        });

        const { includeAll } = req.query || {};

        // By default, ONLY show batches that have scheduled live classes or attendance on todayDate.
        // Batches with no scheduled classes are excluded so the overview is clean and focused.
        const scheduledOverview = (includeAll === 'true' || includeAll === true)
            ? overview
            : overview.filter(b => b.has_scheduled_class || b.today_status === 'marked' || b.today_status === 'pending');

        // Filter by status if requested
        const filteredOverview = status && status !== 'all'
            ? scheduledOverview.filter(item => {
                if (status === 'scheduled') return item.has_scheduled_class;
                return item.today_status === status;
              })
            : scheduledOverview;

        const totalBatches = scheduledOverview.length;
        const totalScheduledClasses = scheduledOverview.reduce((acc, b) => acc + (b.scheduled_classes_count || 0), 0);
        const scheduledToday = scheduledOverview.filter(b => b.has_scheduled_class).length;
        const markedToday = scheduledOverview.filter(b => b.today_status === 'marked').length;
        const pendingToday = scheduledOverview.filter(b => b.today_status === 'pending').length;
        const noClassToday = scheduledOverview.filter(b => b.today_status === 'no_class').length;

        return res.json({
            success: true,
            data: {
                overview: filteredOverview,
                summary: {
                    total_batches: totalBatches,
                    total_scheduled_classes: totalScheduledClasses,
                    scheduled_today: scheduledToday,
                    marked_today: markedToday,
                    pending_today: pendingToday,
                    no_class_today: noClassToday,
                    today_date: todayDate
                }
            }
        });
    } catch (error) {
        console.error('Error in getAcademicAttendanceOverview:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 8. Student Batch Attendance (Compatible with Student Frontend & Student Service)
 */
const getStudentBatchAttendance = async (req, res) => {
    try {
        const { batchId } = req.params;
        const studentId = req.user?.student_id || req.user?.id || req.query.studentId;

        if (!batchId) {
            return res.status(400).json({ success: false, error: 'Batch ID is required' });
        }
        if (!studentId) {
            return res.status(400).json({ success: false, error: 'Student ID is required' });
        }

        // Fetch batch details
        const { data: batch } = await supabase
            .from('batches')
            .select('*')
            .eq('batch_id', batchId)
            .single();

        // Fetch sessions for this batch (from feature launch date onwards)
        const { data: sessions } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('batch_id', batchId)
            .gte('session_date', FEATURE_START_DATE)
            .order('session_date', { ascending: false });

        const sessionIds = (sessions || []).map(s => s.id);
        let records = [];

        if (sessionIds.length > 0) {
            const { data: recs } = await supabase
                .from('attendance_records')
                .select('*')
                .eq('student_id', studentId)
                .in('session_id', sessionIds);
            records = recs || [];
        }

        const totalSessions = (sessions || []).length;
        const presentCount = records.filter(r => r.status === 'present').length;
        const absentCount = records.filter(r => r.status === 'absent').length;
        const lateCount = records.filter(r => r.status === 'late').length;
        const percentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

        const sessionDetails = (sessions || []).map(s => {
            const rec = records.find(r => r.session_id === s.id);
            return {
                session_id: s.id,
                session_date: s.session_date ? s.session_date.split('T')[0] : '',
                status: rec ? rec.status : 'not_marked',
                marked_at: normalizeUtcTimestamp(rec?.marked_at),
                notes: s.notes || null
            };
        });

        return res.json({
            success: true,
            data: {
                batch: batch || { batch_id: batchId },
                summary: {
                    total_sessions: totalSessions,
                    present_count: presentCount,
                    absent_count: absentCount,
                    late_count: lateCount,
                    attendance_percentage: percentage
                },
                sessions: sessionDetails
            }
        });
    } catch (error) {
        console.error('Error in getStudentBatchAttendance:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    getBatchAttendance,
    createAttendanceSession,
    bulkUpdateAttendanceRecords,
    updateAttendanceRecord,
    getLiveClassAttendance,
    markLiveClassAttendance,
    getAcademicAttendanceOverview,
    getStudentBatchAttendance
};
