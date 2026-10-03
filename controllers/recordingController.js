const supabase = require('../config/supabase');
const { WebhookReceiver } = require('livekit-server-sdk');
const dotenv = require('dotenv');
dotenv.config();

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APIue9mKvNgPwnd';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'ccvA1VrAeyhqmYove8uC1HhWlfcqYkKMys1c9ze9hodC';
const RECORDINGS_BUCKET = process.env.SUPABASE_STORAGE_LIVE_RECORDINGS_BUCKET || 'live-recordings';

let webhookReceiver = null;
if (LIVEKIT_API_KEY && LIVEKIT_API_SECRET) {
    try {
        webhookReceiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    } catch (e) {
        console.error('Failed to init WebhookReceiver:', e.message);
    }
}

/**
 * 1. Get all recordings for a batch (Student / Tutor view)
 */
async function getBatchRecordings(req, res) {
    try {
        const { batch_id } = req.params;

        const { data, error } = await supabase
            .from('live_class_recordings')
            .select(`
                *,
                live_classes:live_class_id(
                    id,
                    title,
                    description,
                    session_number,
                    scheduled_start,
                    scheduled_end,
                    actual_start,
                    actual_end,
                    teacher_id,
                    courses:course_id(id, course_name, language),
                    teachers:teacher_id(id, name, full_name)
                )
            `)
            .eq('batch_id', batch_id)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        // Deduplicate: Each live class session should have exactly 1 canonical card
        const uniqueMap = new Map();
        for (const r of (data || [])) {
            const classKey = r.live_class_id || r.id;
            if (!uniqueMap.has(classKey)) {
                uniqueMap.set(classKey, r);
            } else {
                const existing = uniqueMap.get(classKey);
                if (!existing.storage_object_path && r.storage_object_path) {
                    uniqueMap.set(classKey, r);
                }
            }
        }

        res.json({ recordings: Array.from(uniqueMap.values()) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 2. Get master list of all recordings (Academic Manager / Admin view)
 */
async function getAllRecordings(req, res) {
    try {
        const { batch_id, status, search, page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        let query = supabase
            .from('live_class_recordings')
            .select(`
                *,
                batches:batch_id(batch_id, batch_name),
                live_classes:live_class_id(
                    id,
                    title,
                    description,
                    session_number,
                    scheduled_start,
                    courses:course_id(id, course_name, language),
                    teachers:teacher_id(id, name, full_name)
                )
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(skip, skip + Number(limit) - 1);

        if (batch_id) query = query.eq('batch_id', batch_id);
        if (status) query = query.eq('status', status);

        const { data, count, error } = await query;
        if (error) return res.status(500).json({ error: error.message });

        let resultData = data || [];
        if (req.user?.role === 'teacher' && req.user?.id) {
            resultData = resultData.filter(r => r.live_classes?.teachers?.id === req.user.id || !r.live_classes?.teachers);
        }

        // Deduplicate: Each live class session should have exactly 1 canonical card
        const masterMap = new Map();
        for (const r of resultData) {
            const classKey = r.live_class_id || r.id;
            if (!masterMap.has(classKey)) {
                masterMap.set(classKey, r);
            } else {
                const existing = masterMap.get(classKey);
                if (!existing.storage_object_path && r.storage_object_path) {
                    masterMap.set(classKey, r);
                }
            }
        }
        const deduplicatedList = Array.from(masterMap.values());

        res.json({
            recordings: deduplicatedList,
            total: deduplicatedList.length,
            page: Number(page),
            limit: Number(limit)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

/**
 * 3. Get signed streaming URL for secure video playback (2-hour expiry)
 */
async function getRecordingStreamUrl(req, res) {
    try {
        const { id } = req.params;

        const { data: recording, error } = await supabase
            .from('live_class_recordings')
            .select(`
                *,
                live_classes:live_class_id(title, session_number, description)
            `)
            .eq('id', id)
            .single();

        if (error || !recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const storageClient = supabase.adminSupabase || supabase;
        let playbackUrl = null;
        let objectPath = recording.storage_object_path;

        // If storage_object_path is empty but raw_egress_url contains a Supabase storage path, extract it
        if (!objectPath && recording.raw_egress_url) {
            const match = recording.raw_egress_url.match(/live-recordings\/(?:object\/(?:sign|public)\/live-recordings\/)?([^?]+)/);
            if (match) {
                objectPath = decodeURIComponent(match[1]);
            }
        }

        // 1. Generate a fresh 24-hour signed URL from Supabase Storage
        if (objectPath) {
            try {
                const { data: signedData, error: signErr } = await storageClient
                    .storage
                    .from(RECORDINGS_BUCKET)
                    .createSignedUrl(objectPath, 86400); // 24 hours validity

                if (signedData?.signedUrl) {
                    playbackUrl = signedData.signedUrl;

                    // Asynchronously update raw_egress_url and storage_object_path if needed
                    if (!recording.storage_object_path || recording.raw_egress_url !== signedData.signedUrl) {
                        (supabase.adminSupabase || supabase)
                            .from('live_class_recordings')
                            .update({
                                storage_object_path: objectPath,
                                raw_egress_url: signedData.signedUrl,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', recording.id)
                            .then(() => {})
                            .catch(e => console.warn('Could not update recording signed URL in DB:', e.message));
                    }
                } else if (signErr) {
                    console.warn('Could not generate Supabase signed URL:', signErr.message);
                }
            } catch (err) {
                console.warn('Storage signed URL generation error:', err.message);
            }
        }

        // 2. If signed URL generation didn't work, but raw_egress_url is a non-supabase external URL (e.g. S3 or CDN)
        if (!playbackUrl && recording.raw_egress_url && !recording.raw_egress_url.includes('supabase.co')) {
            playbackUrl = recording.raw_egress_url;
        }

        // 3. If still no playable video URL, return informative 404/422 status - NEVER return mock/sample ocean video
        if (!playbackUrl) {
            return res.status(404).json({
                error: 'Class recording video file is not available in storage yet or is still processing.',
                status: recording.status || 'PROCESSING'
            });
        }

        res.json({
            recordingId: recording.id,
            title: recording.live_classes?.title || 'Class Recording',
            playbackUrl,
            streamUrl: playbackUrl,
            durationSeconds: recording.duration_seconds || 0,
            resolution: recording.resolution || '720p',
            fileSizeBytes: recording.file_size_bytes || 0,
            status: recording.status
        });
    } catch (err) {
        console.error('Error generating stream URL:', err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * 4. LiveKit Webhook Handler (Auto-finalizes MP4 recordings)
 */
async function handleLiveKitWebhook(req, res) {
    try {
        const rawBody = req.body;
        const authHeader = req.headers.authorization;

        if (!webhookReceiver) {
            return res.status(400).send('Webhook receiver not configured');
        }

        let event;
        try {
            event = await webhookReceiver.receive(rawBody, authHeader);
        } catch (err) {
            console.warn('LiveKit webhook validation failed:', err.message);
            return res.status(401).send('Unauthorized webhook signature');
        }

        const eventName = event?.event;
        console.log(`LiveKit Webhook Received: ${eventName}`);

        if (eventName === 'egress_started') {
            const egressInfo = event.egressInfo;
            if (egressInfo?.egressId) {
                await supabase
                    .from('live_class_recordings')
                    .update({ status: 'RECORDING', updated_at: new Date().toISOString() })
                    .eq('egress_id', egressInfo.egressId);
            }
        } else if (eventName === 'egress_ended') {
            const egressInfo = event.egressInfo;
            const fileInfo = egressInfo?.fileResults?.[0];
            const location = fileInfo?.location || '';

            if (egressInfo?.egressId) {
                await supabase
                    .from('live_class_recordings')
                    .update({
                        status: 'READY',
                        duration_seconds: fileInfo?.duration ? Math.round(Number(fileInfo.duration)) : 0,
                        file_size_bytes: fileInfo?.size ? Number(fileInfo.size) : 0,
                        raw_egress_url: location || null,
                        storage_object_path: location ? location.split('/').slice(-2).join('/') : null,
                        resolution: '720p',
                        updated_at: new Date().toISOString()
                    })
                    .eq('egress_id', egressInfo.egressId);
                console.log(`Recording READY for egress: ${egressInfo.egressId}`);
            }
        } else if (eventName === 'egress_failed') {
            const egressInfo = event.egressInfo;
            if (egressInfo?.egressId) {
                await supabase
                    .from('live_class_recordings')
                    .update({ status: 'FAILED', updated_at: new Date().toISOString() })
                    .eq('egress_id', egressInfo.egressId);
                console.warn(`Recording FAILED for egress: ${egressInfo.egressId}`);
            }
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error('Webhook error:', err);
        res.status(500).send('Internal Error');
    }
}

/**
 * 5. Upload Recorded Class Video directly to Supabase Storage Bucket
 * (Handles in-studio live recorded video blobs & manual lecture uploads)
 */
async function uploadClassRecording(req, res) {
    try {
        const { id } = req.params;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: 'No video file provided for upload' });
        }

        // 1. Resolve live_class record
        let { data: liveClass } = await supabase
            .from('live_classes')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        let recordingRow = null;
        if (!liveClass) {
            const { data: rec } = await supabase
                .from('live_class_recordings')
                .select('*, live_classes(*)')
                .eq('id', id)
                .maybeSingle();

            if (rec) {
                recordingRow = rec;
                liveClass = rec.live_classes;
            }
        } else {
            const { data: rec } = await supabase
                .from('live_class_recordings')
                .select('*')
                .eq('live_class_id', liveClass.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            recordingRow = rec;
        }

        if (!liveClass) {
            return res.status(404).json({ error: 'Live class session not found' });
        }

        const isMp4 = file.originalname?.endsWith('.mp4') || file.mimetype === 'video/mp4';
        const ext = isMp4 ? '.mp4' : '.webm';
        const contentType = isMp4 ? 'video/mp4' : 'video/webm';
        const storagePath = `recordings/${liveClass.batch_id}/${liveClass.id}_${Date.now()}${ext}`;

        // 2. Upload to Supabase Storage Bucket using service client
        const storageClient = supabase.adminSupabase || supabase;
        const { data: uploadData, error: uploadErr } = await storageClient.storage
            .from(RECORDINGS_BUCKET)
            .upload(storagePath, file.buffer, {
                contentType,
                upsert: true
            });

        if (uploadErr) {
            console.error('Video upload error:', uploadErr);
            return res.status(500).json({ error: 'Failed to upload video recording: ' + uploadErr.message });
        }

        // 3. Generate signed stream URL (7200 seconds / 2 hours)
        const { data: signedData } = await storageClient.storage
            .from(RECORDINGS_BUCKET)
            .createSignedUrl(storagePath, 7200);

        const playbackUrl = signedData?.signedUrl || storageClient.storage.from(RECORDINGS_BUCKET).getPublicUrl(storagePath)?.data?.publicUrl;

        const durationSeconds = Number(req.body.duration_seconds) || Math.max(30, Math.round(file.size / (1024 * 128)));

        // 4. Update or insert recording row in live_class_recordings
        let savedRecording;
        if (recordingRow) {
            const { data: updated, error: updErr } = await supabase
                .from('live_class_recordings')
                .update({
                    status: 'READY',
                    storage_object_path: storagePath,
                    raw_egress_url: playbackUrl,
                    duration_seconds: durationSeconds,
                    file_size_bytes: file.size,
                    resolution: '720p',
                    updated_at: new Date().toISOString()
                })
                .eq('id', recordingRow.id)
                .select()
                .single();

            savedRecording = updated;
        } else {
            const { data: inserted, error: insErr } = await supabase
                .from('live_class_recordings')
                .insert([{
                    live_class_id: liveClass.id,
                    batch_id: liveClass.batch_id,
                    status: 'READY',
                    storage_object_path: storagePath,
                    raw_egress_url: playbackUrl,
                    duration_seconds: durationSeconds,
                    file_size_bytes: file.size,
                    resolution: '720p'
                }])
                .select()
                .single();

            savedRecording = inserted;
        }

        // 5. Clean up any extra duplicate rows for this live class
        if (savedRecording?.id && liveClass.id) {
            await supabase
                .from('live_class_recordings')
                .delete()
                .eq('live_class_id', liveClass.id)
                .neq('id', savedRecording.id);
        }

        // 6. Ensure class is marked COMPLETED & save topics covered
        const classUpdates = { status: 'COMPLETED', updated_at: new Date().toISOString() };
        const topics = req.body?.topics_covered || req.body?.description;
        if (topics && typeof topics === 'string' && topics.trim()) {
            classUpdates.description = topics.trim();
        }

        await supabase
            .from('live_classes')
            .update(classUpdates)
            .eq('id', liveClass.id);

        res.status(200).json({
            success: true,
            message: 'Video successfully saved',
            recording: savedRecording,
            playbackUrl,
            streamUrl: playbackUrl
        });
    } catch (err) {
        console.error('Error in uploadClassRecording:', err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getBatchRecordings,
    getAllRecordings,
    getRecordingStreamUrl,
    handleLiveKitWebhook,
    uploadClassRecording
};
