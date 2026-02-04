const express = require('express');
const multer = require('multer');
const authenticate = require('../config/authMiddleware');
const {
    uploadCertificate,
    getAllCertificates,
    deleteCertificate,
    reuploadCertificate,
    generateCertificate,
    getCertificateStatus,
    updateCertificateAlignment,
    approveGeneratedCertificate,
    deleteGeneratedCertificate,
    upload,
    handleMulterError
} = require('../controllers/certificateController');

const router = express.Router();

// Routes - Upload only for Academic Coordinator
router.post('/upload', 
    authenticate(['academic_coordinator', 'academic']), 
    upload.fields([
        { name: 'page1', maxCount: 1 },
        { name: 'page2', maxCount: 1 }
    ]),
    handleMulterError,
    uploadCertificate
);

// Routes - View for Admin, Manager, Academic Coordinator
router.get('/',
    authenticate(['admin', 'manager', 'academic_coordinator', 'academic']),
    getAllCertificates
);

// Routes - Delete only for Academic Coordinator
router.delete('/:uploadId',
    authenticate(['academic_coordinator', 'academic']),
    deleteCertificate
);

// Routes - Re-upload only for Academic Coordinator
router.post('/reupload',
    authenticate(['academic_coordinator', 'academic']),
    upload.fields([
        { name: 'page1', maxCount: 1 },
        { name: 'page2', maxCount: 1 }
    ]),
    handleMulterError,
    reuploadCertificate
);

// Routes - Generate certificate for student
router.post('/generate',
    authenticate(['admin', 'manager', 'academic_coordinator', 'academic']),
    generateCertificate
);

// Routes - Get certificate status
router.get('/status',
    authenticate(['admin', 'manager', 'academic_coordinator', 'academic']),
    getCertificateStatus
);

// Routes - Update alignment config
router.put('/alignment/:uploadId',
    authenticate(['admin', 'academic_coordinator', 'academic']),
    updateCertificateAlignment
);
 
// Routes - Approve generated certificate
router.post('/approve',
    authenticate(['admin', 'manager', 'academic_coordinator', 'academic']),
    approveGeneratedCertificate
);
 
// Routes - Delete generated certificate
router.delete('/generated/:certificateId',
    authenticate(['admin', 'manager', 'academic_coordinator', 'academic']),
    deleteGeneratedCertificate
);

module.exports = router;
