const supabase = require('../config/supabase');
const livekitService = require('../services/livekitService');
const admissionsManager = require('../services/admissionsManager');

/**
 * Format timestamp in Asia/Kolkata (IST)
 */
function formatIST(isoDate) {
    try {
        return new Date(isoDate).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (_) {
        return 'IST';
    }
}

/**
 * Helper: Detect schedule conflicts for a batch or tutor
 */
async function detectScheduleConflict({ excludeClassId, batchId, teacherId, startIso, endIso }) {
    if (!startIso || !endIso) return null;

    let query = supabase
        .from('live_classes')
        .select(`
            id,
            title,
            session_number,
            batch_id,
            teacher_id,
            scheduled_start,
            scheduled_end,
            status,
            batches:batch_id(batch_name),
            teachers:teacher_id(name, full_name)
        `)
        .neq('status', 'CANCELLED')
        .lt('scheduled_start', endIso)
        .gt('scheduled_end', startIso);

    if (excludeClassId) {
        query = query.neq('id', excludeClassId);
    }

    const { data: overlapping, error } = await query;
    if (error) {
        console.warn('Conflict detection query notice:', error.message);
        return null;
    }

    if (!overlapping || overlapping.length === 0) return null;

    // 1. Check Batch Conflict (Same batch cannot have 2 classes at the same time)
    if (batchId) {
        const batchConflict = overlapping.find(c => c.batch_id === batchId);
        if (batchConflict) {
            const bName = batchConflict.batches?.batch_name || 'Selected batch';
            const sTime = formatIST(batchConflict.scheduled_start);
            const eTime = formatIST(batchConflict.scheduled_end);
            return {
                type: 'BATCH_CONFLICT',
                message: `Schedule Conflict: ${bName} already has another live class "${batchConflict.title}" scheduled from ${sTime} to ${eTime} IST.`,
                conflictClass: batchConflict
            };
        }
    }

    // 2. Check Tutor Conflict (Same tutor cannot teach 2 classes at the same time)
    if (teacherId) {
        const tutorConflict = overlapping.find(c => c.teacher_id === teacherId);
        if (tutorConflict) {
            const tName = tutorConflict.teachers?.full_name || tutorConflict.teachers?.name || 'Assigned tutor';
            const sTime = formatIST(tutorConflict.scheduled_start);
            const eTime = formatIST(tutorConflict.scheduled_end);
            return {
                type: 'TUTOR_CONFLICT',
                message: `Tutor Conflict: ${tName} already has another live class "${tutorConflict.title}" scheduled from ${sTime} to ${eTime} IST.`,
                conflictClass: tutorConflict
            };
        }
    }

    return null;
}

/**
 * 1. Schedule a new Live Class (Academic Manager / Admin)
 */
async function scheduleLiveClass(req, res) {
    try {
        const {
            batch_id,
            course_id,
            teacher_id,
            title,
            description,
            session_number,
            scheduled_start,
            scheduled_end,
            recording_enabled = true
        } = req.body;

        if (!batch_id || !title || !scheduled_start || !scheduled_end) {
            return res.status(400).json({
                error: 'batch_id, title, scheduled_start, and scheduled_end are required'
            });
        }

        // Resolve teacher_id to users.id if teachers.teacher_id was passed
        let resolvedTeacherId = teacher_id || null;
        if (resolvedTeacherId) {
            const { data: tRow } = await supabase
                .from('teachers')
                .select('teacher')
                .eq('teacher_id', resolvedTeacherId)
                .maybeSingle();
            if (tRow && tRow.teacher) {
                resolvedTeacherId = tRow.teacher;
            }
        }

        // Check for schedule conflicts before creating
        const conflict = await detectScheduleConflict({
            batchId: batch_id,
            teacherId: resolvedTeacherId,
            startIso: scheduled_start,
            endIso: scheduled_end
        });

        if (conflict) {
            return res.status(409).json({ error: conflict.message, conflict });
        }

        // Room name convention: isml_batch_<batchId>_<timestamp>
        const room_name = `isml_batch_${batch_id.replace(/-/g, '').slice(0, 10)}_${Date.now()}`;

        const { data, error } = await supabase
            .from('live_classes')
            .insert([{
                batch_id,
                course_id: course_id || null,
                teacher_id: resolvedTeacherId,
                title,
                description: description || null,
                session_number: session_number || 1,
                room_name,
                scheduled_start,
                scheduled_end,
                status: 'SCHEDULED',
                recording_enabled: Boolean(recording_enabled),
                created_by: req.user?.id || null
            }])
            .select(`
                *,
                batches:batch_id(batch_id, batch_name),
                courses:course_id(id, course_name, language),
                teachers:teacher_id(id, name, full_name)
            `)
            .single();

        if (error) {
            console.error('Error scheduling live class:', error);
            return res.status(500).json({ error: error.message });
        }

        // Pre-create room in LiveKit
        await livekitService.createRoom(room_name);

        res.status(201).json({
            message: 'Live class scheduled successfully',
            liveClass: data
        });
    } catch (err) {
        console.error('Exception in scheduleLiveClass:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * 2. Get Live Classes (with optional filters: batch_id, teacher_id, status, date)
 */
async function getLiveClasses(req, res) {
    try {
        const { batch_id, teacher_id, status, date } = req.query;

        // Auto-complete any active classes whose scheduled_end has passed
        const nowIso = new Date().toISOString();
        try {
            await supabase
                .from('live_classes')
                .update({ status: 'COMPLETED', updated_at: nowIso })
                .in('status', ['LIVE', 'SCHEDULED'])
                .lt('scheduled_end', nowIso);
        } catch (autoErr) {
            console.warn('Auto-complete expired sessions note:', autoErr.message);
        }

        let query = supabase
            .from('live_classes')
            .select(`
                *,
                batches:batch_id(batch_id, batch_name),
                courses:course_id(id, course_name, language),
                teachers:teacher_id(id, name, full_name)
            `)
            .order('scheduled_start', { ascending: true });

        if (batch_id) query = query.eq('batch_id', batch_id);
        if (teacher_id) {
            query = query.eq('teacher_id', teacher_id);
        } else if (req.user?.role === 'teacher' && req.user?.id) {
            query = query.eq('teacher_id', req.user.id);
        }
        if (status) query = query.eq('status', status);
        if (date) {
            const startOfDay = `${date}T00:00:00Z`;
            const endOfDay = `${date}T23:59:59Z`;
            query = query.gte('scheduled_start', startOfDay).lte('scheduled_start', endOfDay);
        }

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });

        res.json({ liveClasses: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 3. Get single Live Class details
 */
async function getLiveClassById(req, res) {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('live_classes')
            .select(`
                *,
                batches:batch_id(batch_id, batch_name),
                courses:course_id(id, course_name, language),
                teachers:teacher_id(id, name, full_name),
                recordings:live_class_recordings(*)
            `)
            .eq('id', id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Live class not found' });
        }

        res.json({ liveClass: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 4. Start Live Class (Tutor)
 * - Updates status to 'LIVE'
 * - Creates LiveKit room
 * - Triggers auto-recording egress if recording_enabled
 * - Returns tutor JWT token + room details
 */
async function startLiveClass(req, res) {
    try {
        const { id } = req.params;

        const { data: liveClass, error } = await supabase
            .from('live_classes')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !liveClass) {
            return res.status(404).json({ error: 'Live class not found' });
        }

        if (liveClass.status === 'CANCELLED') {
            return res.status(400).json({ error: 'Cannot start a cancelled class' });
        }

        // Check if session has exceeded its scheduled_end time (with 60-min grace period)
        const nowMs = Date.now();
        const endMs = new Date(liveClass.scheduled_end).getTime();
        if (nowMs > endMs + 60 * 60 * 1000) {
            const istEndTime = formatIST(liveClass.scheduled_end);
            return res.status(403).json({
                error: `This live class schedule ended at ${istEndTime} IST. Studio launching is closed.`,
                code: 'SCHEDULE_EXPIRED'
            });
        }

        // Assigned tutor, teacher, admin or academic coordinator can start/host the class
        const isAuthorized = req.user?.role === 'teacher' || 
                             req.user?.role === 'admin' || 
                             req.user?.role === 'academic' || 
                             req.user?.id === liveClass.teacher_id;
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Only the assigned tutor or administrator can start this live class session.' });
        }

        const roomName = liveClass.room_name;

        // Ensure room exists in LiveKit
        await livekitService.createRoom(roomName);

        const isAlreadyLive = liveClass.status === 'LIVE';
        // When tutor starts, or if restart is requested, or if previous actual_start was over 2 hours ago, start fresh from now
        const restartRequested = req.query.restart === 'true' || req.body?.restart === true;
        const isStaleStart = liveClass.actual_start && (nowMs - new Date(liveClass.actual_start).getTime() > 2 * 60 * 60 * 1000);
        const actualStart = (!isAlreadyLive || restartRequested || isStaleStart || !liveClass.actual_start)
            ? new Date().toISOString()
            : liveClass.actual_start;

        await supabase
            .from('live_classes')
            .update({
                status: 'LIVE',
                actual_start: actualStart,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        // Start Auto-Recording if enabled and not already running
        let egressId = null;
        let recRes = null;
        if (liveClass.recording_enabled && !isAlreadyLive) {
            try {
                recRes = await livekitService.startRecording({
                    roomName,
                    liveClassId: liveClass.id,
                    batchId: liveClass.batch_id
                });
                egressId = recRes?.egressId || null;
            } catch (recErr) {
                console.warn('Recording start notice:', recErr.message);
            }

            // Check if recording row already exists for this class to prevent duplicates
            const { data: existingRec } = await supabase
                .from('live_class_recordings')
                .select('id')
                .eq('live_class_id', liveClass.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (existingRec) {
                await supabase
                    .from('live_class_recordings')
                    .update({
                        egress_id: egressId,
                        status: 'RECORDING',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingRec.id);
            } else {
                await supabase
                    .from('live_class_recordings')
                    .insert([{
                        live_class_id: liveClass.id,
                        batch_id: liveClass.batch_id,
                        egress_id: egressId,
                        storage_object_path: recRes?.filepath || null,
                        status: 'RECORDING'
                    }]);
            }
        }

        // Generate Token for Host (Tutor or Academic Manager)
        const isAcademic = req.user?.role === 'academic';
        const isAdmin = req.user?.role === 'admin';
        const roleLabel = isAcademic ? 'Academic Manager' : (isAdmin ? 'Administrator' : 'Tutor');
        const tokenName = req.user?.full_name || req.user?.name || roleLabel;

        const token = await livekitService.generateToken({
            roomName,
            identity: req.user?.id ? (isAcademic ? `academic_${req.user.id}` : `tutor_${req.user.id}`) : (isAcademic ? `academic_${Date.now()}` : `tutor_${liveClass.teacher_id}`),
            name: tokenName,
            isTeacher: true,
            metadata: JSON.stringify({
                role: req.user?.role || (isAcademic ? 'academic' : 'teacher'),
                roleLabel: isAcademic ? 'Academic Manager' : (isAdmin ? 'Administrator' : 'Instructor (Host)'),
                isAcademic,
                isAdmin,
                isTeacher: true
            })
        });

        res.json({
            message: 'Live class started successfully',
            status: 'LIVE',
            roomName,
            wsUrl: livekitService.LIVEKIT_URL,
            token,
            egressId,
            recordingActive: Boolean(liveClass.recording_enabled)
        });
    } catch (err) {
        console.error('Error starting live class:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * 5. Join Live Class (Student / Tutor / Academic Manager)
 * - Verifies user identity
 * - Generates participant LiveKit JWT Token
 */
async function joinLiveClass(req, res) {
    try {
        const { id } = req.params;

        const { data: liveClass, error } = await supabase
            .from('live_classes')
            .select(`
                *,
                batches:batch_id(batch_id, batch_name),
                courses:course_id(id, course_name, language),
                teachers:teacher_id(id, name, full_name)
            `)
            .eq('id', id)
            .single();

        if (error || !liveClass) {
            return res.status(404).json({ error: 'Live class not found' });
        }

        if (liveClass.status === 'CANCELLED') {
            return res.status(400).json({ error: 'This class has been cancelled' });
        }

        // Check if session has exceeded its scheduled_end time (with 60-min grace period)
        const nowMs = Date.now();
        const endMs = new Date(liveClass.scheduled_end).getTime();
        if (nowMs > endMs + 60 * 60 * 1000) {
            const istEndTime = formatIST(liveClass.scheduled_end);
            return res.status(403).json({
                error: `This live class session concluded at ${istEndTime} IST. Classroom entry is closed.`,
                code: 'SCHEDULE_EXPIRED'
            });
        }

        const isAcademic = req.user?.role === 'academic';
        const isAdmin = req.user?.role === 'admin';
        const isTeacherRole = req.user?.role === 'teacher' || req.user?.id === liveClass.teacher_id;
        const isHost = isTeacherRole;
        const isInspector = isAcademic || isAdmin;

        // If it's a student, verify admission approval
        if (!isHost && !isInspector) {
            const studentId = req.user?.student_id || req.user?.id;
            const admission = admissionsManager.getStatus(id, studentId);
            if (!admission || admission.status !== 'APPROVED') {
                return res.status(403).json({
                    error: 'Admission required. Please request to join and wait for tutor approval.',
                    status: admission?.status || 'PENDING'
                });
            }
        }

        const roleLabel = isAcademic ? 'Academic Manager' : (isAdmin ? 'Administrator' : (isHost ? 'Instructor (Host)' : 'Student'));
        const identity = isInspector
            ? `academic_${req.user?.id || Date.now()}`
            : (isHost ? `tutor_${req.user?.id || liveClass.teacher_id}` : (req.user?.student_id || req.user?.id || `user_${Date.now()}`));
        const defaultRoleName = roleLabel;
        let displayName = req.user?.full_name || req.user?.name;

        // If student name is missing or default, resolve from students table
        if (!displayName && !isInspector && !isHost) {
            const stdId = req.user?.student_id || req.user?.id;
            if (stdId) {
                const { data: stdRecord } = await supabase
                    .from('students')
                    .select('name, registration_number')
                    .eq('student_id', stdId)
                    .single();
                if (stdRecord?.name) {
                    displayName = stdRecord.name;
                }
            }
        }
        if (!displayName) {
            displayName = defaultRoleName;
        }

        const token = await livekitService.generateToken({
            roomName: liveClass.room_name,
            identity,
            name: displayName,
            isTeacher: isHost,
            metadata: JSON.stringify({
                role: req.user?.role || (isAcademic ? 'academic' : (isAdmin ? 'admin' : (isHost ? 'teacher' : 'student'))),
                roleLabel,
                isAcademic,
                isAdmin,
                isTeacher: isHost
            })
        });

        res.json({
            token,
            wsUrl: livekitService.LIVEKIT_URL,
            roomName: liveClass.room_name,
            liveClass,
            isTeacher: isHost,
            isInspector
        });
    } catch (err) {
        console.error('Error joining live class:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * 6. End Live Class (Tutor / Academic Manager)
 * - Stops recording
 * - Updates status to 'COMPLETED'
 * - Closes LiveKit room
 */
async function endLiveClass(req, res) {
    try {
        const { id } = req.params;

        const { data: liveClass, error } = await supabase
            .from('live_classes')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !liveClass) {
            return res.status(404).json({ error: 'Live class not found' });
        }

        // Allow assigned tutor, teacher, admin or academic coordinator to end the class
        const isAuthorized = req.user?.role === 'teacher' || 
                             req.user?.role === 'admin' || 
                             req.user?.role === 'academic' || 
                             req.user?.id === liveClass.teacher_id;
        if (!isAuthorized) {
            return res.status(403).json({
                error: 'Only the assigned tutor or administrator can end this live class session.'
            });
        }

        // 1. FIRST PRIORITY: Immediately mark class as COMPLETED in Supabase
        const actualEnd = new Date().toISOString();
        const updateData = {
            status: 'COMPLETED',
            actual_end: actualEnd,
            updated_at: actualEnd
        };

        const topics = req.body?.topics_covered || req.body?.description;
        if (topics && typeof topics === 'string' && topics.trim()) {
            updateData.description = topics.trim();
        }

        await supabase
            .from('live_classes')
            .update(updateData)
            .eq('id', id);

        // 2. Clear active admissions for this session
        try {
            admissionsManager.clearClass(id);
        } catch (_) {}

        // 3. Finalize recordings in safe background task
        try {
            const { data: allRecs } = await supabase
                .from('live_class_recordings')
                .select('*')
                .eq('live_class_id', id)
                .order('created_at', { ascending: false });

            if (allRecs && allRecs.length > 0) {
                for (const r of allRecs) {
                    const egId = r.egress_id || r.egressId;
                    if (egId) await livekitService.stopRecording(egId).catch(() => {});
                }

                const bestRec = allRecs.find(r => r.storage_object_path) || allRecs[0];
                await supabase
                    .from('live_class_recordings')
                    .update({
                        status: 'READY',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', bestRec.id);

                const duplicateIds = allRecs.filter(r => r.id !== bestRec.id).map(r => r.id);
                if (duplicateIds.length > 0) {
                    await supabase
                        .from('live_class_recordings')
                        .delete()
                        .in('id', duplicateIds);
                }
            }
        } catch (recErr) {
            console.warn('Recording finalize note:', recErr.message);
        }

        // 4. Safely close LiveKit room in background
        try {
            await livekitService.deleteRoom(liveClass.room_name).catch(() => {});
        } catch (roomErr) {
            console.warn('Delete room note:', roomErr.message);
        }

        return res.json({
            message: 'Live class completed and recording submitted for processing',
            status: 'COMPLETED'
        });
    } catch (err) {
        console.error('Error ending live class:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * Reset Live Class Session Timer (Sets actual_start to now)
 */
async function resetLiveClassTimer(req, res) {
    try {
        const { id } = req.params;
        const now = new Date().toISOString();
        await supabase
            .from('live_classes')
            .update({
                actual_start: now,
                updated_at: now
            })
            .eq('id', id);

        res.json({ message: 'Live class timer reset successfully', actual_start: now });
    } catch (err) {
        console.error('Error resetting live class timer:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * 7. Update / Reschedule Live Class (Academic Manager)
 */
async function updateLiveClass(req, res) {
    try {
        const { id } = req.params;
        const updates = { ...req.body };

        // Fetch current live class details
        const { data: currentClass, error: fetchErr } = await supabase
            .from('live_classes')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !currentClass) {
            return res.status(404).json({ error: 'Live class not found' });
        }

        // Resolve teacher_id if provided
        let resolvedTeacherId = updates.teacher_id !== undefined ? updates.teacher_id : currentClass.teacher_id;
        if (resolvedTeacherId) {
            const { data: tRow } = await supabase
                .from('teachers')
                .select('teacher')
                .eq('teacher_id', resolvedTeacherId)
                .maybeSingle();
            if (tRow && tRow.teacher) {
                resolvedTeacherId = tRow.teacher;
            }
            updates.teacher_id = resolvedTeacherId;
        }

        const batchId = updates.batch_id || currentClass.batch_id;
        const startIso = updates.scheduled_start || currentClass.scheduled_start;
        const endIso = updates.scheduled_end || currentClass.scheduled_end;

        // Check for schedule conflicts
        const conflict = await detectScheduleConflict({
            excludeClassId: id,
            batchId,
            teacherId: resolvedTeacherId,
            startIso,
            endIso
        });

        if (conflict) {
            return res.status(409).json({ error: conflict.message, conflict });
        }

        // If new schedule is in the future and class was COMPLETED, restore to SCHEDULED
        const nowMs = Date.now();
        const newEndMs = new Date(endIso).getTime();
        if (newEndMs > nowMs && currentClass.status === 'COMPLETED') {
            updates.status = 'SCHEDULED';
        }

        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('live_classes')
            .update(updates)
            .eq('id', id)
            .select(`
                *,
                batches:batch_id(batch_id, batch_name),
                courses:course_id(id, course_name, language),
                teachers:teacher_id(id, name, full_name)
            `)
            .single();

        if (error) return res.status(500).json({ error: error.message });
        res.json({ message: 'Live class updated successfully', liveClass: data });
    } catch (err) {
        console.error('Error updating live class:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * Check schedule conflict endpoint (Real-time pre-check)
 */
async function checkScheduleConflictEndpoint(req, res) {
    try {
        const { excludeClassId, batchId, teacherId, scheduledStart, scheduledEnd } = req.body;
        let resolvedTeacherId = teacherId || null;
        if (resolvedTeacherId) {
            const { data: tRow } = await supabase
                .from('teachers')
                .select('teacher')
                .eq('teacher_id', resolvedTeacherId)
                .maybeSingle();
            if (tRow && tRow.teacher) {
                resolvedTeacherId = tRow.teacher;
            }
        }

        const conflict = await detectScheduleConflict({
            excludeClassId,
            batchId,
            teacherId: resolvedTeacherId,
            startIso: scheduledStart,
            endIso: scheduledEnd
        });
        res.json({ conflict });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 8. Delete / Cancel Live Class
 */
async function deleteLiveClass(req, res) {
    try {
        const { id } = req.params;

        const { data: liveClass } = await supabase
            .from('live_classes')
            .select('room_name')
            .eq('id', id)
            .single();

        if (liveClass?.room_name) {
            await livekitService.deleteRoom(liveClass.room_name);
        }

        const { error } = await supabase
            .from('live_classes')
            .delete()
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });
        res.json({ message: 'Live class deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 9. Request Join / Knock on Classroom (Student / Any)
 */
async function requestJoinClass(req, res) {
    try {
        const { id } = req.params;

        // Check if session has exceeded its scheduled_end time
        const { data: targetClass } = await supabase
            .from('live_classes')
            .select('id, scheduled_start, scheduled_end, status')
            .eq('id', id)
            .single();

        if (targetClass) {
            const nowMs = Date.now();
            const endMs = new Date(targetClass.scheduled_end).getTime();
            if (nowMs > endMs || targetClass.status === 'COMPLETED') {
                const istEndTime = formatIST(targetClass.scheduled_end);
                return res.status(403).json({
                    error: `This live class schedule ended at ${istEndTime} IST. Classroom entry is closed.`,
                    code: 'SCHEDULE_EXPIRED'
                });
            }
        }

        const isAcademic = req.user?.role === 'academic' || req.user?.role === 'admin';
        const isTeacherRole = req.user?.role === 'teacher';

        // Academic Managers, Admins, and Teachers are automatically approved without asking anyone
        if (isAcademic || isTeacherRole) {
            return res.json({ status: 'APPROVED', direct: true });
        }

        const studentId = req.user?.student_id || req.user?.id;
        let studentName = req.body?.student_name || req.body?.name || req.user?.name || req.user?.full_name;
        let regNo = req.body?.registration_number || req.body?.reg_no || req.user?.registration_number;

        // Fetch actual student details from DB if missing or default
        if (studentId && (!studentName || !regNo || studentName === 'Student' || regNo === studentId)) {
            try {
                const { data: studentRecord } = await supabase
                    .from('students')
                    .select('name, registration_number, email')
                    .eq('student_id', studentId)
                    .single();

                if (studentRecord) {
                    if (!studentName || studentName === 'Student') {
                        studentName = studentRecord.name || studentRecord.email;
                    }
                    if (!regNo || regNo === studentId) {
                        regNo = studentRecord.registration_number || studentRecord.email || studentId;
                    }
                }
            } catch (fetchErr) {
                console.error('Error fetching student details for requestJoinClass:', fetchErr.message);
            }
        }

        studentName = studentName || 'Student';
        regNo = regNo || studentId;

        const request = admissionsManager.requestJoin(id, studentId, studentName, regNo);
        res.json({
            status: request.status,
            request,
            message: request.status === 'APPROVED' ? 'Approved' : 'Join request submitted. Waiting for tutor approval.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 10. Check Join Status (Student polling)
 */
async function getJoinStatus(req, res) {
    try {
        const { id } = req.params;
        const isAcademic = req.user?.role === 'academic' || req.user?.role === 'admin';
        const isTeacherRole = req.user?.role === 'teacher';

        if (isAcademic || isTeacherRole) {
            return res.json({ status: 'APPROVED' });
        }

        const studentId = req.user?.student_id || req.user?.id;
        const admission = admissionsManager.getStatus(id, studentId);

        if (!admission) {
            return res.json({ status: 'NOT_REQUESTED' });
        }

        if (admission.status === 'APPROVED') {
            const { data: liveClass } = await supabase
                .from('live_classes')
                .select(`
                    *,
                    batches:batch_id(batch_id, batch_name),
                    courses:course_id(id, course_name, language),
                    teachers:teacher_id(id, name, full_name)
                `)
                .eq('id', id)
                .single();

            if (liveClass) {
                let resolvedName = admission.studentName || req.user?.name || req.user?.full_name;
                if (!resolvedName || resolvedName === 'Student') {
                    try {
                        const { data: stdRecord } = await supabase
                            .from('students')
                            .select('name')
                            .eq('student_id', studentId)
                            .single();
                        if (stdRecord?.name) resolvedName = stdRecord.name;
                    } catch (e) {}
                }

                const token = await livekitService.generateToken({
                    roomName: liveClass.room_name,
                    identity: studentId,
                    name: resolvedName || 'Student',
                    isTeacher: false,
                    metadata: JSON.stringify({
                        role: 'student',
                        roleLabel: 'Student',
                        isAcademic: false,
                        isAdmin: false,
                        isTeacher: false
                    })
                });

                return res.json({
                    status: 'APPROVED',
                    token,
                    wsUrl: livekitService.LIVEKIT_URL,
                    roomName: liveClass.room_name,
                    liveClass
                });
            }
        }

        res.json({ status: admission.status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 11. Get Pending Join Requests (Tutor Studio)
 */
async function getJoinRequests(req, res) {
    try {
        const { id } = req.params;
        const requests = admissionsManager.getPendingRequests(id);
        res.json({ requests });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 12. Admit a Student (Tutor only)
 */
async function admitStudent(req, res) {
    try {
        const { id } = req.params;
        const student_id = req.body.student_id || req.body.studentId;

        if (!student_id) {
            return res.status(400).json({ error: 'student_id is required' });
        }

        const { data: liveClass } = await supabase
            .from('live_classes')
            .select('teacher_id')
            .eq('id', id)
            .single();

        const isTutor = req.user?.role === 'teacher' || req.user?.id === liveClass?.teacher_id;
        if (!isTutor) {
            return res.status(403).json({ error: 'Only the assigned tutor can approve students to join.' });
        }

        const admission = admissionsManager.admitStudent(id, student_id);
        res.json({ success: true, status: 'APPROVED', admission, message: 'Student admitted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 13. Admit All Pending Students (Tutor only)
 */
async function admitAllStudents(req, res) {
    try {
        const { id } = req.params;

        const { data: liveClass } = await supabase
            .from('live_classes')
            .select('teacher_id')
            .eq('id', id)
            .single();

        const isTutor = req.user?.role === 'teacher' || req.user?.id === liveClass?.teacher_id;
        if (!isTutor) {
            return res.status(403).json({ error: 'Only the assigned tutor can approve students to join.' });
        }

        const count = admissionsManager.admitAll(id);
        res.json({ success: true, count, message: `${count} student(s) admitted` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 14. Reject a Student (Tutor only)
 */
async function rejectStudent(req, res) {
    try {
        const { id } = req.params;
        const student_id = req.body.student_id || req.body.studentId;

        if (!student_id) {
            return res.status(400).json({ error: 'student_id is required' });
        }

        const { data: liveClass } = await supabase
            .from('live_classes')
            .select('teacher_id')
            .eq('id', id)
            .single();

        const isTutor = req.user?.role === 'teacher' || req.user?.id === liveClass?.teacher_id;
        if (!isTutor) {
            return res.status(403).json({ error: 'Only the assigned tutor can reject students.' });
        }

        const admission = admissionsManager.rejectStudent(id, student_id);
        res.json({ success: true, status: 'REJECTED', admission, message: 'Student entry declined' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    scheduleLiveClass,
    getLiveClasses,
    getLiveClassById,
    startLiveClass,
    joinLiveClass,
    endLiveClass,
    updateLiveClass,
    deleteLiveClass,
    requestJoinClass,
    getJoinStatus,
    getJoinRequests,
    admitStudent,
    admitAllStudents,
    rejectStudent,
    checkScheduleConflictEndpoint,
    resetLiveClassTimer
};
