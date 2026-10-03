const {
    RoomServiceClient,
    AccessToken,
    EgressClient,
    EncodedFileOutput,
    EncodedFileType,
    S3Upload,
    EncodingOptionsPreset
} = require('livekit-server-sdk');
const dotenv = require('dotenv');
dotenv.config();

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://neet-n80sqwyo.livekit.cloud';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APIue9mKvNgPwnd';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'ccvA1VrAeyhqmYove8uC1HhWlfcqYkKMys1c9ze9hodC';
const RECORDINGS_BUCKET = process.env.SUPABASE_STORAGE_LIVE_RECORDINGS_BUCKET || 'live-recordings';
const S3_ENDPOINT = process.env.SUPABASE_S3_ENDPOINT || '';
const S3_ACCESS_KEY = process.env.SUPABASE_S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.SUPABASE_S3_SECRET_KEY || '';
const S3_REGION = process.env.SUPABASE_S3_REGION || 'ap-south-1';

// Convert wss:// to https:// for HTTP REST API
const httpUrl = LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');

let roomService = null;
let egressClient = null;

if (LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL) {
    try {
        roomService = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
        egressClient = new EgressClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    } catch (err) {
        console.error('Failed to initialize LiveKit clients:', err.message);
    }
}

/**
 * Creates or ensures a LiveKit room exists
 */
async function createRoom(roomName) {
    if (!roomService) {
        console.warn('LiveKit roomService not initialized.');
        return null;
    }
    try {
        await roomService.createRoom({
            name: roomName,
            emptyTimeout: 30 * 60, // 30 minutes timeout when empty
            maxParticipants: 500,
        });
        console.log(`LiveKit room created or verified: ${roomName}`);
        return roomName;
    } catch (err) {
        console.warn(`LiveKit room creation note: ${err.message}`);
        return roomName;
    }
}

/**
 * Generates a join JWT token for tutor or student
 */
async function generateToken({ roomName, identity, name, isTeacher = false, metadata = null }) {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        throw new Error('LiveKit API key or secret missing');
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: identity || `user_${Date.now()}`,
        name: name || (isTeacher ? 'Tutor' : 'Student'),
        metadata: metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : undefined,
        ttl: '4h',
    });

    at.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true, // both can talk / share camera
        canSubscribe: true,
        canPublishData: true, // in-class chat & data sync
        roomAdmin: Boolean(isTeacher), // teacher has admin privileges
    });

    return await at.toJwt();
}

/**
 * Starts automatic room recording via LiveKit Egress directly to Supabase S3 bucket
 */
async function startRecording({ roomName, liveClassId, batchId }) {
    if (!egressClient) {
        console.warn('LiveKit Egress client not available. Recording skipped.');
        return { egressId: null };
    }

    // Check if Supabase S3 is configured
    if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
        console.log('Supabase S3 storage keys not configured in .env. Live recording egress will use fallback/direct stream.');
        return { egressId: null };
    }

    try {
        const filepath = `live_recordings/${batchId}/${liveClassId}_${Date.now()}.mp4`;

        const fileOutput = new EncodedFileOutput({
            fileType: EncodedFileType.MP4,
            filepath,
            output: {
                case: 's3',
                value: new S3Upload({
                    accessKey: S3_ACCESS_KEY,
                    secret: S3_SECRET_KEY,
                    region: S3_REGION,
                    endpoint: S3_ENDPOINT,
                    bucket: RECORDINGS_BUCKET,
                    forcePathStyle: true,
                }),
            },
        });

        const egressInfo = await egressClient.startRoomCompositeEgress(
            roomName,
            { file: fileOutput },
            {
                layout: 'speaker',
                encodingOptions: EncodingOptionsPreset.H264_720P_30,
            }
        );

        console.log(`LiveKit egress started: ${egressInfo.egressId} -> ${filepath}`);
        return { egressId: egressInfo.egressId, filepath };
    } catch (err) {
        console.error('Failed to start LiveKit egress recording:', err.message);
        return { egressId: null, error: err.message };
    }
}

/**
 * Stops an active LiveKit egress recording
 */
async function stopRecording(egressId) {
    if (!egressClient || !egressId) return;
    try {
        await egressClient.stopEgress(egressId);
        console.log(`LiveKit egress stopped: ${egressId}`);
    } catch (err) {
        console.warn(`Failed to stop egress ${egressId}: ${err.message}`);
    }
}

/**
 * Deletes/closes a LiveKit room
 */
async function deleteRoom(roomName) {
    if (!roomService) return;
    try {
        await roomService.deleteRoom(roomName);
        console.log(`LiveKit room closed: ${roomName}`);
    } catch (err) {
        console.warn(`Failed to delete room ${roomName}: ${err.message}`);
    }
}

module.exports = {
    createRoom,
    generateToken,
    startRecording,
    stopRecording,
    deleteRoom,
    LIVEKIT_URL,
};
