const mammoth = require('mammoth');

// Note: PDF parsing is not currently supported due to library compatibility issues
// Users should convert PDFs to DOCX or TXT format, or enter text directly

/**
 * Extract text content from various file formats
 * Supports: PDF, DOCX, DOC, TXT
 */
const extractTextFromFile = async (fileBuffer, mimeType, fileName) => {
    try {
        // Handle DOCX files
        if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mimeType === 'application/msword') {
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            return result.value.trim();
        }
        
        // Handle PDF files
        if (mimeType === 'application/pdf') {
            // PDF parsing is currently not supported due to library compatibility issues
            // Users should convert PDFs to DOCX or TXT format, or enter text directly
            const error = new Error('PDF file parsing is not currently supported. Please convert your PDF to DOCX or TXT format, or enter the text content directly in the text input field.');
            error.code = 'PDF_NOT_SUPPORTED';
            throw error;
        }
        
        // Handle plain text files
        if (mimeType === 'text/plain' || fileName.endsWith('.txt')) {
            return fileBuffer.toString('utf-8').trim();
        }
        
        // If format not recognized, try to extract as text
        try {
            const text = fileBuffer.toString('utf-8');
            // Check if it looks like valid text (not binary)
            if (text && text.length > 0 && /^[\s\S]*$/.test(text)) {
                return text.trim();
            }
        } catch (err) {
            // Not a text file
        }
        
        throw new Error(`Unsupported file format: ${mimeType || 'unknown'}`);
    } catch (error) {
        console.error('Error extracting text from file:', error);
        throw new Error(`Failed to extract text from file: ${error.message}`);
    }
};

/**
 * Validate file type for text extraction
 * Note: PDF files are not supported due to library compatibility issues
 */
const isValidTextFile = (mimeType, fileName) => {
    // PDF files are not supported
    if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        return false;
    }
    
    const validMimeTypes = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'application/msword', // DOC
        'text/plain'
    ];
    
    const validExtensions = ['.docx', '.doc', '.txt'];
    
    const hasValidMimeType = validMimeTypes.includes(mimeType);
    const hasValidExtension = validExtensions.some(ext => 
        fileName.toLowerCase().endsWith(ext.toLowerCase())
    );
    
    return hasValidMimeType || hasValidExtension;
};

module.exports = {
    extractTextFromFile,
    isValidTextFile
};

