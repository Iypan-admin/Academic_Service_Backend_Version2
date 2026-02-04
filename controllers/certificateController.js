const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { PDFDocument: PDFLib, rgb } = require('pdf-lib');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 50MB' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files uploaded' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ error: 'Unexpected file field' });
        }
        return res.status(400).json({ error: err.message });
    }
    
    if (err) {
        return res.status(400).json({ error: err.message });
    }
    
    next();
};

// Upload Certificate Template Images
const uploadCertificate = async (req, res) => {
    try {
        const { language } = req.body;
        const page1 = req.files?.page1?.[0];
        const page2 = req.files?.page2?.[0];
        const userId = req.user.id;

        if (!page1 || !page2) {
            return res.status(400).json({ error: 'Both Page 1 and Page 2 images are required' });
        }

        if (!language) {
            return res.status(400).json({ error: 'Language is required' });
        }

        const validLanguages = ['french', 'german', 'japanese'];
        const langLower = language.toLowerCase();
        if (!validLanguages.includes(langLower)) {
            return res.status(400).json({ error: 'Invalid language. Must be french, german, or japanese' });
        }

        if (!page1.mimetype.startsWith('image/') || !page2.mimetype.startsWith('image/')) {
            return res.status(400).json({ error: 'Only image files (PNG/JPG) are allowed' });
        }

        await supabase
            .from('certificate_uploads')
            .update({ is_active: false })
            .eq('language', langLower);

        const uploadImage = async (file, suffix) => {
            const fileName = `${langLower}_${suffix}_${Date.now()}${path.extname(file.originalname)}`;
            const filePath = `certificates/${langLower}/${fileName}`;
            
            const { error: uploadError } = await supabaseAdmin.storage
                .from('certificates')
                .upload(filePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: true
                });

            if (uploadError) throw uploadError;

            const { data: urlData } = supabaseAdmin.storage
                .from('certificates')
                .getPublicUrl(filePath);

            return urlData.publicUrl;
        };

        const page1Url = await uploadImage(page1, 'page1');
        const page2Url = await uploadImage(page2, 'page2');

        const { data: certificateData, error: insertError } = await supabase
            .from('certificate_uploads')
            .insert({
                language: langLower,
                certificate_file_path: page1Url, 
                page1_url: page1Url,
                page2_url: page2Url,
                file_name: `${langLower}_certificate.pdf`,
                file_size: page1.size + page2.size,
                uploaded_by: userId,
                is_active: true,
                alignment_config: {
                    studentName: { x: 297, y: 1291, size: 26 }, // Center aligned (595/2 = 297.5)
                    courseLevel: { x: 383, y: 1258, size: 18 },
                    startDate: { x: 261, y: 1254, size: 14 },
                    endDate: { x: 400, y: 1254, size: 14 },
                    adminName: { x: 179, y: 1122, size: 12 },
                    adminSignature: { x: 179, y: 1152, size: 12, width: 120, height: 40 },
                    tutorName: { x: 421, y: 1122, size: 12 },
                    tutorSignature: { x: 421, y: 1152, size: 12, width: 120, height: 40 },
                    studentNamePage2: { x: 218, y: 714, size: 22 },
                    regNo: { x: 272, y: 693, size: 14 },
                    dob: { x: 257, y: 666, size: 14 },
                    assessmentDate: { x: 258, y: 644, size: 14 },
                    section1Mark: { x: 137, y: 547, size: 14 },
                    section2Mark: { x: 217, y: 547, size: 14 },
                    section3Mark: { x: 297, y: 547, size: 14 },
                    section4Mark: { x: 377, y: 547, size: 14 },
                    totalMarks: { x: 380, y: 495, size: 18 },
                    adminNamePage2: { x: 161, y: 352, size: 12 },
                    adminSignaturePage2: { x: 161, y: 392, size: 12, width: 120, height: 40 },
                    tutorNamePage2: { x: 423, y: 352, size: 12 },
                    tutorSignaturePage2: { x: 423, y: 392, size: 12, width: 120, height: 40 }
                }
            })
            .select()
            .single();

        if (insertError) {
            console.error('Certificate insert error:', insertError);
            return res.status(500).json({ error: 'Failed to save certificate record.' });
        }

        res.status(201).json({ success: true, message: 'Template images uploaded successfully', data: certificateData });
    } catch (error) {
        console.error('Upload certificate error:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
};

// Re-upload Template Images
const reuploadCertificate = async (req, res) => {
    try {
        const { language } = req.body;
        const page1 = req.files?.page1?.[0];
        const page2 = req.files?.page2?.[0];
        const userId = req.user.id;

        if (!page1 || !page2) {
            return res.status(400).json({ error: 'Both Page 1 and Page 2 images are required' });
        }

        const langLower = language.toLowerCase();
        await supabase.from('certificate_uploads').update({ is_active: false }).eq('language', langLower);

        const uploadImage = async (file, suffix) => {
            const fileName = `${langLower}_${suffix}_${Date.now()}${path.extname(file.originalname)}`;
            const filePath = `certificates/${langLower}/${fileName}`;
            await supabaseAdmin.storage.from('certificates').upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });
            const { data: urlData } = supabaseAdmin.storage.from('certificates').getPublicUrl(filePath);
            return urlData.publicUrl;
        };

        const page1Url = await uploadImage(page1, 'page1');
        const page2Url = await uploadImage(page2, 'page2');

        const { data: certificateData, error: insertError } = await supabase
            .from('certificate_uploads')
            .insert({
                language: langLower,
                certificate_file_path: page1Url,
                page1_url: page1Url,
                page2_url: page2Url,
                file_name: `${langLower}_certificate.pdf`,
                file_size: page1.size + page2.size,
                uploaded_by: userId,
                is_active: true,
                alignment_config: {
                    studentName: { x: 297, y: 1291, size: 26 }, // Center aligned (595/2 = 297.5)
                    courseLevel: { x: 383, y: 1258, size: 18 },
                    startDate: { x: 261, y: 1254, size: 14 },
                    endDate: { x: 400, y: 1254, size: 14 },
                    adminName: { x: 179, y: 1122, size: 12 },
                    adminSignature: { x: 179, y: 1152, size: 12, width: 120, height: 40 },
                    tutorName: { x: 421, y: 1122, size: 12 },
                    tutorSignature: { x: 421, y: 1152, size: 12, width: 120, height: 40 },
                    studentNamePage2: { x: 218, y: 714, size: 22 },
                    regNo: { x: 272, y: 693, size: 14 },
                    dob: { x: 257, y: 666, size: 14 },
                    assessmentDate: { x: 258, y: 644, size: 14 },
                    section1Mark: { x: 137, y: 547, size: 14 },
                    section2Mark: { x: 217, y: 547, size: 14 },
                    section3Mark: { x: 297, y: 547, size: 14 },
                    section4Mark: { x: 377, y: 547, size: 14 },
                    totalMarks: { x: 380, y: 495, size: 18 },
                    adminNamePage2: { x: 161, y: 352, size: 12 },
                    adminSignaturePage2: { x: 161, y: 392, size: 12, width: 120, height: 40 },
                    tutorNamePage2: { x: 423, y: 352, size: 12 },
                    tutorSignaturePage2: { x: 423, y: 392, size: 12, width: 120, height: 40 }
                }
            })
            .select()
            .single();

        if (insertError) throw insertError;
        res.status(201).json({ success: true, message: 'Certificate templates re-uploaded successfully', data: certificateData });
    } catch (error) {
        console.error('Re-upload error:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
};

// Generate Certificate using Image-based System
async function generateCertificateFromTemplate(data) {
    console.log('Using Advanced Page Generation (PDFKit) for Certificate');
    
    const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        bufferPages: true
    });

    const isJapanese = data.course.language?.toLowerCase().trim() === 'japanese';
    const isFrench = data.course.language?.toLowerCase().trim() === 'french';
    const isGerman = data.course.language?.toLowerCase().trim() === 'german';
    const usePremiumStyle = isJapanese || isFrench || isGerman;

    // Helper to fetch buffer from URL (handles redirects)
    const fetchBuffer = async (url) => {
        return new Promise((resolve, reject) => {
            const fetch = (targetUrl) => {
                const protocol = targetUrl.startsWith('https') ? https : http;
                protocol.get(targetUrl, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        return fetch(new URL(res.headers.location, targetUrl).href);
                    }
                    if (res.statusCode !== 200) {
                        return reject(new Error(`Failed to fetch ${targetUrl}: ${res.statusCode}`));
                    }
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                    res.on('error', reject);
                }).on('error', reject);
            };
            fetch(url);
        });
    };

    // Load Lora Fonts locally
    let loraRegular = 'Helvetica'; // Fallback
    let loraBold = 'Helvetica-Bold'; // Fallback
    try {
        const fontsDir = path.join(__dirname, '..', 'fonts');
        const regularPath = path.join(fontsDir, 'Lora-Regular.ttf');
        const boldPath = path.join(fontsDir, 'Lora-Bold.ttf');

        if (fs.existsSync(regularPath) && fs.existsSync(boldPath)) {
            loraRegular = fs.readFileSync(regularPath);
            loraBold = fs.readFileSync(boldPath);
            console.log('Lora fonts loaded successfully from local fonts folder');
        } else {
            console.warn('Local Lora fonts not found in /fonts folder, using fallback Helvetica.');
        }
    } catch (fontError) {
        console.warn('Error reading local Lora fonts, using fallback Helvetica.', fontError.message);
    }

    const A4_WIDTH = 595.28;
    const A4_HEIGHT = 841.89;
    
    // Gradient definitions
    const setGradient = (x, y, text, size, font, align) => {
        const textWidth = font ? doc.widthOfString(text, { size }) : (text.length * size * 0.6);
        let startX = x;
        if (align === 'center') {
            startX = (A4_WIDTH / 2) - (textWidth / 2);
        }
        const gradient = doc.linearGradient(startX, y, startX + textWidth, y);
        gradient.stop(0, '#9d1c1c').stop(1, '#863617');
        return gradient;
    };

    // Helper to draw on correct page
    const drawOnCorrectPage = async (globalY, globalX, content, options = {}) => {
        const BROWSER_WIDTH = 595;
        const BROWSER_HEIGHT = 842;
        
        let pageIdx = 0;
        let localY = globalY;

        if (globalY > BROWSER_HEIGHT) {
            pageIdx = 0;
            localY = globalY - BROWSER_HEIGHT;
        } else {
            pageIdx = 1;
            localY = globalY;
        }

        doc.switchToPage(pageIdx);
        
        const finalX = (globalX / BROWSER_WIDTH) * A4_WIDTH;
        const finalY = A4_HEIGHT - ((localY / BROWSER_HEIGHT) * A4_HEIGHT);

        if (options.isImage) {
            const imgBytes = typeof content === 'string' ? await fetchBuffer(content) : content;
            if (imgBytes) {
                doc.image(imgBytes, finalX, finalY - (options.height / 2), { width: options.width || 120, height: options.height || 40 });
            }
        } else {
            const fontSize = options.size || 14;
            const isBold = options.fontType === 'bold';
            const font = usePremiumStyle ? (isBold ? loraBold : loraRegular) : (isBold ? 'Helvetica-Bold' : 'Helvetica');
            
            if (font) doc.font(font);
            doc.fontSize(fontSize);

            if (options.align === 'center') {
                if (isJapanese && options.useGradient) {
                    doc.fill(setGradient(0, finalY, content.toString(), fontSize, font, 'center'));
                } else {
                    doc.fillColor(options.color || 'black');
                }
                doc.text(content.toString(), 0, finalY - (fontSize / 2), { width: A4_WIDTH, align: 'center' });
            } else {
                if (isJapanese && options.useGradient) {
                    doc.fill(setGradient(finalX, finalY, content.toString(), fontSize, font));
                } else {
                    doc.fillColor(options.color || 'black');
                }
                doc.text(content.toString(), finalX, finalY - (fontSize / 2));
            }
        }
    };

    // 1. Add Background Images
    const page1Bytes = await fetchBuffer(data.template.page1_url);
    const page2Bytes = await fetchBuffer(data.template.page2_url);

    doc.image(page1Bytes, 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });
    if (page2Bytes) {
        doc.addPage();
        doc.image(page2Bytes, 0, 0, { width: A4_WIDTH, height: A4_HEIGHT });
    }

    let cfg = data.template.alignment_config;
    if (typeof cfg === 'string') cfg = JSON.parse(cfg);

    // 2. Draw Content
    const TEXT_COLOR = isJapanese ? '#232424' : 'black';

    if (cfg.studentName) {
        await drawOnCorrectPage(cfg.studentName.y, cfg.studentName.x, data.student.name, { 
            size: usePremiumStyle ? 30 : cfg.studentName.size, 
            fontType: 'bold',
            align: usePremiumStyle ? 'center' : null,
            useGradient: isJapanese 
        });
    }

    await drawOnCorrectPage(cfg.courseLevel?.y || 0, cfg.courseLevel?.x || 0, data.course.level || '', { size: usePremiumStyle ? 15.5 : cfg.courseLevel?.size, color: TEXT_COLOR });

    if (usePremiumStyle) {
        const dateStr = `${formatDate(data.batch.start_date)}     ${formatDate(data.batch.end_date)}`;
        await drawOnCorrectPage(cfg.startDate?.y || 0, cfg.startDate?.x || 0, dateStr, { size: 15.5, color: TEXT_COLOR });
    } else {
        await drawOnCorrectPage(cfg.startDate?.y || 0, cfg.startDate?.x || 0, formatDate(data.batch.start_date), { size: cfg.startDate?.size });
        await drawOnCorrectPage(cfg.endDate?.y || 0, cfg.endDate?.x || 0, formatDate(data.batch.end_date), { size: cfg.endDate?.size });
    }

    if (data.admin?.full_name) await drawOnCorrectPage(cfg.adminName?.y || 0, cfg.adminName?.x || 0, data.admin.full_name, { size: usePremiumStyle ? 15.5 : cfg.adminName?.size, useGradient: isJapanese });
    if (data.admin?.signature) await drawOnCorrectPage(cfg.adminSignature?.y || 0, cfg.adminSignature?.x || 0, data.admin.signature, { isImage: true, ...cfg.adminSignature });
    
    if (data.tutor?.full_name) await drawOnCorrectPage(cfg.tutorName?.y || 0, cfg.tutorName?.x || 0, data.tutor.full_name, { size: usePremiumStyle ? 15.5 : cfg.tutorName?.size, useGradient: isJapanese });
    if (data.tutorSignature) await drawOnCorrectPage(cfg.tutorSignature?.y || 0, cfg.tutorSignature?.x || 0, data.tutorSignature, { isImage: true, ...cfg.tutorSignature });

    // Page 2
    if (cfg.studentNamePage2) await drawOnCorrectPage(cfg.studentNamePage2.y, cfg.studentNamePage2.x, data.student.name, { size: usePremiumStyle ? 15.5 : cfg.studentNamePage2.size, color: TEXT_COLOR });
    if (cfg.regNo) await drawOnCorrectPage(cfg.regNo.y, cfg.regNo.x, data.student.registration_number || 'N/A', { size: usePremiumStyle ? 15.5 : cfg.regNo.size, color: TEXT_COLOR });
    if (cfg.dob) await drawOnCorrectPage(cfg.dob.y, cfg.dob.x, formatDate(data.student.date_of_birth), { size: usePremiumStyle ? 15.5 : cfg.dob.size, color: TEXT_COLOR });
    if (cfg.assessmentDate) await drawOnCorrectPage(cfg.assessmentDate.y, cfg.assessmentDate.x, formatDate(data.marks.assessment_date), { size: usePremiumStyle ? 15.5 : cfg.assessmentDate.size, color: TEXT_COLOR });

    const marks = getLanguageSpecificMarks(data.marks, data.course.language);
    const sectionKeys = ['section1Mark', 'section2Mark', 'section3Mark', 'section4Mark'];
    for (let i = 0; i < marks.length; i++) {
        if (cfg[sectionKeys[i]]) await drawOnCorrectPage(cfg[sectionKeys[i]].y, cfg[sectionKeys[i]].x, marks[i].marks.toString(), { size: usePremiumStyle ? 15.5 : cfg[sectionKeys[i]].size, color: TEXT_COLOR });
    }
    if (cfg.totalMarks) {
        const totalMarksStr = (isFrench || isGerman) ? getTotalMarks(data.marks).toString() : `${getTotalMarks(data.marks)}/${getMaxTotalMarks(data.course.language)}`;
        await drawOnCorrectPage(cfg.totalMarks.y, cfg.totalMarks.x, totalMarksStr, { size: usePremiumStyle ? 12 : cfg.totalMarks.size, color: TEXT_COLOR });
    }

    if (data.admin?.full_name) await drawOnCorrectPage(cfg.adminNamePage2?.y || 0, cfg.adminNamePage2?.x || 0, data.admin.full_name, { size: usePremiumStyle ? 15.5 : cfg.adminNamePage2?.size, useGradient: isJapanese });
    if (data.admin?.signature) await drawOnCorrectPage(cfg.adminSignaturePage2?.y || 0, cfg.adminSignaturePage2?.x || 0, data.admin.signature, { isImage: true, ...cfg.adminSignaturePage2 });
    
    if (data.tutor?.full_name) await drawOnCorrectPage(cfg.tutorNamePage2?.y || 0, cfg.tutorNamePage2?.x || 0, data.tutor.full_name, { size: usePremiumStyle ? 15.5 : cfg.tutorNamePage2?.size, useGradient: isJapanese });
    if (data.tutorSignature) await drawOnCorrectPage(cfg.tutorSignaturePage2?.y || 0, cfg.tutorSignaturePage2?.x || 0, data.tutorSignature, { isImage: true, ...cfg.tutorSignaturePage2 });

    // Finalize PDF
    return new Promise((resolve) => {
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.end();
    });
}
// Controller functions
const getAllCertificates = async (req, res) => {
    try {
        const { data: certificates, error } = await supabase.from('certificate_uploads').select('*, uploader:users(name)').eq('is_active', true).order('language', { ascending: true });
        if (error) throw error;
        res.json({ success: true, data: certificates });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const deleteCertificate = async (req, res) => {
    try {
        const { uploadId } = req.params;
        const { data: cert } = await supabase.from('certificate_uploads').select('certificate_file_path').eq('upload_id', uploadId).single();
        if (cert) await supabaseAdmin.storage.from('certificates').remove([cert.certificate_file_path.split('/').pop()]);
        await supabase.from('certificate_uploads').delete().eq('upload_id', uploadId);
        res.json({ success: true, message: 'Deleted' });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const generateCertificate = async (req, res) => {
    try {
        const { studentId, batchId } = req.body;
        console.log(`Generating certificate for Student: ${studentId}, Batch: ${batchId}`);
        
        // 1. Check if a record already exists
        let { data: certificateRecord, error: fetchError } = await supabase
            .from('generated_certificates')
            .select('*')
            .eq('student_id', studentId)
            .eq('batch_id', batchId)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error('Error fetching existing record:', fetchError);
        }

        if (!certificateRecord) {
            // 2. Insert new record if not exists
            const { data: newRecord, error: insertError } = await supabase
                .from('generated_certificates')
                .insert({ 
                    student_id: studentId, 
                    batch_id: batchId, 
                    status: 'generating',
                    certificate_url: 'Pending...', // Placeholder for NOT NULL constraint
                    generated_by: req.user?.id
                })
                .select()
                .single();
            
            if (insertError) {
                console.error('Error inserting certificate record:', insertError);
                // If it failed due to unique constraint, try fetching again
                if (insertError.code === '23505') {
                    const { data: retryRecord } = await supabase
                        .from('generated_certificates')
                        .select('*')
                        .eq('student_id', studentId)
                        .eq('batch_id', batchId)
                        .single();
                    certificateRecord = retryRecord;
                } else {
                    return res.status(500).json({ success: false, error: 'Failed to create certificate record: ' + insertError.message });
                }
            } else {
                certificateRecord = newRecord;
            }
        }

        if (!certificateRecord) {
            return res.status(500).json({ success: false, error: 'Could not create or find certificate record' });
        }

        // Update status to generating if it was already there (optional)
        await supabase.from('generated_certificates').update({ status: 'generating' }).eq('certificate_id', certificateRecord.certificate_id);
        
        const { data: student } = await supabase.from('students').select('*').eq('student_id', studentId).single();
        const { data: batch } = await supabase.from('batches').select('*').eq('batch_id', batchId).single();
        
        if (!batch) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }
        
        const { data: course } = await supabase.from('courses').select('*').eq('id', batch.course_id).single();
        if (!course) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }

        const { data: marks } = await supabase.from('assessment_marks').select('*').eq('student_id', studentId).eq('batch_id', batchId).single();
        const { data: admin } = await supabase.from('users').select('full_name, signature').eq('role', 'admin').limit(1).single();
        
        let tutorSignature = null;
        let tutor = { full_name: 'Tutor' };
        const { data: teacherRecord } = await supabase.from('teachers').select('teacher').eq('teacher_id', batch.teacher).single();
        if (teacherRecord) {
            const { data: tutorUser } = await supabase.from('users').select('full_name, signature').eq('id', teacherRecord.teacher).single();
            if (tutorUser) {
                tutor = { full_name: tutorUser.full_name };
                tutorSignature = tutorUser.signature;
            }
        }

        const { data: template } = await supabase.from('certificate_uploads').select('*').eq('language', course.language.toLowerCase()).eq('is_active', true).single();
        
        if (!template) {
            return res.status(404).json({ success: false, error: `No active template found for language: ${course.language}` });
        }

        const certificateUrl = await generateAndUploadCertificate({ student, batch, course, marks: marks || {}, admin: admin || {}, tutor, tutorSignature, template });
        
        await supabase.from('generated_certificates').update({ 
            certificate_url: certificateUrl, 
            status: 'pending',
            generated_by: req.user?.id 
        }).eq('certificate_id', certificateRecord.certificate_id);
        res.json({ success: true, data: { certificateUrl, status: 'pending', certificateId: certificateRecord.certificate_id } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
};

async function uploadWithRetry(bucket, filePath, data, options, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { data: uploadData, error } = await supabaseAdmin.storage.from(bucket).upload(filePath, data, options);
            if (error) throw error;
            return uploadData;
        } catch (error) {
            if (attempt === maxRetries) throw error;
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
    }
}

async function generateAndUploadCertificate(data) {
    let pdfBuffer;
    if (data.template && data.template.page1_url) {
        const bytes = await generateCertificateFromTemplate(data);
        pdfBuffer = Buffer.from(bytes);
    } else {
        throw new Error('No image template found');
    }
    
    const fileName = `${data.student.name.replace(/\s+/g, '-')}-${Date.now()}.pdf`;
    const filePath = `completed/${data.batch.batch_name.replace(/\s+/g, '-')}/${fileName}`;
    
    await uploadWithRetry('completion-certificates', filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    const { data: urlData } = supabaseAdmin.storage.from('completion-certificates').getPublicUrl(filePath);
    return urlData.publicUrl;
}

// Helpers
function getLanguageSpecificMarks(marks, language) {
    const lang = language.toUpperCase();
    if (lang === 'GERMAN') return [
        { category: 'Lesen', marks: marks.german_lesen_marks || 0, maxMarks: 25 },
        { category: 'Schreiben', marks: marks.german_schreiben_marks || 0, maxMarks: 25 },
        { category: 'Hören', marks: marks.german_horen_marks || 0, maxMarks: 25 },
        { category: 'Sprechen', marks: marks.german_sprechen_marks || 0, maxMarks: 25 }
    ];
    if (lang === 'FRENCH') return [
        { category: 'Compréhension Orale', marks: marks.french_comprehension_orale_marks || 0, maxMarks: 25 },
        { category: 'Compréhension Écrite', marks: marks.french_comprehension_ecrite_marks || 0, maxMarks: 25 },
        { category: 'Production Orale', marks: marks.french_production_orale_marks || 0, maxMarks: 25 },
        { category: 'Production Écrite', marks: marks.french_production_ecrite_marks || 0, maxMarks: 25 }
    ];
    if (lang === 'JAPANESE') return [
        { category: 'Vocab & Grammar', marks: marks.japanese_vocabulary_grammar_marks || 0, maxMarks: 60 },
        { category: 'Reading', marks: marks.japanese_reading_marks || 0, maxMarks: 60 },
        { category: 'Listening', marks: marks.japanese_listening_marks || 0, maxMarks: 60 }
    ];
    return [];
}

function getTotalMarks(marks) {
    return (marks.french_comprehension_orale_marks || 0) + (marks.french_comprehension_ecrite_marks || 0) + (marks.french_production_orale_marks || 0) + (marks.french_production_ecrite_marks || 0) +
           (marks.german_lesen_marks || 0) + (marks.german_schreiben_marks || 0) + (marks.german_horen_marks || 0) + (marks.german_sprechen_marks || 0) +
           (marks.japanese_vocabulary_grammar_marks || 0) + (marks.japanese_reading_marks || 0) + (marks.japanese_listening_marks || 0);
}

function getMaxTotalMarks(language) {
    const lang = language.toUpperCase();
    if (lang === 'JAPANESE') return 180;
    return 100;
}

function formatDate(d) {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

const updateCertificateAlignment = async (req, res) => {
    try {
        const { uploadId } = req.params;
        const { alignmentConfig } = req.body;
        const { data } = await supabase.from('certificate_uploads').update({ alignment_config: alignmentConfig }).eq('upload_id', uploadId).select().single();
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const getCertificateStatus = async (req, res) => {
    try {
        const { studentId, batchId } = req.query;
        const { data } = await supabase.from('generated_certificates').select('*').eq('student_id', studentId).eq('batch_id', batchId).single();
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

const approveGeneratedCertificate = async (req, res) => {
    try {
        const { certificateId } = req.body;
        
        // 1. Fetch certificate details to get student_id and batch_id
        const { data: cert, error: certFetchError } = await supabase
            .from('generated_certificates')
            .select('student_id, batch_id')
            .eq('certificate_id', certificateId)
            .single();

        if (certFetchError) throw certFetchError;

        // 2. Fetch course name for the notification
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select(`
                course:courses(course_name)
            `)
            .eq('batch_id', cert.batch_id)
            .single();

        const courseName = batch?.course?.course_name || 'your course';

        // 3. Update certificate status to completed
        const { error } = await supabase
            .from('generated_certificates')
            .update({ status: 'completed' })
            .eq('certificate_id', certificateId);

        if (error) throw error;

        // 4. Send notification to student
        const notificationMessage = `Congratulations! 🎓\nYour certificate for the course "${courseName}" has been issued. Well done on your achievement and keep up the great work! ✨`;

        await supabase
            .from('notifications')
            .insert({
                student: cert.student_id,
                message: notificationMessage,
                is_read: false
            });

        res.json({ success: true, message: 'Certificate approved and student notified' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const deleteGeneratedCertificate = async (req, res) => {
    try {
        const { certificateId } = req.params;
        
        // Fetch the certificate record to get the URL
        const { data: cert, error: fetchError } = await supabase
            .from('generated_certificates')
            .select('certificate_url')
            .eq('certificate_id', certificateId)
            .single();

        if (fetchError) throw fetchError;

        if (cert && cert.certificate_url && cert.certificate_url.includes('completion-certificates')) {
            // Extract the path from the URL
            // URL format: https://.../completion-certificates/batch-name/file.pdf
            const urlParts = cert.certificate_url.split('/completion-certificates/');
            if (urlParts.length > 1) {
                const filePath = urlParts[1];
                await supabaseAdmin.storage
                    .from('completion-certificates')
                    .remove([filePath]);
            }
        }

        const { error: deleteError } = await supabase
            .from('generated_certificates')
            .delete()
            .eq('certificate_id', certificateId);

        if (deleteError) throw deleteError;
        res.json({ success: true, message: 'Certificate deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
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
};
