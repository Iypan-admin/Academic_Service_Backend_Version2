const multer = require("multer");

// Configure multer to store files in memory (for Supabase upload)
const storage = multer.memoryStorage();

// File filter for Writing uploads
// - Admin can upload: images (JPEG, PNG), documents (PDF, DOCX), or text
// - Students can upload: images only (JPEG, PNG) for submissions
const fileFilter = (req, file, cb) => {
    // For admin writing task uploads (image or document)
    if (file.fieldname === 'writingImage' || file.fieldname === 'writingDocument') {
        if (file.fieldname === 'writingImage') {
            // Allow image files (JPEG, PNG)
            const allowedTypes = [
                'image/jpeg',
                'image/jpg',
                'image/png'
            ];
            
            if (allowedTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                const validExtensions = ['.jpg', '.jpeg', '.png'];
                const hasValidExtension = validExtensions.some(ext => 
                    file.originalname.toLowerCase().endsWith(ext.toLowerCase())
                );
                
                if (hasValidExtension) {
                    cb(null, true);
                } else {
                    cb(new Error('Invalid image file type. Only JPEG or PNG files are allowed.'), false);
                }
            }
        } else if (file.fieldname === 'writingDocument') {
            // Allow document files (PDF, DOCX)
            const allowedTypes = [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // DOCX
            ];
            
            if (allowedTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                const validExtensions = ['.pdf', '.docx'];
                const hasValidExtension = validExtensions.some(ext => 
                    file.originalname.toLowerCase().endsWith(ext.toLowerCase())
                );
                
                if (hasValidExtension) {
                    cb(null, true);
                } else {
                    cb(new Error('Invalid document file type. Only PDF or DOCX files are allowed.'), false);
                }
            }
        }
    }
    // For student submission uploads (image only)
    else if (file.fieldname === 'submissionImage') {
        const allowedTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            const validExtensions = ['.jpg', '.jpeg', '.png'];
            const hasValidExtension = validExtensions.some(ext => 
                file.originalname.toLowerCase().endsWith(ext.toLowerCase())
            );
            
            if (hasValidExtension) {
                cb(null, true);
            } else {
                cb(new Error('Invalid image file type. Only JPEG or PNG files are allowed for submissions.'), false);
            }
        }
    } else {
        cb(new Error('Invalid field name. Use "writingImage", "writingDocument", or "submissionImage".'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit per file (for images and documents)
    }
});

// Middleware for Writing task uploads (admin) - optional image or document
const writingUpload = upload.fields([
    { name: 'writingImage', maxCount: 1 },
    { name: 'writingDocument', maxCount: 1 }
]);

// Middleware for student submission uploads - image only
const writingSubmissionUpload = upload.single('submissionImage');

module.exports = writingUpload;
module.exports.writingSubmissionUpload = writingSubmissionUpload;










