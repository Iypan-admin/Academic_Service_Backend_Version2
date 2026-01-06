const multer = require("multer");

// Configure multer to store files in memory (for Supabase upload)
const storage = multer.memoryStorage();

// File filter for Writing feedback uploads (audio feedback only)
const fileFilter = (req, file, cb) => {
    // Allow audio files for feedback
    if (file.fieldname === 'audioFeedback') {
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
        cb(new Error('Invalid field name. Use "audioFeedback" for audio feedback.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit per file (for audio)
    }
});

// Middleware that only applies multer for multipart/form-data requests
const optionalWritingUpload = (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    
    // Only use multer for multipart/form-data requests
    if (contentType.includes('multipart/form-data')) {
        // Use .fields() but make it optional - it will work even if fields are missing
        const multerMiddleware = upload.fields([
            { name: 'audioFeedback', maxCount: 1 }
        ]);
        
        return multerMiddleware(req, res, (err) => {
            if (err) {
                console.error('Multer error in optionalWritingUpload:', err);
                // If error is about missing fields, treat as no files (not an error)
                if (err.message && err.message.includes('Unexpected field')) {
                    console.log('⚠️ No expected fields found, treating as no files');
                    req.files = {};
                    return next();
                }
                return res.status(400).json({ error: err.message });
            }
            
            // Ensure req.files is an object (multer.fields() returns object with field names as keys)
            if (!req.files) {
                req.files = {};
            }
            
            console.log('✅ Multer processed - files:', Object.keys(req.files || {}));
            console.log('📦 Request body after multer:', JSON.stringify(req.body));
            console.log('➡️ Calling next() to proceed to controller');
            next();
        });
    } else {
        // For JSON requests, ensure req.files exists and continue
        req.files = {};
        return next();
    }
};

module.exports = optionalWritingUpload;

