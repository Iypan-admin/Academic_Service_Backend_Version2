const multer = require("multer");

// Configure multer to store files in memory (for Supabase upload)
const storage = multer.memoryStorage();

// File filter for Reading uploads (text files: DOCX, DOC, TXT)
const fileFilter = (req, file, cb) => {
    // Allow text files (DOCX, DOC, TXT) for reading material upload
    if (file.fieldname === 'readingFile') {
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
            'application/msword', // DOC
            'text/plain'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // Also check by extension
            const validExtensions = ['.docx', '.doc', '.txt'];
            const hasValidExtension = validExtensions.some(ext => 
                file.originalname.toLowerCase().endsWith(ext.toLowerCase())
            );
            
            if (hasValidExtension) {
                cb(null, true);
            } else {
                cb(new Error('Invalid file type. Only DOCX, DOC, or TXT files are allowed (PDF is not supported).'), false);
            }
        }
    } else {
        cb(new Error('Invalid field name. Use "readingFile" for reading material file uploads.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit per file
    }
});

// Middleware for Reading uploads (optional readingFile)
const readingUpload = upload.fields([
    { name: 'readingFile', maxCount: 1 }
]);

module.exports = readingUpload;

















