const multer = require("multer");

// Configure multer to store files in memory (for Supabase upload)
const storage = multer.memoryStorage();

// File filter for Speaking uploads (text files and audio feedback)
const fileFilter = (req, file, cb) => {
    // Allow text files (PDF, DOCX, DOC, TXT) for material upload
    if (file.fieldname === 'textFile') {
        const allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
            'application/msword', // DOC
            'text/plain'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // Also check by extension
            const validExtensions = ['.pdf', '.docx', '.doc', '.txt'];
            const hasValidExtension = validExtensions.some(ext => 
                file.originalname.toLowerCase().endsWith(ext.toLowerCase())
            );
            
            if (hasValidExtension) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only PDF, DOCX, DOC, or TXT files are allowed.'), false);
            }
        }
    } 
    // Allow audio files for feedback
    else if (file.fieldname === 'audioFeedback') {
        const allowedAudioTypes = [
            'audio/webm',
            'audio/ogg',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/wave'
        ];
        
        if (allowedAudioTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // Also check by extension
            const validAudioExtensions = ['.webm', '.ogg', '.mp3', '.mpeg', '.wav'];
            const hasValidExtension = validAudioExtensions.some(ext => 
                file.originalname.toLowerCase().endsWith(ext.toLowerCase())
            );
            
            if (hasValidExtension) {
                cb(null, true);
            } else {
                cb(new Error('Invalid audio file type. Only WEBM, OGG, MP3, or WAV files are allowed.'), false);
            }
        }
    } else {
        cb(new Error('Invalid field name. Use "textFile" for text files or "audioFeedback" for audio feedback.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit per file (increased for audio)
    }
});

// Middleware for Speaking uploads (optional textFile for materials, optional audioFeedback for feedback)
const speakingUpload = upload.fields([
    { name: 'textFile', maxCount: 1 },
    { name: 'audioFeedback', maxCount: 1 }
]);

module.exports = speakingUpload;

