const multer = require("multer");

// Configure multer to store files in memory (for Supabase upload)
const storage = multer.memoryStorage();

// File filter for LSRW uploads
const fileFilter = (req, file, cb) => {
    // Allow audio files
    if (file.fieldname === 'audio') {
        const allowedAudioTypes = [
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/mpeg3',
            'audio/x-mpeg-3',
            'audio/x-mpeg'
        ];
        
        if (allowedAudioTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid audio file type. Only MP3, WAV files are allowed.'), false);
        }
    }
    // Allow video files
    else if (file.fieldname === 'video') {
        const allowedVideoTypes = [
            'video/mp4',
            'video/mpeg',
            'video/quicktime',
            'video/x-msvideo'
        ];
        
        if (allowedVideoTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid video file type. Only MP4 files are allowed.'), false);
        }
    }
    // Allow document files
    else if (file.fieldname === 'questionDoc') {
        const allowedDocTypes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
            'application/msword' // DOC
        ];
        
        if (allowedDocTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid document file type. Only DOCX or DOC files are allowed.'), false);
        }
    } else {
        cb(new Error('Invalid field name. Use "audio" for audio files, "video" for video files, and "questionDoc" for document files.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit per file
    }
});

// Middleware for LSRW uploads (audio + video + questionDoc)
const lsrwUpload = upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'video', maxCount: 1 },
    { name: 'questionDoc', maxCount: 1 }
]);

module.exports = lsrwUpload;









