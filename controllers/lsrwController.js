const supabase = require("../config/supabase.js");
const { supabaseAdmin } = require("../config/supabase.js");
const path = require('path');
const mammoth = require('mammoth');
const { extractTextFromFile, isValidTextFile } = require('../utils/textExtractor');

/**
 * Parse DOCX file to extract questions and answers
 * Expected format (with line breaks):
 * Q1. What is the speaker's name?
 * a) Sophie
 * b) Marie
 * c) Claire
 * Correct Answer: B
 * 
 * Q2. Where does the speaker live?
 * a) Lyon
 * b) Marseille
 * c) Paris
 * Correct Answer: C
 */
const parseDocxQuestions = async (docxBuffer) => {
    try {
        const result = await mammoth.extractRawText({ buffer: docxBuffer });
        const text = result.value;

        const questions = [];
        
        // Regex pattern to match question number and all content until next question or end
        const questionRegex = /Q(\d+)\.\s*([\s\S]*?)(?=Q\d+\.|$)/gi;

        let questionMatch;
        const questionMap = new Map();

        // Extract all questions with their content blocks
        while ((questionMatch = questionRegex.exec(text)) !== null) {
            const questionNum = questionMatch[1];
            let questionBlock = questionMatch[2].trim();

            // Extract answer first (before removing it from the block)
            let correctAnswer = null;
            const answerMatch = questionBlock.match(/Correct Answer:\s*([a-e])|Answer:\s*([a-e])/i);
            if (answerMatch) {
                correctAnswer = (answerMatch[1] || answerMatch[2] || '').toLowerCase().trim();
            }

            // Remove answer line from question block
            questionBlock = questionBlock
                .replace(/Correct Answer:\s*[a-e].*$/gim, '')
                .replace(/Answer:\s*[a-e].*$/gim, '')
                .trim();

            // Extract all options (can be on same line or separate lines)
            // Pattern matches: a) OptionText, stopping at next option pattern or newline
            const options = [];
            // Match option pattern: a) followed by text until next option pattern (a-e) or newline
            // Use non-greedy match with lookahead to stop at next option
            const optionPattern = /([a-e])\)\s*([^\n\r]+?)(?=\s*[a-e]\)|$|\n|\r)/gi;
            let optionMatch;
            
            while ((optionMatch = optionPattern.exec(questionBlock)) !== null) {
                const optionKey = optionMatch[1].toLowerCase().trim();
                let optionText = optionMatch[2].trim();
                
                // Clean up option text - remove any trailing option patterns that might have been captured
                // Also remove any leading/trailing whitespace
                optionText = optionText.replace(/\s*[a-e]\)\s*$/, '').trim();
                
                // Skip if this looks like part of the question text (e.g., "Q1. What is...")
                // or if option text is empty
                if (optionText && !optionMatch[0].match(/^Q\d+\./)) {
                    options.push({
                        key: optionKey,
                        text: optionText
                    });
                }
            }

            // Extract the question text by removing all options
            // Remove all option patterns: a) text, b) text, etc. (handles same line and separate lines)
            let cleanQuestionText = questionBlock
                .replace(/([a-e])\)\s*[^\n\r]+?(?=\s*[a-e]\)|$|\n|\r)/gi, '') // Remove all option patterns
                .replace(/\s+/g, ' ') // Replace multiple whitespace/newlines with single space
                .trim();

            questionMap.set(questionNum, {
                question: cleanQuestionText,
                options: options,
                answer: correctAnswer
            });
        }

        // Convert map to array, sorted by question number
        const sortedQuestions = Array.from(questionMap.entries())
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .map(([num, data]) => ({
                questionNumber: `Q${num}`,
                question: data.question.trim(),
                options: data.options.map(opt => ({
                    key: opt.key.toLowerCase(),
                    text: opt.text.trim()
                })),
                correctAnswer: data.answer ? data.answer.toLowerCase() : null
            }));

        return sortedQuestions;
    } catch (error) {
        console.error('Error parsing DOCX:', error);
        throw new Error(`Failed to parse DOCX file: ${error.message}`);
    }
};

/**
 * Parse Reading Document to extract paragraph and questions
 * Flexible format support:
 * - Questions can be: Q1., 1., Question 1, etc.
 * - Options can be: a), a., A), A., etc.
 * - Answers can be: Correct Answer: A, Answer: A, Answer is A, etc.
 * - Paragraph can be anywhere (before questions)
 */
const parseReadingDocument = async (docxBuffer) => {
    try {
        const result = await mammoth.extractRawText({ buffer: docxBuffer });
        const text = result.value;

        // Find the first question using multiple patterns
        // Patterns: Q1., 1., Question 1, MCQ 1, "MCQ Questions:", etc.
        const questionPatterns = [
            /Q(\d+)\./i,                    // Q1.
            /^(\d+)\.\s+[A-Z]/m,            // 1. Question text
            /Question\s+(\d+)[:\.]/i,       // Question 1: or Question 1.
            /MCQ\s+(\d+)[:\.]/i,            // MCQ 1: or MCQ 1.
            /^(\d+)\)/m,                    // 1) Question text
            /MCQ Questions?:/i,              // MCQ Questions: or MCQ Question:
            /Questions?:/i,                  // Questions: or Question:
            /^(\d+)\s+[A-Z]/m               // 1 Question text (space after number)
        ];

        let firstQuestionMatch = null;
        let paragraphEndIndex = 0;

        for (const pattern of questionPatterns) {
            const match = text.match(pattern);
            if (match) {
                firstQuestionMatch = match;
                paragraphEndIndex = match.index;
                break;
            }
        }

        // If no question pattern found, try to find by option patterns
        if (!firstQuestionMatch) {
            const optionPattern = /^[a-dA-D][\)\.]\s+/mi;
            const optionMatch = text.match(optionPattern);
            if (optionMatch) {
                paragraphEndIndex = optionMatch.index;
            } else {
                // Look for common section headers
                const sectionHeaders = [
                    /Reading Passage:/i,
                    /Passage:/i,
                    /Text:/i,
                    /Paragraph:/i
                ];
                for (const header of sectionHeaders) {
                    const headerMatch = text.match(header);
                    if (headerMatch) {
                        // Find next section (questions)
                        const afterHeader = text.substring(headerMatch.index + headerMatch[0].length);
                        const nextSection = afterHeader.match(/(?:MCQ|Questions?|Q)/i);
                        if (nextSection) {
                            paragraphEndIndex = headerMatch.index + headerMatch[0].length + nextSection.index;
                            break;
                        }
                    }
                }
                // If still no match, assume first 50% is paragraph, rest is questions
                if (paragraphEndIndex === 0) {
                    paragraphEndIndex = Math.floor(text.length / 2);
                }
            }
        }

        // Extract paragraph (everything before the first question)
        const paragraph = text.substring(0, paragraphEndIndex).trim();

        // Extract questions from the remaining text
        let questionsText = text.substring(paragraphEndIndex);
        
        // Remove section headers like "MCQ Questions:" from questions text
        questionsText = questionsText.replace(/^(?:MCQ\s+)?Questions?:?\s*/i, '').trim();
        
        const questions = [];
        // Flexible question regex - matches various formats (numbered and unnumbered)
        const questionRegex = /(?:Q|Question|MCQ)?\s*(\d+)[:\.\)]\s*([\s\S]*?)(?=(?:Q|Question|MCQ)?\s*\d+[:\.\)]|$)/gi;
        let questionMatch;
        const questionMap = new Map();
        
        // First try numbered questions
        let foundNumbered = false;

        // Extract all questions with their content blocks (numbered)
        while ((questionMatch = questionRegex.exec(questionsText)) !== null) {
            foundNumbered = true;
            const questionNum = questionMatch[1];
            let questionBlock = questionMatch[2].trim();

            // Extract answer using multiple patterns
            let correctAnswer = null;
            const answerPatterns = [
                /Correct Answer:\s*([A-Da-d])/i,
                /Answer:\s*([A-Da-d])/i,
                /Answer is\s*([A-Da-d])/i,
                /Ans\.?\s*:\s*([A-Da-d])/i,
                /\(([A-Da-d])\)\s*is correct/i,
                /Correct:\s*([A-Da-d])/i
            ];

            for (const pattern of answerPatterns) {
                const answerMatch = questionBlock.match(pattern);
                if (answerMatch) {
                    correctAnswer = answerMatch[1].toUpperCase().trim();
                    break;
                }
            }

            // Remove answer line from question block
            questionBlock = questionBlock
                .replace(/Correct Answer:\s*[A-Da-d].*$/gim, '')
                .replace(/Answer:\s*[A-Da-d].*$/gim, '')
                .replace(/Answer is\s*[A-Da-d].*$/gim, '')
                .replace(/Ans\.?\s*:\s*[A-Da-d].*$/gim, '')
                .replace(/\([A-Da-d]\)\s*is correct.*$/gim, '')
                .replace(/Correct:\s*[A-Da-d].*$/gim, '')
                .trim();

            // Extract all options using multiple patterns
            const options = [];
            const optionPatterns = [
                /([a-d])\)\s*([^\n\r]+?)(?=\s*[a-d]\)|$|\n|\r)/gi,  // a) option
                /([a-d])\.\s*([^\n\r]+?)(?=\s*[a-d]\.|$|\n|\r)/gi,   // a. option
                /([A-D])\)\s*([^\n\r]+?)(?=\s*[A-D]\)|$|\n|\r)/gi,  // A) option
                /([A-D])\.\s*([^\n\r]+?)(?=\s*[A-D]\.|$|\n|\r)/gi,   // A. option
                /^([a-d])\)\s*(.+)$/gim,                              // a) option (line start)
                /^([a-d])\.\s*(.+)$/gim                               // a. option (line start)
            ];

            for (const pattern of optionPatterns) {
                let optionMatch;
                const regex = new RegExp(pattern.source, pattern.flags);
                while ((optionMatch = regex.exec(questionBlock)) !== null) {
                    const optionKey = optionMatch[1].toLowerCase().trim();
                    let optionText = optionMatch[2] ? optionMatch[2].trim() : '';
                    
                    // Clean up option text
                    optionText = optionText
                        .replace(/\s*[a-dA-D][\)\.]\s*$/, '')
                        .replace(/^\s*[a-dA-D][\)\.]\s*/, '')
                        .trim();
                    
                    // Skip if empty or looks like part of question
                    if (optionText && 
                        !optionText.match(/^Q\d+\./i) && 
                        !optionText.match(/^Question\s+\d+/i) &&
                        optionText.length > 1) {
                        // Check if this option already exists
                        const existingOption = options.find(opt => opt.key === optionKey);
                        if (!existingOption) {
                            options.push({
                                key: optionKey,
                                text: optionText
                            });
                        }
                    }
                }
            }

            // If no options found with patterns, try to extract from lines
            if (options.length === 0) {
                const lines = questionBlock.split(/\n/);
                for (const line of lines) {
                    const lineMatch = line.match(/^([a-dA-D])[\)\.]\s*(.+)$/);
                    if (lineMatch) {
                        const optionKey = lineMatch[1].toLowerCase().trim();
                        const optionText = lineMatch[2].trim();
                        if (optionText && optionText.length > 1) {
                            options.push({
                                key: optionKey,
                                text: optionText
                            });
                        }
                    }
                }
            }

            // Extract the question text by removing all options
            let cleanQuestionText = questionBlock
                .replace(/([a-dA-D])[\)\.]\s*[^\n\r]+/g, '')  // Remove option patterns
                .replace(/\s+/g, ' ')
                .trim();

            // If question text is empty, try to get first line
            if (!cleanQuestionText && questionBlock) {
                const firstLine = questionBlock.split(/\n/)[0].trim();
                if (firstLine && !firstLine.match(/^[a-dA-D][\)\.]/)) {
                    cleanQuestionText = firstLine;
                }
            }

            if (cleanQuestionText || options.length > 0) {
                questionMap.set(questionNum, {
                    question: cleanQuestionText,
                    options: options,
                    answer: correctAnswer
                });
            }
        }
        
        // If no numbered questions found, try to extract unnumbered questions
        if (!foundNumbered && questionMap.size === 0) {
            // Split by potential question separators
            const questionBlocks = questionsText.split(/(?=\n\s*[a-dA-D][\)\.]\s+)/i);
            
            questionBlocks.forEach((block, index) => {
                if (!block.trim()) return;
                
                let questionBlock = block.trim();
                
                // Extract answer
                let correctAnswer = null;
                const answerPatterns = [
                    /Correct Answer:\s*([A-Da-d])/i,
                    /Answer:\s*([A-Da-d])/i,
                    /Answer is\s*([A-Da-d])/i,
                    /Ans\.?\s*:\s*([A-Da-d])/i,
                    /\(([A-Da-d])\)\s*is correct/i,
                    /Correct:\s*([A-Da-d])/i
                ];

                for (const pattern of answerPatterns) {
                    const answerMatch = questionBlock.match(pattern);
                    if (answerMatch) {
                        correctAnswer = answerMatch[1].toUpperCase().trim();
                        break;
                    }
                }

                // Remove answer lines
                questionBlock = questionBlock
                    .replace(/Correct Answer:\s*[A-Da-d].*$/gim, '')
                    .replace(/Answer:\s*[A-Da-d].*$/gim, '')
                    .replace(/Answer is\s*[A-Da-d].*$/gim, '')
                    .replace(/Ans\.?\s*:\s*[A-Da-d].*$/gim, '')
                    .replace(/\([A-Da-d]\)\s*is correct.*$/gim, '')
                    .replace(/Correct:\s*[A-Da-d].*$/gim, '')
                    .trim();

                // Extract options
                const options = [];
                const optionPatterns = [
                    /([a-d])\)\s*([^\n\r]+?)(?=\s*[a-d]\)|$|\n|\r)/gi,
                    /([a-d])\.\s*([^\n\r]+?)(?=\s*[a-d]\.|$|\n|\r)/gi,
                    /([A-D])\)\s*([^\n\r]+?)(?=\s*[A-D]\)|$|\n|\r)/gi,
                    /([A-D])\.\s*([^\n\r]+?)(?=\s*[A-D]\.|$|\n|\r)/gi
                ];

                for (const pattern of optionPatterns) {
                    let optionMatch;
                    const regex = new RegExp(pattern.source, pattern.flags);
                    while ((optionMatch = regex.exec(questionBlock)) !== null) {
                        const optionKey = optionMatch[1].toLowerCase().trim();
                        let optionText = optionMatch[2] ? optionMatch[2].trim() : '';
                        
                        optionText = optionText
                            .replace(/\s*[a-dA-D][\)\.]\s*$/, '')
                            .trim();
                        
                        if (optionText && optionText.length > 1) {
                            const existingOption = options.find(opt => opt.key === optionKey);
                            if (!existingOption) {
                                options.push({ key: optionKey, text: optionText });
                            }
                        }
                    }
                }

                // If no options found, try line-by-line
                if (options.length === 0) {
                    const lines = questionBlock.split(/\n/);
                    for (const line of lines) {
                        const lineMatch = line.match(/^([a-dA-D])[\)\.]\s*(.+)$/);
                        if (lineMatch) {
                            const optionKey = lineMatch[1].toLowerCase().trim();
                            const optionText = lineMatch[2].trim();
                            if (optionText && optionText.length > 1) {
                                options.push({ key: optionKey, text: optionText });
                            }
                        }
                    }
                }

                // Extract question text
                let cleanQuestionText = questionBlock
                    .replace(/([a-dA-D])[\)\.]\s*[^\n\r]+/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (!cleanQuestionText && questionBlock) {
                    const firstLine = questionBlock.split(/\n/)[0].trim();
                    if (firstLine && !firstLine.match(/^[a-dA-D][\)\.]/)) {
                        cleanQuestionText = firstLine;
                    }
                }

                if ((cleanQuestionText || options.length > 0) && options.length >= 2) {
                    questionMap.set(String(index + 1), {
                        question: cleanQuestionText,
                        options: options,
                        answer: correctAnswer
                    });
                }
            });
        }

        // Convert map to array, sorted by question number, and format for Reading module
        const sortedQuestions = Array.from(questionMap.entries())
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .map(([num, data]) => {
                // Map options to optionA, optionB, optionC, optionD
                const optionMap = {};
                data.options.forEach(opt => {
                    if (opt.key === 'a') optionMap.optionA = opt.text;
                    if (opt.key === 'b') optionMap.optionB = opt.text;
                    if (opt.key === 'c') optionMap.optionC = opt.text;
                    if (opt.key === 'd') optionMap.optionD = opt.text;
                });

                return {
                    question: data.question.trim(),
                    optionA: optionMap.optionA || '',
                    optionB: optionMap.optionB || '',
                    optionC: optionMap.optionC || '',
                    optionD: optionMap.optionD || '',
                    correct_answer: data.answer || ''
                };
            });

        // Return all extracted questions (no limit, no padding)
        return {
            paragraph: paragraph,
            questions: sortedQuestions
        };
    } catch (error) {
        console.error('Error parsing reading document:', error);
        throw new Error(`Failed to parse reading document: ${error.message}`);
    }
};

/**
 * Extract Reading content from uploaded file (for preview)
 * POST /api/reading/extract
 */
exports.extractReadingContent = async (req, res) => {
    try {
        const readingFile = req.files?.readingFile?.[0];

        if (!readingFile) {
            return res.status(400).json({ error: "No file provided" });
        }

        // Validate file type
        if (!isValidTextFile(readingFile.mimetype, readingFile.originalname)) {
            if (readingFile.mimetype === 'application/pdf' || readingFile.originalname.toLowerCase().endsWith('.pdf')) {
                return res.status(400).json({ 
                    error: "PDF files are not currently supported",
                    hint: "Please convert your PDF to DOCX or TXT format"
                });
            }
            return res.status(400).json({ 
                error: "Invalid file type. Only DOCX, DOC, or TXT files are allowed" 
            });
        }

        // Parse the document
        let extractedData;
        if (readingFile.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            readingFile.mimetype === 'application/msword') {
            // DOCX/DOC file - use mammoth to parse
            extractedData = await parseReadingDocument(readingFile.buffer);
        } else if (readingFile.mimetype === 'text/plain' || readingFile.originalname.toLowerCase().endsWith('.txt')) {
            // TXT file - parse as plain text using same flexible parsing logic
            const text = readingFile.buffer.toString('utf-8');
            
            // Find the first question using multiple patterns
            const questionPatterns = [
                /Q(\d+)\./i,
                /^(\d+)\.\s+[A-Z]/m,
                /Question\s+(\d+)[:\.]/i,
                /MCQ\s+(\d+)[:\.]/i,
                /^(\d+)\)/m,
                /MCQ Questions?:/i,
                /Questions?:/i,
                /^(\d+)\s+[A-Z]/m
            ];

            let firstQuestionMatch = null;
            let paragraphEndIndex = 0;

            for (const pattern of questionPatterns) {
                const match = text.match(pattern);
                if (match) {
                    firstQuestionMatch = match;
                    paragraphEndIndex = match.index;
                    break;
                }
            }

            // If no question pattern found, try to find by option patterns
            if (!firstQuestionMatch) {
                const optionPattern = /^[a-dA-D][\)\.]\s+/mi;
                const optionMatch = text.match(optionPattern);
                if (optionMatch) {
                    paragraphEndIndex = optionMatch.index;
                } else {
                    // Look for section headers
                    const sectionHeaders = [
                        /Reading Passage:/i,
                        /Passage:/i,
                        /Text:/i,
                        /Paragraph:/i
                    ];
                    for (const header of sectionHeaders) {
                        const headerMatch = text.match(header);
                        if (headerMatch) {
                            const afterHeader = text.substring(headerMatch.index + headerMatch[0].length);
                            const nextSection = afterHeader.match(/(?:MCQ|Questions?|Q)/i);
                            if (nextSection) {
                                paragraphEndIndex = headerMatch.index + headerMatch[0].length + nextSection.index;
                                break;
                            }
                        }
                    }
                    if (paragraphEndIndex === 0) {
                        paragraphEndIndex = Math.floor(text.length / 2);
                    }
                }
            }

            const paragraph = text.substring(0, paragraphEndIndex).trim();
            let questionsText = text.substring(paragraphEndIndex);
            
            // Remove section headers
            questionsText = questionsText.replace(/^(?:MCQ\s+)?Questions?:?\s*/i, '').trim();
            
            // Use flexible question regex
            const questions = [];
            const questionRegex = /(?:Q|Question|MCQ)?\s*(\d+)[:\.\)]\s*([\s\S]*?)(?=(?:Q|Question|MCQ)?\s*\d+[:\.\)]|$)/gi;
            let questionMatch;
            const questionMap = new Map();
            let foundNumbered = false;

            while ((questionMatch = questionRegex.exec(questionsText)) !== null) {
                foundNumbered = true;
                const questionNum = questionMatch[1];
                let questionBlock = questionMatch[2].trim();

                // Extract answer using multiple patterns
                let correctAnswer = null;
                const answerPatterns = [
                    /Correct Answer:\s*([A-Da-d])/i,
                    /Answer:\s*([A-Da-d])/i,
                    /Answer is\s*([A-Da-d])/i,
                    /Ans\.?\s*:\s*([A-Da-d])/i,
                    /\(([A-Da-d])\)\s*is correct/i,
                    /Correct:\s*([A-Da-d])/i
                ];

                for (const pattern of answerPatterns) {
                    const answerMatch = questionBlock.match(pattern);
                    if (answerMatch) {
                        correctAnswer = answerMatch[1].toUpperCase().trim();
                        break;
                    }
                }

                // Remove answer lines
                questionBlock = questionBlock
                    .replace(/Correct Answer:\s*[A-Da-d].*$/gim, '')
                    .replace(/Answer:\s*[A-Da-d].*$/gim, '')
                    .replace(/Answer is\s*[A-Da-d].*$/gim, '')
                    .replace(/Ans\.?\s*:\s*[A-Da-d].*$/gim, '')
                    .replace(/\([A-Da-d]\)\s*is correct.*$/gim, '')
                    .replace(/Correct:\s*[A-Da-d].*$/gim, '')
                    .trim();

                // Extract options using multiple patterns
                const options = [];
                const optionPatterns = [
                    /([a-d])\)\s*([^\n\r]+?)(?=\s*[a-d]\)|$|\n|\r)/gi,
                    /([a-d])\.\s*([^\n\r]+?)(?=\s*[a-d]\.|$|\n|\r)/gi,
                    /([A-D])\)\s*([^\n\r]+?)(?=\s*[A-D]\)|$|\n|\r)/gi,
                    /([A-D])\.\s*([^\n\r]+?)(?=\s*[A-D]\.|$|\n|\r)/gi
                ];

                for (const pattern of optionPatterns) {
                    let optionMatch;
                    const regex = new RegExp(pattern.source, pattern.flags);
                    while ((optionMatch = regex.exec(questionBlock)) !== null) {
                        const optionKey = optionMatch[1].toLowerCase().trim();
                        let optionText = optionMatch[2] ? optionMatch[2].trim() : '';
                        
                        optionText = optionText
                            .replace(/\s*[a-dA-D][\)\.]\s*$/, '')
                            .trim();
                        
                        if (optionText && 
                            !optionText.match(/^Q\d+\./i) && 
                            optionText.length > 1) {
                            const existingOption = options.find(opt => opt.key === optionKey);
                            if (!existingOption) {
                                options.push({ key: optionKey, text: optionText });
                            }
                        }
                    }
                }

                // If no options found, try line-by-line
                if (options.length === 0) {
                    const lines = questionBlock.split(/\n/);
                    for (const line of lines) {
                        const lineMatch = line.match(/^([a-dA-D])[\)\.]\s*(.+)$/);
                        if (lineMatch) {
                            const optionKey = lineMatch[1].toLowerCase().trim();
                            const optionText = lineMatch[2].trim();
                            if (optionText && optionText.length > 1) {
                                options.push({ key: optionKey, text: optionText });
                            }
                        }
                    }
                }

                // Extract question text
                let cleanQuestionText = questionBlock
                    .replace(/([a-dA-D])[\)\.]\s*[^\n\r]+/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (!cleanQuestionText && questionBlock) {
                    const firstLine = questionBlock.split(/\n/)[0].trim();
                    if (firstLine && !firstLine.match(/^[a-dA-D][\)\.]/)) {
                        cleanQuestionText = firstLine;
                    }
                }

                if (cleanQuestionText || options.length > 0) {
                    questionMap.set(questionNum, {
                        question: cleanQuestionText,
                        options: options,
                        answer: correctAnswer
                    });
                }
            }
            
            // If no numbered questions found, try unnumbered questions
            if (!foundNumbered && questionMap.size === 0) {
                const questionBlocks = questionsText.split(/(?=\n\s*[a-dA-D][\)\.]\s+)/i);
                
                questionBlocks.forEach((block, index) => {
                    if (!block.trim()) return;
                    
                    let questionBlock = block.trim();
                    
                    // Extract answer
                    let correctAnswer = null;
                    const answerPatterns = [
                        /Correct Answer:\s*([A-Da-d])/i,
                        /Answer:\s*([A-Da-d])/i,
                        /Answer is\s*([A-Da-d])/i,
                        /Ans\.?\s*:\s*([A-Da-d])/i,
                        /\(([A-Da-d])\)\s*is correct/i,
                        /Correct:\s*([A-Da-d])/i
                    ];

                    for (const pattern of answerPatterns) {
                        const answerMatch = questionBlock.match(pattern);
                        if (answerMatch) {
                            correctAnswer = answerMatch[1].toUpperCase().trim();
                            break;
                        }
                    }

                    questionBlock = questionBlock
                        .replace(/Correct Answer:\s*[A-Da-d].*$/gim, '')
                        .replace(/Answer:\s*[A-Da-d].*$/gim, '')
                        .replace(/Answer is\s*[A-Da-d].*$/gim, '')
                        .replace(/Ans\.?\s*:\s*[A-Da-d].*$/gim, '')
                        .replace(/\([A-Da-d]\)\s*is correct.*$/gim, '')
                        .replace(/Correct:\s*[A-Da-d].*$/gim, '')
                        .trim();

                    const options = [];
                    const optionPatterns = [
                        /([a-d])\)\s*([^\n\r]+?)(?=\s*[a-d]\)|$|\n|\r)/gi,
                        /([a-d])\.\s*([^\n\r]+?)(?=\s*[a-d]\.|$|\n|\r)/gi,
                        /([A-D])\)\s*([^\n\r]+?)(?=\s*[A-D]\)|$|\n|\r)/gi,
                        /([A-D])\.\s*([^\n\r]+?)(?=\s*[A-D]\.|$|\n|\r)/gi
                    ];

                    for (const pattern of optionPatterns) {
                        let optionMatch;
                        const regex = new RegExp(pattern.source, pattern.flags);
                        while ((optionMatch = regex.exec(questionBlock)) !== null) {
                            const optionKey = optionMatch[1].toLowerCase().trim();
                            let optionText = optionMatch[2] ? optionMatch[2].trim() : '';
                            
                            optionText = optionText
                                .replace(/\s*[a-dA-D][\)\.]\s*$/, '')
                                .trim();
                            
                            if (optionText && optionText.length > 1) {
                                const existingOption = options.find(opt => opt.key === optionKey);
                                if (!existingOption) {
                                    options.push({ key: optionKey, text: optionText });
                                }
                            }
                        }
                    }

                    if (options.length === 0) {
                        const lines = questionBlock.split(/\n/);
                        for (const line of lines) {
                            const lineMatch = line.match(/^([a-dA-D])[\)\.]\s*(.+)$/);
                            if (lineMatch) {
                                const optionKey = lineMatch[1].toLowerCase().trim();
                                const optionText = lineMatch[2].trim();
                                if (optionText && optionText.length > 1) {
                                    options.push({ key: optionKey, text: optionText });
                                }
                            }
                        }
                    }

                    let cleanQuestionText = questionBlock
                        .replace(/([a-dA-D])[\)\.]\s*[^\n\r]+/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();

                    if (!cleanQuestionText && questionBlock) {
                        const firstLine = questionBlock.split(/\n/)[0].trim();
                        if (firstLine && !firstLine.match(/^[a-dA-D][\)\.]/)) {
                            cleanQuestionText = firstLine;
                        }
                    }

                    if ((cleanQuestionText || options.length > 0) && options.length >= 2) {
                        questionMap.set(String(index + 1), {
                            question: cleanQuestionText,
                            options: options,
                            answer: correctAnswer
                        });
                    }
                });
            }

            const sortedQuestions = Array.from(questionMap.entries())
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                .map(([num, data]) => {
                    const optionMap = {};
                    data.options.forEach(opt => {
                        if (opt.key === 'a') optionMap.optionA = opt.text;
                        if (opt.key === 'b') optionMap.optionB = opt.text;
                        if (opt.key === 'c') optionMap.optionC = opt.text;
                        if (opt.key === 'd') optionMap.optionD = opt.text;
                    });

                    return {
                        question: data.question.trim(),
                        optionA: optionMap.optionA || '',
                        optionB: optionMap.optionB || '',
                        optionC: optionMap.optionC || '',
                        optionD: optionMap.optionD || '',
                        correct_answer: data.answer || ''
                    };
                });

            // Return all extracted questions (no limit, no padding)
            extractedData = {
                paragraph: paragraph,
                questions: sortedQuestions
            };
        } else {
            return res.status(400).json({ error: "Unsupported file format" });
        }

        res.json({
            success: true,
            data: extractedData
        });

    } catch (error) {
        console.error('Error extracting reading content:', error);
        res.status(500).json({ 
            error: error.message || "Failed to extract reading content",
            details: error.message
        });
    }
};

/**
 * Upload LSRW content (audio + docx)
 * POST /api/lsrw/upload
 */
exports.uploadLSRWContent = async (req, res) => {
    try {
        // Extract form data - FormData sends everything as strings
        const course_id = req.body.course_id;
        const title = req.body.title;
        const instruction = req.body.instruction;
        const max_marks = req.body.max_marks;
        const module_type = req.body.module_type || 'listening';
        
        const audioFile = req.files?.audio?.[0];
        const videoFile = req.files?.video?.[0];
        const questionDoc = req.files?.questionDoc?.[0];
        const externalMediaUrl = req.body.external_media_url?.trim() || null;

        console.log('📤 LSRW Upload Request:', {
            course_id,
            title,
            hasAudio: !!audioFile,
            hasVideo: !!videoFile,
            hasExternalUrl: !!externalMediaUrl,
            hasDoc: !!questionDoc,
            module_type
        });

        // Validation
        if (!course_id || !title) {
            return res.status(400).json({ error: "Course ID and title are required" });
        }

        // For listening module: At least one media source is required (audio, video, or URL)
        if (module_type === 'listening') {
            if (!audioFile && !videoFile && !externalMediaUrl) {
                return res.status(400).json({ error: "At least one media source is required: Audio file, Video file, or External Media URL" });
            }
        } else {
            // For other modules, audio is still required (existing behavior)
            if (!audioFile) {
                return res.status(400).json({ error: "Audio file is required" });
            }
        }

        if (!questionDoc) {
            return res.status(400).json({ error: "Question document is required" });
        }

        // Validate file types
        if (audioFile && !audioFile.mimetype.startsWith('audio/')) {
            return res.status(400).json({ error: "Audio file must be an audio format (MP3, WAV, etc.)" });
        }

        if (videoFile && !videoFile.mimetype.startsWith('video/')) {
            return res.status(400).json({ error: "Video file must be a video format (MP4, etc.)" });
        }

        if (questionDoc.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
            questionDoc.mimetype !== 'application/msword') {
            return res.status(400).json({ error: "Question document must be a DOCX or DOC file" });
        }

        // Determine media type and source based on priority: Audio > Video > URL
        let mediaType = null;
        let audioUrl = null;
        let videoUrl = null;
        let externalUrl = null;
        let uploadedFiles = []; // Track uploaded files for cleanup if needed

        // Get course details to build storage path
        console.log('🔍 Looking up course:', course_id);
        console.log('📋 Request body:', req.body);
        console.log('📋 Request files:', Object.keys(req.files || {}));
        
        // First, let's check if course exists - try with different formats
        let course = null;
        let courseError = null;
        
        // Try exact match first
        const { data: courseData, error: lookupError } = await supabase
            .from('courses')
            .select('id, language, course_name')
            .eq('id', course_id)
            .single();

        if (lookupError) {
            console.error('❌ Course lookup error:', lookupError);
            courseError = lookupError;
        } else if (courseData) {
            course = courseData;
            console.log('✅ Course found:', course.course_name);
        } else {
            // Try to find by checking all courses (for debugging)
            const { data: allCourses } = await supabase
                .from('courses')
                .select('id, course_name, language')
                .limit(10);
            
            console.log('📚 Sample courses in DB:', allCourses);
            console.error('❌ Course not found. Looking for:', course_id);
        }

        if (courseError || !course) {
            return res.status(404).json({ 
                error: "Course not found",
                details: courseError?.message || "Course does not exist in database",
                course_id: course_id,
                hint: "Please verify the course ID is correct and the course exists in the database"
            });
        }

        // Build storage path: lsrw/{language}/{course_code}/listening/
        const language = (course.language || 'general').toLowerCase().replace(/\s+/g, '_');
        const courseCode = (course.course_name || 'course').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const modulePath = module_type.toLowerCase();
        const basePath = `${language}/${courseCode}/${modulePath}`;

        // Generate unique filenames
        const timestamp = Date.now();
        const docExt = path.extname(questionDoc.originalname);
        const docFileName = `${title.toLowerCase().replace(/\s+/g, '_')}_${timestamp}${docExt}`;
        const docPath = `${basePath}/${docFileName}`;

        // Priority logic: Audio > Video > URL
        if (audioFile) {
            // Priority 1: Audio file
            mediaType = 'audio';
            const audioExt = path.extname(audioFile.originalname);
            const audioFileName = `${title.toLowerCase().replace(/\s+/g, '_')}_${timestamp}${audioExt}`;
            const audioPath = `${basePath}/${audioFileName}`;

            // Upload audio file
            const { data: audioUpload, error: audioError } = await supabaseAdmin.storage
                .from('lsrw')
                .upload(audioPath, audioFile.buffer, {
                    contentType: audioFile.mimetype,
                    upsert: false
                });

            if (audioError) {
                console.error('Audio upload error:', audioError);
                return res.status(500).json({ error: `Failed to upload audio: ${audioError.message}` });
            }

            const { data: audioUrlData } = supabaseAdmin.storage
                .from('lsrw')
                .getPublicUrl(audioPath);
            
            audioUrl = audioUrlData.publicUrl;
            uploadedFiles.push(audioPath);
            console.log('✅ Audio uploaded:', audioUrl);

        } else if (videoFile) {
            // Priority 2: Video file
            mediaType = 'video';
            const videoExt = path.extname(videoFile.originalname);
            const videoFileName = `${title.toLowerCase().replace(/\s+/g, '_')}_${timestamp}${videoExt}`;
            const videoPath = `${basePath}/${videoFileName}`;

            // Upload video file
            // Note: If bucket has MIME type restrictions, ensure video/* types are allowed in Supabase Dashboard
            const uploadOptions = {
                upsert: false
            };
            
            // Only set contentType if mimetype is valid (some buckets may reject certain MIME types)
            // If bucket doesn't allow video/mp4, you need to update bucket configuration in Supabase Dashboard
            if (videoFile.mimetype) {
                uploadOptions.contentType = videoFile.mimetype;
            }

            const { data: videoUpload, error: videoError } = await supabaseAdmin.storage
                .from('lsrw')
                .upload(videoPath, videoFile.buffer, uploadOptions);

            if (videoError) {
                console.error('Video upload error:', videoError);
                
                // Provide helpful error message if it's a MIME type issue
                if (videoError.message && videoError.message.includes('mime type') && videoError.message.includes('not supported')) {
                    return res.status(415).json({ 
                        error: `Video MIME type ${videoFile.mimetype} is not supported. Please update the 'lsrw' bucket configuration in Supabase Dashboard to allow video MIME types. See migration guide: migrations/update_lsrw_bucket_for_video.md` 
                    });
                }
                
                return res.status(500).json({ error: `Failed to upload video: ${videoError.message}` });
            }

            const { data: videoUrlData } = supabaseAdmin.storage
                .from('lsrw')
                .getPublicUrl(videoPath);
            
            videoUrl = videoUrlData.publicUrl;
            uploadedFiles.push(videoPath);
            console.log('✅ Video uploaded:', videoUrl);

        } else if (externalMediaUrl) {
            // Priority 3: External URL
            externalUrl = externalMediaUrl;
            
            // Auto-detect media type from URL
            const urlLower = externalMediaUrl.toLowerCase();
            if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be') || 
                urlLower.includes('vimeo.com') || urlLower.includes('dailymotion.com')) {
                mediaType = 'video_url';
                console.log('✅ External video URL detected');
            } else if (urlLower.endsWith('.mp3') || urlLower.includes('soundcloud.com') || 
                       urlLower.includes('audio') || urlLower.includes('mp3')) {
                mediaType = 'audio_url';
                console.log('✅ External audio URL detected');
            } else {
                // Default to video_url for unknown URLs (can be embedded)
                mediaType = 'video_url';
                console.log('✅ External URL detected (defaulting to video_url)');
            }
        }

        // Upload question document
        const { data: docUpload, error: docError } = await supabaseAdmin.storage
            .from('lsrw')
            .upload(docPath, questionDoc.buffer, {
                contentType: questionDoc.mimetype,
                upsert: false
            });

        if (docError) {
            console.error('Doc upload error:', docError);
            // Clean up uploaded media files if doc upload fails
            if (uploadedFiles.length > 0) {
                await supabaseAdmin.storage.from('lsrw').remove(uploadedFiles);
            }
            return res.status(500).json({ error: `Failed to upload question document: ${docError.message}` });
        }

        const { data: docUrlData } = supabaseAdmin.storage
            .from('lsrw')
            .getPublicUrl(docPath);

        // Parse questions from DOCX
        let parsedQuestions = [];
        try {
            parsedQuestions = await parseDocxQuestions(questionDoc.buffer);
        } catch (parseError) {
            console.error('Error parsing DOCX:', parseError);
            // Continue even if parsing fails - questions can be parsed later
        }

        // Get user ID from token and verify it exists in users table
        const userId = req.user?.id || null;
        let validUserId = null;

        if (userId) {
            // Verify user exists in public.users table
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // Calculate session_number for listening module
        let sessionNumber = null;
        if (module_type === 'listening') {
            // Get the maximum session_number for this course's listening materials
            const { data: existingSessions, error: sessionError } = await supabase
                .from('lsrw_content')
                .select('session_number')
                .eq('course_id', course_id)
                .eq('module_type', 'listening')
                .not('session_number', 'is', null)
                .order('session_number', { ascending: false })
                .limit(1);
            
            if (sessionError) {
                console.warn('Error fetching existing sessions:', sessionError);
            }
            
            // Assign next session number (max + 1, or 1 if no existing sessions)
            if (existingSessions && existingSessions.length > 0 && existingSessions[0].session_number) {
                sessionNumber = existingSessions[0].session_number + 1;
            } else {
                sessionNumber = 1; // First session for this course
            }
            
            console.log(`📝 Assigning Session ${sessionNumber} for course ${course_id}`);
        }

        // Prepare database insert data
        const insertData = {
            course_id,
            title,
            instruction: instruction || null,
            max_marks: parseInt(max_marks) || 0,
            question_doc_url: docUrlData.publicUrl,
            questions: parsedQuestions.length > 0 ? parsedQuestions : null,
            module_type,
            created_by: validUserId,
            // Media fields (only for listening module)
            ...(module_type === 'listening' && {
                audio_url: audioUrl || null,
                video_file_path: videoUrl || null,
                external_media_url: externalUrl || null,
                media_type: mediaType || null,
                session_number: sessionNumber
            })
        };

        // For non-listening modules, keep existing audio_url behavior
        if (module_type !== 'listening' && audioFile) {
            insertData.audio_url = audioUrl;
        }

        // Insert LSRW content into database
        const { data: lsrwContent, error: insertError } = await supabase
            .from('lsrw_content')
            .insert([insertData])
            .select()
            .single();

        if (insertError) {
            console.error('Database insert error:', insertError);
            // Clean up uploaded files
            const filesToRemove = [...uploadedFiles, docPath];
            await supabaseAdmin.storage.from('lsrw').remove(filesToRemove);
            return res.status(500).json({ error: `Failed to save content: ${insertError.message}` });
        }

        // The trigger will automatically link this content to all batches with the same course_id

        res.status(201).json({
            success: true,
            message: "LSRW content uploaded successfully",
            data: lsrwContent
        });

    } catch (error) {
        console.error('Error uploading LSRW content:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get LSRW content by course
 * GET /api/lsrw/byCourse/:course_id
 */
exports.getLSRWByCourse = async (req, res) => {
    try {
        const { course_id } = req.params;
        const { module_type = 'listening' } = req.query;

        // For listening module, order by session_number; for others, order by created_at
        let orderBy = { ascending: false };
        if (module_type === 'listening') {
            orderBy = { column: 'session_number', ascending: true }; // Session 1, 2, 3...
        } else {
            orderBy = { column: 'created_at', ascending: false };
        }

        const { data, error } = await supabase
            .from('lsrw_content')
            .select('*')
            .eq('course_id', course_id)
            .eq('module_type', module_type)
            .order(orderBy.column, orderBy);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching LSRW content:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Update session numbers for listening or speaking materials (reorder sessions)
 * PUT /api/lsrw/updateSessionNumbers
 * Body: { course_id, module_type: 'listening' | 'speaking' | 'writing' (optional), sessionOrders: [{ id, session_number }] }
 */
exports.updateSessionNumbers = async (req, res) => {
    try {
        const { course_id, module_type, sessionOrders } = req.body;

        // Validation
        if (!course_id || !sessionOrders || !Array.isArray(sessionOrders)) {
            return res.status(400).json({ 
                error: "course_id and sessionOrders array are required" 
            });
        }

        // Validate module_type
        if (module_type && !['listening', 'speaking', 'reading', 'writing'].includes(module_type)) {
            return res.status(400).json({ 
                error: "module_type must be 'listening', 'speaking', 'reading', or 'writing'" 
            });
        }

        // Validate sessionOrders structure (support both 'id' and 'lsrw_id')
        for (const order of sessionOrders) {
            if ((!order.lsrw_id && !order.id) || typeof order.session_number !== 'number') {
                return res.status(400).json({ 
                    error: "Each session order must have id (or lsrw_id) and session_number" 
                });
            }
        }

        // Determine which table to update based on module_type
        // If not specified, try to detect from the first order's ID
        let tableName = 'lsrw_content';
        let moduleTypeFilter = 'listening';
        
        if (module_type === 'speaking') {
            tableName = 'speaking_materials';
            moduleTypeFilter = null; // speaking_materials doesn't have module_type column
        } else if (module_type === 'reading') {
            tableName = 'reading_materials';
            moduleTypeFilter = null; // reading_materials doesn't have module_type column
        } else if (module_type === 'writing') {
            tableName = 'writing_tasks';
            moduleTypeFilter = null; // writing_tasks doesn't have module_type column
        } else if (!module_type) {
            // Auto-detect: check if ID exists in speaking_materials or writing_tasks first
            const firstOrder = sessionOrders[0];
            const recordId = firstOrder.lsrw_id || firstOrder.id;
            
            // Check speaking_materials first
            const { data: speakingCheck } = await supabase
                .from('speaking_materials')
                .select('id')
                .eq('id', recordId)
                .eq('course_id', course_id)
                .single();
            
            if (speakingCheck) {
                tableName = 'speaking_materials';
                moduleTypeFilter = null;
            } else {
                // Check reading_materials
                const { data: readingCheck } = await supabase
                    .from('reading_materials')
                    .select('id')
                    .eq('id', recordId)
                    .eq('course_id', course_id)
                    .single();
                
                if (readingCheck) {
                    tableName = 'reading_materials';
                    moduleTypeFilter = null;
                } else {
                    // Check writing_tasks
                    const { data: writingCheck } = await supabase
                        .from('writing_tasks')
                        .select('id')
                        .eq('id', recordId)
                        .eq('course_id', course_id)
                        .single();
                    
                    if (writingCheck) {
                        tableName = 'writing_tasks';
                        moduleTypeFilter = null;
                    }
                }
            }
        }

        // Update session numbers in a transaction-like manner
        const updatePromises = sessionOrders.map(async (order) => {
            // Support both 'id' and 'lsrw_id' for backward compatibility
            const recordId = order.lsrw_id || order.id;
            
            let query = supabase
                .from(tableName)
                .update({ session_number: order.session_number })
                .eq('id', recordId)
                .eq('course_id', course_id);
            
            // Add module_type filter only for lsrw_content
            if (moduleTypeFilter) {
                query = query.eq('module_type', moduleTypeFilter);
            }
            
            const { data, error } = await query.select();

            if (error) {
                throw new Error(`Failed to update session for ${recordId}: ${error.message}`);
            }

            return data;
        });

        await Promise.all(updatePromises);

        res.json({
            success: true,
            message: "Session numbers updated successfully",
            data: { course_id, module_type: module_type || 'auto-detected', updated_count: sessionOrders.length }
        });

    } catch (error) {
        console.error('Error updating session numbers:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Delete a listening session (delete entire session with all files)
 * DELETE /api/lsrw/session/:id
 * This will delete the lsrw_content record and all associated files from storage
 */
exports.deleteListeningSession = async (req, res) => {
    try {
        const { id } = req.params; // lsrw_content id

        if (!id) {
            return res.status(400).json({ error: "Session ID is required" });
        }

        // First, get the session data to find all file paths
        const { data: sessionData, error: fetchError } = await supabase
            .from('lsrw_content')
            .select('*')
            .eq('id', id)
            .eq('module_type', 'listening')
            .single();

        if (fetchError || !sessionData) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Collect all file paths to delete from storage
        const filesToDelete = [];
        
        // Extract file paths from URLs
        const extractPathFromUrl = (url) => {
            if (!url) return null;
            // Supabase storage URLs format: https://[project].supabase.co/storage/v1/object/public/lsrw/[path]
            const match = url.match(/\/storage\/v1\/object\/public\/lsrw\/(.+)$/);
            return match ? match[1] : null;
        };

        // Add audio file path
        if (sessionData.audio_url) {
            const audioPath = extractPathFromUrl(sessionData.audio_url);
            if (audioPath) filesToDelete.push(audioPath);
        }

        // Add video file path
        if (sessionData.video_file_path) {
            const videoPath = extractPathFromUrl(sessionData.video_file_path);
            if (videoPath) filesToDelete.push(videoPath);
        }

        // Add question document path
        if (sessionData.question_doc_url) {
            const docPath = extractPathFromUrl(sessionData.question_doc_url);
            if (docPath) filesToDelete.push(docPath);
        }

        // Delete files from storage
        if (filesToDelete.length > 0) {
            const { error: storageError } = await supabaseAdmin.storage
                .from('lsrw')
                .remove(filesToDelete);

            if (storageError) {
                console.error('Error deleting files from storage:', storageError);
                // Continue with database deletion even if storage deletion fails
                // (files might have been manually deleted or don't exist)
            } else {
                console.log(`✅ Deleted ${filesToDelete.length} file(s) from storage`);
            }
        }

        // Get course_id before deletion for reordering
        const courseId = sessionData.course_id;
        const sessionNumber = sessionData.session_number;

        // Delete the database record
        const { error: deleteError } = await supabase
            .from('lsrw_content')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: `Failed to delete session: ${deleteError.message}` });
        }

        // Reorder remaining sessions (decrease session numbers for sessions after deleted one)
        if (sessionNumber) {
            // Get all sessions after the deleted one
            const { data: sessionsToUpdate, error: fetchError } = await supabase
                .from('lsrw_content')
                .select('id, session_number')
                .eq('course_id', courseId)
                .eq('module_type', 'listening')
                .gt('session_number', sessionNumber)
                .order('session_number', { ascending: true });

            if (sessionsToUpdate && sessionsToUpdate.length > 0) {
                // Update each session number (decrement by 1)
                const updatePromises = sessionsToUpdate.map(session => 
                    supabase
                        .from('lsrw_content')
                        .update({ session_number: session.session_number - 1 })
                        .eq('id', session.id)
                );

                await Promise.all(updatePromises);
                console.log(`✅ Reordered ${sessionsToUpdate.length} session(s) after deletion`);
            }
        }

        res.json({
            success: true,
            message: "Session deleted successfully",
            data: {
                deleted_session_id: id,
                deleted_files_count: filesToDelete.length
            }
        });

    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Delete a speaking session (delete entire session with all files)
 * DELETE /api/speaking/session/:id
 * This will delete the speaking_materials record and all associated files from storage
 */
exports.deleteSpeakingSession = async (req, res) => {
    try {
        const { id } = req.params; // speaking_materials id

        if (!id) {
            return res.status(400).json({ error: "Session ID is required" });
        }

        // First, get the session data to find all file paths
        const { data: sessionData, error: fetchError } = await supabase
            .from('speaking_materials')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !sessionData) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Collect all file paths to delete from storage
        const filesToDelete = [];
        
        // Extract file paths from URLs
        const extractPathFromUrl = (url) => {
            if (!url) return null;
            // Supabase storage URLs format: https://[project].supabase.co/storage/v1/object/public/lsrw/[path]
            const match = url.match(/\/storage\/v1\/object\/public\/lsrw\/(.+)$/);
            return match ? match[1] : null;
        };

        // Add original file path (text file)
        if (sessionData.original_file_url) {
            const filePath = extractPathFromUrl(sessionData.original_file_url);
            if (filePath) filesToDelete.push(filePath);
        }

        // Delete files from storage
        if (filesToDelete.length > 0) {
            const { error: storageError } = await supabaseAdmin.storage
                .from('lsrw')
                .remove(filesToDelete);

            if (storageError) {
                console.error('Error deleting files from storage:', storageError);
                // Continue with database deletion even if storage deletion fails
                // (files might have been manually deleted or don't exist)
            } else {
                console.log(`✅ Deleted ${filesToDelete.length} file(s) from storage`);
            }
        }

        // Get course_id before deletion for reordering
        const courseId = sessionData.course_id;
        const sessionNumber = sessionData.session_number;

        // Delete the database record
        const { error: deleteError } = await supabase
            .from('speaking_materials')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: `Failed to delete session: ${deleteError.message}` });
        }

        // Reorder remaining sessions (decrease session numbers for sessions after deleted one)
        if (sessionNumber) {
            // Get all sessions after the deleted one
            const { data: sessionsToUpdate, error: fetchError } = await supabase
                .from('speaking_materials')
                .select('id, session_number')
                .eq('course_id', courseId)
                .gt('session_number', sessionNumber)
                .order('session_number', { ascending: true });

            if (sessionsToUpdate && sessionsToUpdate.length > 0) {
                // Update each session number (decrement by 1)
                const updatePromises = sessionsToUpdate.map(session => 
                    supabase
                        .from('speaking_materials')
                        .update({ session_number: session.session_number - 1 })
                        .eq('id', session.id)
                );

                await Promise.all(updatePromises);
                console.log(`✅ Reordered ${sessionsToUpdate.length} session(s) after deletion`);
            }
        }

        res.json({
            success: true,
            message: "Session deleted successfully",
            data: {
                deleted_session_id: id,
                deleted_files_count: filesToDelete.length
            }
        });

    } catch (error) {
        console.error('Error deleting speaking session:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Delete Reading Session (Resource Manager)
 * DELETE /api/reading/session/:id
 * - Deletes a reading material and all associated files
 * - Reorders remaining sessions
 */
exports.deleteReadingSession = async (req, res) => {
    try {
        const { id } = req.params; // reading_materials id

        if (!id) {
            return res.status(400).json({ error: "Session ID is required" });
        }

        // First, get the session data to find all file paths
        const { data: sessionData, error: fetchError } = await supabase
            .from('reading_materials')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !sessionData) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Collect all file paths to delete from storage
        const filesToDelete = [];
        
        // Extract file paths from URLs
        const extractPathFromUrl = (url) => {
            if (!url) return null;
            // Supabase storage URLs format: https://[project].supabase.co/storage/v1/object/public/lsrw/[path]
            const match = url.match(/\/storage\/v1\/object\/public\/lsrw\/(.+)$/);
            return match ? match[1] : null;
        };

        // Add file path (reading document)
        if (sessionData.file_url) {
            const filePath = extractPathFromUrl(sessionData.file_url);
            if (filePath) filesToDelete.push(filePath);
        }

        // Delete files from storage
        if (filesToDelete.length > 0) {
            const { error: storageError } = await supabaseAdmin.storage
                .from('lsrw')
                .remove(filesToDelete);

            if (storageError) {
                console.error('Error deleting files from storage:', storageError);
                // Continue with database deletion even if storage deletion fails
                // (files might have been manually deleted or don't exist)
            } else {
                console.log(`✅ Deleted ${filesToDelete.length} file(s) from storage`);
            }
        }

        // Get course_id before deletion for reordering
        const courseId = sessionData.course_id;
        const sessionNumber = sessionData.session_number;

        // Delete the database record
        const { error: deleteError } = await supabase
            .from('reading_materials')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: `Failed to delete session: ${deleteError.message}` });
        }

        // Reorder remaining sessions (decrease session numbers for sessions after deleted one)
        if (sessionNumber) {
            // Get all sessions after the deleted one
            const { data: sessionsToUpdate, error: fetchError } = await supabase
                .from('reading_materials')
                .select('id, session_number')
                .eq('course_id', courseId)
                .gt('session_number', sessionNumber)
                .order('session_number', { ascending: true });

            if (sessionsToUpdate && sessionsToUpdate.length > 0) {
                // Update each session number (decrement by 1)
                const updatePromises = sessionsToUpdate.map(session => 
                    supabase
                        .from('reading_materials')
                        .update({ session_number: session.session_number - 1 })
                        .eq('id', session.id)
                );

                await Promise.all(updatePromises);
                console.log(`✅ Reordered ${sessionsToUpdate.length} session(s) after deletion`);
            }
        }

        res.json({
            success: true,
            message: "Reading session deleted successfully",
            data: {
                deleted_session_id: id,
                deleted_files_count: filesToDelete.length
            }
        });

    } catch (error) {
        console.error('Error deleting reading session:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get LSRW content for a batch (Tutor view)
 * GET /api/lsrw/batch/:batch_id
 */
exports.getLSRWByBatch = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const { module_type = 'listening' } = req.query;

        // Get batch details to find course_id
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        const batchCourseId = batch.course_id;

        // Get LSRW content for this course with mapping details
        const { data: mappings, error: mappingError } = await supabase
            .from('lsrw_batch_mapping')
            .select('*')
            .eq('batch_id', batch_id)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get content details for each mapping
        const contentIds = mappings.map(m => m.lsrw_content_id);
        if (contentIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // IMPORTANT: Filter content by both module_type AND course_id to ensure
        // only content for this batch's course is shown
        // For listening module, order by session_number; for others, order by created_at
        let query = supabase
            .from('lsrw_content')
            .select('*')
            .in('id', contentIds)
            .eq('module_type', module_type)
            .eq('course_id', batchCourseId); // Add course_id filter to prevent cross-course content

        // Apply ordering
        if (module_type === 'listening') {
            query = query.order('session_number', { ascending: true }); // Session 1, 2, 3...
        } else {
            query = query.order('created_at', { ascending: false });
        }

        const { data: contents, error: contentError } = await query;

        if (contentError) {
            return res.status(500).json({ error: contentError.message });
        }

        // Filter mappings to only include those with matching course content
        const validMappings = mappings.filter(mapping => 
            contents.some(c => c.id === mapping.lsrw_content_id)
        );

        // Merge mappings with content and verify files exist in storage
        const dataWithFileCheck = await Promise.allSettled(
            validMappings.map(async (mapping) => {
                try {
                    const content = contents.find(c => c.id === mapping.lsrw_content_id);
                    if (!content) return null;

                // Extract file paths from URLs
                const extractFilePath = (url) => {
                    if (!url) return null;
                    try {
                        const urlObj = new URL(url);
                        const lsrwIndex = urlObj.pathname.indexOf('/lsrw/');
                        if (lsrwIndex !== -1) {
                            return urlObj.pathname.substring(lsrwIndex + 6);
                        }
                        const match = url.match(/\/lsrw\/(.+)$/);
                        return match ? match[1] : null;
                    } catch (err) {
                        const match = url.match(/\/lsrw\/(.+)$/);
                        return match ? match[1] : null;
                    }
                };

                const audioPath = extractFilePath(content.audio_url);
                const docPath = extractFilePath(content.question_doc_url);
                const videoPath = extractFilePath(content.video_file_path);

                // Check if files exist in storage by trying to download a small portion
                let audioExists = true;
                let docExists = true;
                let videoExists = true;
                let hasExternalUrl = false;

                if (audioPath && content.audio_url) {
                    try {
                        // Use HEAD request to check if file exists
                        // Add timeout to prevent hanging requests
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                        
                        const headResponse = await fetch(content.audio_url, { 
                            method: 'HEAD',
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);
                        audioExists = headResponse.ok;
                    } catch (err) {
                        // If fetch fails (network error, timeout, etc.), assume file doesn't exist
                        audioExists = false;
                        console.warn(`Audio file check failed for ${content.audio_url}:`, err.message);
                    }
                }

                if (docPath && content.question_doc_url) {
                    try {
                        // Try HEAD request to check if file exists
                        // Add timeout to prevent hanging requests
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                        
                        const headResponse = await fetch(content.question_doc_url, { 
                            method: 'HEAD',
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);
                        docExists = headResponse.ok;
                    } catch (err) {
                        // If fetch fails (network error, timeout, etc.), assume file doesn't exist
                        docExists = false;
                        console.warn(`Document file check failed for ${content.question_doc_url}:`, err.message);
                    }
                }

                if (videoPath && content.video_file_path) {
                    try {
                        // Use HEAD request to check if video file exists
                        // Add timeout to prevent hanging requests
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                        
                        const headResponse = await fetch(content.video_file_path, { 
                            method: 'HEAD',
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);
                        videoExists = headResponse.ok;
                    } catch (err) {
                        // If fetch fails (network error, timeout, etc.), assume file doesn't exist
                        videoExists = false;
                        console.warn(`Video file check failed for ${content.video_file_path}:`, err.message);
                    }
                }

                // Check if external media URL exists (for external URLs, we just check if URL is provided)
                if (content.external_media_url) {
                    hasExternalUrl = true; // External URLs don't need file existence check
                }

                // For video files and external URLs, if we have the URL, assume it exists even if HEAD check fails
                // (external URLs may not support HEAD requests, and video files might have CORS issues)
                if (content.video_file_path && !videoExists) {
                    // If we have a video_file_path but HEAD check failed, still assume it exists
                    // (could be CORS issue or network timeout, but file might still be accessible)
                    videoExists = true;
                }

                // Return content if at least one media source exists: audio, video, doc, or external URL
                // OR if we have video_file_path or external_media_url (assume they exist even if HEAD check failed)
                if (audioExists || docExists || videoExists || hasExternalUrl || content.video_file_path || content.external_media_url) {
                    return {
                        ...mapping,
                        lsrw_content: {
                            ...content,
                            audio_exists: audioExists,
                            doc_exists: docExists,
                            video_exists: videoExists || !!content.video_file_path,
                            has_external_url: hasExternalUrl || !!content.external_media_url
                        }
                    };
                }

                return null; // Skip content where no media source exists
                } catch (err) {
                    // If any error occurs during file checking, log it but still return the content
                    // (better to show content with potential file issues than to fail completely)
                    console.error(`Error checking files for content ${mapping.lsrw_content_id}:`, err.message);
                    const content = contents.find(c => c.id === mapping.lsrw_content_id);
                    if (!content) return null;
                    
                    // Return content even if file check failed (assume files exist)
                    return {
                        ...mapping,
                        lsrw_content: {
                            ...content,
                            audio_exists: !!content.audio_url,
                            doc_exists: !!content.question_doc_url,
                            video_exists: !!content.video_file_path,
                            has_external_url: !!content.external_media_url
                        }
                    };
                }
            })
        );

        // Handle Promise.allSettled results - extract values and filter out nulls/rejected
        const data = dataWithFileCheck
            .filter(result => result.status === 'fulfilled' && result.value !== null)
            .map(result => result.value);

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching batch LSRW content:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Mark LSRW lesson as completed (Tutor)
 * PUT /api/lsrw/complete/:mapping_id
 */
exports.markLSRWComplete = async (req, res) => {
    try {
        const { mapping_id } = req.params;
        const userId = req.user?.id || null;
        let validUserId = null;

        if (userId) {
            // Verify user exists in public.users table
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // First check if mapping exists
        const { data: existingMapping, error: checkError } = await supabase
            .from('lsrw_batch_mapping')
            .select('id')
            .eq('id', mapping_id)
            .single();

        if (checkError || !existingMapping) {
            return res.status(404).json({ 
                success: false,
                error: "Mapping not found" 
            });
        }

        // Update the mapping
        const { data, error } = await supabase
            .from('lsrw_batch_mapping')
            .update({
                tutor_status: 'completed',
                student_visible: true,
                completed_at: new Date().toISOString(),
                completed_by: validUserId
            })
            .eq('id', mapping_id)
            .select()
            .single();

        if (error) {
            console.error('Error updating mapping:', error);
            return res.status(500).json({ 
                success: false,
                error: error.message || "Failed to update mapping" 
            });
        }

        if (!data) {
            return res.status(404).json({ 
                success: false,
                error: "Mapping not found after update" 
            });
        }

        res.json({
            success: true,
            message: "Lesson marked as completed",
            data
        });

    } catch (error) {
        console.error('Error marking lesson complete:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get LSRW content for student (only visible ones)
 * GET /api/lsrw/student/:batch_id
 */
exports.getStudentLSRW = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const { module_type = 'listening' } = req.query;
        const studentId = req.user?.id || req.query.student_id;

        // Get batch details to find course_id
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        const batchCourseId = batch.course_id;

        // Get LSRW content visible to students
        const { data: mappings, error: mappingError } = await supabase
            .from('lsrw_batch_mapping')
            .select('*')
            .eq('batch_id', batch_id)
            .eq('student_visible', true)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get content details for each mapping
        const contentIds = mappings.map(m => m.lsrw_content_id);
        if (contentIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // IMPORTANT: Filter content by both module_type AND course_id to ensure
        // only content for this batch's course is shown
        const { data: contents, error: contentError } = await supabase
            .from('lsrw_content')
            .select('*')
            .in('id', contentIds)
            .eq('module_type', module_type)
            .eq('course_id', batchCourseId); // Add course_id filter to prevent cross-course content

        if (contentError) {
            return res.status(500).json({ error: contentError.message });
        }

        // Filter mappings to only include those with matching course content
        const validMappings = mappings.filter(mapping => 
            contents.some(c => c.id === mapping.lsrw_content_id)
        );

        // Merge mappings with content
        const data = validMappings.map(mapping => {
            const content = contents.find(c => c.id === mapping.lsrw_content_id);
            return {
                ...mapping,
                lsrw_content: content || null
            };
        }).filter(item => item.lsrw_content !== null);

        // If student_id provided, also get their submission status
        if (studentId) {
            const mappingIds = data.map(m => m.lsrw_content_id);
            const { data: submissions } = await supabase
                .from('lsrw_student_answers')
                .select('lsrw_content_id, score, submitted_at')
                .eq('student_id', studentId)
                .in('lsrw_content_id', mappingIds);

            // Add submission info to each mapping
            const submissionsMap = new Map();
            submissions?.forEach(sub => {
                submissionsMap.set(sub.lsrw_content_id, {
                    score: sub.score,
                    submitted_at: sub.submitted_at
                });
            });

            data.forEach(mapping => {
                mapping.submission = submissionsMap.get(mapping.lsrw_content_id) || null;
            });
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching student LSRW content:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Submit student answers
 * POST /api/lsrw/submit
 */
exports.submitStudentAnswers = async (req, res) => {
    try {
        const { student_id, lsrw_content_id, batch_id, answers } = req.body;

        if (!student_id || !lsrw_content_id || !batch_id || !answers) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Get LSRW content to calculate score
        const { data: content, error: contentError } = await supabase
            .from('lsrw_content')
            .select('questions, max_marks')
            .eq('id', lsrw_content_id)
            .single();

        if (contentError || !content) {
            return res.status(404).json({ error: "LSRW content not found" });
        }

        // Calculate score
        let score = 0;
        const questions = content.questions || [];
        questions.forEach((q, index) => {
            const questionKey = `Q${index + 1}`;
            const studentAnswer = answers[questionKey] || answers[`q${index + 1}`];
            if (studentAnswer && studentAnswer.toLowerCase() === (q.correctAnswer || '').toLowerCase()) {
                score++;
            }
        });

        // Calculate marks (if max_marks is set)
        const maxMarks = content.max_marks || questions.length;
        const calculatedMarks = maxMarks > 0 ? Math.round((score / questions.length) * maxMarks) : score;

        // Insert or update student answer
        const { data, error } = await supabase
            .from('lsrw_student_answers')
            .upsert({
                student_id,
                lsrw_content_id,
                batch_id,
                answers,
                score: calculatedMarks,
                max_marks: maxMarks,
                submitted_at: new Date().toISOString()
            }, {
                onConflict: 'student_id,lsrw_content_id,batch_id'
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            message: "Answers submitted successfully",
            data: {
                ...data,
                correctAnswers: score,
                totalQuestions: questions.length
            }
        });

    } catch (error) {
        console.error('Error submitting answers:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get student results
 * GET /api/lsrw/results/:student_id/:lsrw_id
 */
exports.getStudentResults = async (req, res) => {
    try {
        const { student_id, lsrw_id } = req.params;

        const { data, error } = await supabase
            .from('lsrw_student_answers')
            .select(`
                *,
                lsrw_content:lsrw_content_id (*)
            `)
            .eq('student_id', student_id)
            .eq('lsrw_content_id', lsrw_id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: "Results not found" });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            data
        });

    } catch (error) {
        console.error('Error fetching student results:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get student submissions for a batch (Tutor view - for verification)
 * GET /api/lsrw/batch/:batch_id/submissions
 */
exports.getStudentSubmissions = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const { lsrw_content_id } = req.query; // Optional filter by content

        if (!batch_id) {
            return res.status(400).json({ error: "Batch ID is required" });
        }

        // Verify batch exists and tutor has access
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('batch_id, teacher, course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Build query for student submissions
        let query = supabase
            .from('lsrw_student_answers')
            .select(`
                *,
                students:student_id (
                    student_id,
                    name,
                    registration_number
                ),
                lsrw_content:lsrw_content_id (
                    id,
                    title,
                    max_marks,
                    questions
                )
            `)
            .eq('batch_id', batch_id)
            .order('submitted_at', { ascending: false });

        // Filter by content if provided
        if (lsrw_content_id) {
            query = query.eq('lsrw_content_id', lsrw_content_id);
        }

        const { data: submissions, error: submissionsError } = await query;

        if (submissionsError) {
            return res.status(500).json({ error: submissionsError.message });
        }

        res.json({
            success: true,
            data: submissions || []
        });

    } catch (error) {
        console.error('Error fetching student submissions:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Verify and release student quiz marks (Tutor)
 * PUT /api/lsrw/verify/:submission_id
 */
exports.verifyStudentSubmission = async (req, res) => {
    try {
        const { submission_id } = req.params;
        const userId = req.user?.id || null;
        let validUserId = null;

        if (userId) {
            // Verify user exists in public.users table
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // Get submission to verify batch access
        const { data: submission, error: submissionError } = await supabase
            .from('lsrw_student_answers')
            .select('batch_id, batch:batch_id(teacher)')
            .eq('id', submission_id)
            .single();

        if (submissionError || !submission) {
            return res.status(404).json({ error: "Submission not found" });
        }

        // Update verification status
        const { data, error } = await supabase
            .from('lsrw_student_answers')
            .update({
                verified: true,
                verified_by: validUserId,
                verified_at: new Date().toISOString()
            })
            .eq('id', submission_id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            message: "Marks verified and released to student",
            data
        });

    } catch (error) {
        console.error('Error verifying submission:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

// =====================================================
// SPEAKING MODULE FUNCTIONS
// =====================================================

/**
 * Upload Speaking Material (Academic Admin)
 * POST /api/speaking/upload
 * - Accepts text file (PDF/DOCX/TXT) OR direct text input
 * - Extracts text content and stores in speaking_materials table
 * - Auto-maps to all batches with same course_id
 */
exports.uploadSpeakingMaterial = async (req, res) => {
    try {
        const course_id = req.body.course_id;
        const title = req.body.title;
        const instruction = req.body.instruction;
        const max_marks = req.body.max_marks ? parseInt(req.body.max_marks) : 0; // Max marks for speaking
        const content_text = req.body.content_text; // Direct text input
        const textFile = req.files?.textFile?.[0]; // Optional file upload

        console.log('📤 Speaking Material Upload Request:', {
            course_id,
            title,
            max_marks,
            hasTextFile: !!textFile,
            hasDirectText: !!content_text
        });

        // Validation
        if (!course_id || !title) {
            return res.status(400).json({ error: "Course ID and title are required" });
        }

        // Must have either file or direct text
        if (!textFile && !content_text) {
            return res.status(400).json({ error: "Either a text file or direct text content is required" });
        }

        // Get course details
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('id, language, course_name')
            .eq('id', course_id)
            .single();

        if (courseError || !course) {
            return res.status(404).json({ 
                error: "Course not found",
                details: courseError?.message || "Course does not exist in database"
            });
        }

        let extractedText = content_text || '';
        let originalFileUrl = null;

        // If file is uploaded, extract text from it
        if (textFile) {
            // Validate file type
            if (!isValidTextFile(textFile.mimetype, textFile.originalname)) {
                // Check if it's a PDF file
                if (textFile.mimetype === 'application/pdf' || textFile.originalname.toLowerCase().endsWith('.pdf')) {
                    return res.status(400).json({ 
                        error: "PDF files are not currently supported",
                        hint: "Please convert your PDF to DOCX or TXT format, or enter the text content directly in the text input field"
                    });
                }
                return res.status(400).json({ 
                    error: "Invalid file type. Only DOCX, DOC, or TXT files are allowed (PDF is not supported)" 
                });
            }

            // Extract text from file
            try {
                extractedText = await extractTextFromFile(textFile.buffer, textFile.mimetype, textFile.originalname);
                
                if (!extractedText || extractedText.trim().length === 0) {
                    return res.status(400).json({ 
                        error: "File appears to be empty or could not extract text",
                        hint: "Please ensure the file contains readable text content"
                    });
                }

                // Optionally store original file in storage
                const language = (course.language || 'general').toLowerCase().replace(/\s+/g, '_');
                const courseCode = (course.course_name || 'course').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                const timestamp = Date.now();
                const fileExt = path.extname(textFile.originalname);
                const fileName = `${title.toLowerCase().replace(/\s+/g, '_')}_${timestamp}${fileExt}`;
                const filePath = `${language}/${courseCode}/speaking/${fileName}`;

                const { data: fileUpload, error: uploadError } = await supabaseAdmin.storage
                    .from('lsrw')
                    .upload(filePath, textFile.buffer, {
                        contentType: textFile.mimetype,
                        upsert: false
                    });

                if (!uploadError) {
                    const { data: urlData } = supabaseAdmin.storage
                        .from('lsrw')
                        .getPublicUrl(filePath);
                    originalFileUrl = urlData.publicUrl;
                }
            } catch (extractError) {
                console.error('Error extracting text:', extractError);
                
                // Handle PDF not supported error specifically
                if (extractError.code === 'PDF_NOT_SUPPORTED') {
                    return res.status(400).json({ 
                        error: "PDF files are not currently supported",
                        details: extractError.message,
                        hint: "Please convert your PDF to DOCX or TXT format, or enter the text content directly in the text input field below"
                    });
                }
                
                return res.status(400).json({ 
                    error: "Failed to extract text from file",
                    details: extractError.message,
                    hint: "Please ensure the file is a valid DOCX, DOC, or TXT file, or enter the text content directly"
                });
            }
        }

        // Validate extracted text
        if (!extractedText || extractedText.trim().length === 0) {
            return res.status(400).json({ error: "Content text cannot be empty" });
        }

        // Get user ID
        const userId = req.user?.id || null;
        let validUserId = null;

        if (userId) {
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // Calculate session_number for speaking module (auto-assign based on existing count)
        let sessionNumber = 1;
        const { data: existingSessions, error: countError } = await supabase
            .from('speaking_materials')
            .select('session_number')
            .eq('course_id', course_id)
            .not('session_number', 'is', null);

        if (!countError && existingSessions && existingSessions.length > 0) {
            // Get the maximum session_number for this course's speaking materials
            const maxSessionNumber = Math.max(...existingSessions.map(s => s.session_number || 0));
            sessionNumber = maxSessionNumber + 1;
        }

        // Insert speaking material into database
        const { data: speakingMaterial, error: insertError } = await supabase
            .from('speaking_materials')
            .insert([{
                course_id,
                title,
                instruction: instruction || null,
                max_marks: max_marks || 0,
                content_text: extractedText.trim(),
                original_file_url: originalFileUrl,
                session_number: sessionNumber,
                created_by: validUserId
            }])
            .select()
            .single();

        if (insertError) {
            console.error('Database insert error:', insertError);
            // Clean up uploaded file if exists
            if (originalFileUrl) {
                const filePath = originalFileUrl.split('/lsrw/')[1];
                if (filePath) {
                    await supabaseAdmin.storage.from('lsrw').remove([filePath]);
                }
            }
            return res.status(500).json({ error: `Failed to save material: ${insertError.message}` });
        }

        // The trigger will automatically link this material to all batches with the same course_id

        res.status(201).json({
            success: true,
            message: "Speaking material uploaded successfully",
            data: speakingMaterial
        });

    } catch (error) {
        console.error('Error uploading speaking material:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Speaking Materials by Course (Academic Admin)
 * GET /api/speaking/byCourse/:course_id
 */
exports.getSpeakingByCourse = async (req, res) => {
    try {
        const { course_id } = req.params;

        const { data, error } = await supabase
            .from('speaking_materials')
            .select('*')
            .eq('course_id', course_id)
            .order('session_number', { ascending: true, nullsLast: true })
            .order('created_at', { ascending: true });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching speaking materials:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Speaking Materials for a Batch (Teacher)
 * GET /api/speaking/batch/:batch_id
 */
exports.getSpeakingByBatch = async (req, res) => {
    try {
        const { batch_id } = req.params;

        // Get batch details to find course_id
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        const batchCourseId = batch.course_id;

        // Get speaking materials for this batch
        const { data: mappings, error: mappingError } = await supabase
            .from('speaking_batch_map')
            .select('*')
            .eq('batch_id', batch_id)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get material details for each mapping
        const materialIds = mappings.map(m => m.speaking_material_id);
        if (materialIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { data: materials, error: materialError } = await supabase
            .from('speaking_materials')
            .select('*')
            .in('id', materialIds)
            .eq('course_id', batchCourseId);

        if (materialError) {
            return res.status(500).json({ error: materialError.message });
        }

        // Merge mappings with materials
        const data = mappings.map(mapping => {
            const material = materials.find(m => m.id === mapping.speaking_material_id);
            return {
                ...mapping,
                speaking_material: material || null
            };
        }).filter(item => item.speaking_material !== null);

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching batch speaking materials:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Mark Speaking Material as Completed (Teacher)
 * PUT /api/speaking/complete/:mapping_id
 */
exports.markSpeakingComplete = async (req, res) => {
    try {
        const { mapping_id } = req.params;
        const userId = req.user?.id || null;
        let validUserId = null;

        if (userId) {
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // Update mapping to mark as completed and make visible to students
        const { data, error } = await supabase
            .from('speaking_batch_map')
            .update({
                tutor_status: 'completed',
                student_visible: true,
                completed_at: new Date().toISOString(),
                completed_by: validUserId
            })
            .eq('id', mapping_id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!data) {
            return res.status(404).json({ error: "Mapping not found" });
        }

        res.json({
            success: true,
            message: "Speaking material marked as completed",
            data
        });

    } catch (error) {
        console.error('Error marking speaking material complete:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Student Speaking Materials (Student View)
 * GET /api/speaking/student/:batch_id
 */
exports.getStudentSpeaking = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const studentId = req.user?.id || req.query.student_id;

        // Get batch details
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Get speaking materials visible to students
        const { data: mappings, error: mappingError } = await supabase
            .from('speaking_batch_map')
            .select('*')
            .eq('batch_id', batch_id)
            .eq('student_visible', true)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get material details
        const materialIds = mappings.map(m => m.speaking_material_id);
        if (materialIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { data: materials, error: materialError } = await supabase
            .from('speaking_materials')
            .select('*')
            .in('id', materialIds)
            .eq('course_id', batch.course_id);

        if (materialError) {
            return res.status(500).json({ error: materialError.message });
        }

        // Merge mappings with materials and sort by session_number
        const data = mappings.map(mapping => {
            const material = materials.find(m => m.id === mapping.speaking_material_id);
            return {
                ...mapping,
                speaking_material: material || null
            };
        }).filter(item => item.speaking_material !== null)
        .sort((a, b) => {
            const aSession = a.speaking_material?.session_number || 9999;
            const bSession = b.speaking_material?.session_number || 9999;
            return aSession - bSession;
        });

        // Get student's attempts if student_id provided
        if (studentId) {
            const materialIds = data.map(m => m.speaking_material_id);
            const { data: attempts } = await supabase
                .from('speaking_attempts')
                .select('*')
                .eq('student_id', studentId)
                .in('speaking_material_id', materialIds)
                .order('created_at', { ascending: false });

            // Group attempts by material_id
            const attemptsMap = new Map();
            attempts?.forEach(attempt => {
                const key = attempt.speaking_material_id;
                if (!attemptsMap.has(key) || attempt.status === 'submitted') {
                    attemptsMap.set(key, attempt);
                }
            });

            // Add attempt info to each material
            data.forEach(mapping => {
                const attempt = attemptsMap.get(mapping.speaking_material_id);
                mapping.attempt = attempt || null;
            });
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching student speaking materials:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Save Student Speaking Attempt (Draft or Submit)
 * POST /api/speaking/attempt
 */
exports.saveSpeakingAttempt = async (req, res) => {
    try {
        const { speaking_material_id, batch_id, audio_url, status = 'draft' } = req.body;
        const studentId = req.user?.id;

        if (!studentId) {
            return res.status(401).json({ error: "Student authentication required" });
        }

        if (!speaking_material_id || !batch_id || !audio_url) {
            return res.status(400).json({ error: "speaking_material_id, batch_id, and audio_url are required" });
        }

        if (status !== 'draft' && status !== 'submitted') {
            return res.status(400).json({ error: "Status must be 'draft' or 'submitted'" });
        }

        // Check if material is visible to students
        const { data: mapping, error: mappingError } = await supabase
            .from('speaking_batch_map')
            .select('*')
            .eq('speaking_material_id', speaking_material_id)
            .eq('batch_id', batch_id)
            .eq('student_visible', true)
            .single();

        if (mappingError || !mapping) {
            return res.status(403).json({ error: "This material is not available for students yet" });
        }

        // If submitting, check if there's already a submitted attempt
        if (status === 'submitted') {
            const { data: existingSubmitted } = await supabase
                .from('speaking_attempts')
                .select('id')
                .eq('student_id', studentId)
                .eq('speaking_material_id', speaking_material_id)
                .eq('batch_id', batch_id)
                .eq('status', 'submitted')
                .single();

            if (existingSubmitted) {
                return res.status(400).json({ error: "You have already submitted this attempt. Re-submission is not allowed." });
            }

            // Delete any existing draft attempts
            await supabase
                .from('speaking_attempts')
                .delete()
                .eq('student_id', studentId)
                .eq('speaking_material_id', speaking_material_id)
                .eq('batch_id', batch_id)
                .eq('status', 'draft');
        } else {
            // For draft, delete existing draft and create new one (re-record)
            await supabase
                .from('speaking_attempts')
                .delete()
                .eq('student_id', studentId)
                .eq('speaking_material_id', speaking_material_id)
                .eq('batch_id', batch_id)
                .eq('status', 'draft');
        }

        // Insert new attempt
        const attemptData = {
            student_id: studentId,
            speaking_material_id,
            batch_id,
            audio_url,
            status,
            submitted_at: status === 'submitted' ? new Date().toISOString() : null
        };

        const { data: attempt, error: insertError } = await supabase
            .from('speaking_attempts')
            .insert([attemptData])
            .select()
            .single();

        if (insertError) {
            console.error('Error saving attempt:', insertError);
            return res.status(500).json({ error: insertError.message });
        }

        res.status(201).json({
            success: true,
            message: status === 'submitted' ? "Speaking attempt submitted successfully" : "Draft saved successfully",
            data: attempt
        });

    } catch (error) {
        console.error('Error saving speaking attempt:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Student Speaking Attempts for Review (Teacher)
 * GET /api/speaking/batch/:batch_id/submissions
 */
exports.getSpeakingSubmissions = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const { speaking_material_id } = req.query;

        // Get all submitted attempts for this batch
        let query = supabase
            .from('speaking_attempts')
            .select(`
                *,
                speaking_materials:speaking_material_id (
                    id,
                    title,
                    instruction,
                    content_text,
                    max_marks
                ),
                students:student_id (
                    student_id,
                    name,
                    email,
                    registration_number
                )
            `)
            .eq('batch_id', batch_id)
            .eq('status', 'submitted')
            .order('submitted_at', { ascending: false });

        if (speaking_material_id) {
            query = query.eq('speaking_material_id', speaking_material_id);
        }

        const { data: attempts, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Get feedback for each attempt
        const attemptIds = attempts?.map(a => a.id) || [];
        let feedbackMap = new Map();

        if (attemptIds.length > 0) {
            const { data: feedbacks } = await supabase
                .from('speaking_feedback')
                .select('*')
                .in('attempt_id', attemptIds);

            feedbacks?.forEach(feedback => {
                feedbackMap.set(feedback.attempt_id, feedback);
            });
        }

        // Add feedback to each attempt
        const data = attempts?.map(attempt => ({
            ...attempt,
            max_marks: attempt.speaking_materials?.max_marks || null,
            content: attempt.speaking_materials || null,
            feedback: feedbackMap.get(attempt.id) || null
        })) || [];

        res.json({
            success: true,
            data
        });

    } catch (error) {
        console.error('Error fetching speaking submissions:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Add/Update Teacher Feedback for Speaking Attempt
 * POST /api/speaking/feedback
 * Supports both text and audio feedback
 */
exports.addSpeakingFeedback = async (req, res) => {
    try {
        console.log('📥 addSpeakingFeedback called - body:', req.body, 'files:', req.files);
        
        // For multipart requests, body fields come from FormData
        // For JSON requests, body fields come from JSON
        const attempt_id = req.body?.attempt_id;
        const remarks = req.body?.remarks;
        const marks = req.body?.marks;
        const audioFile = req.files?.audioFeedback?.[0]; // Optional audio feedback file
        const teacherId = req.user?.id;
        
        console.log('📋 Parsed values - attempt_id:', attempt_id, 'remarks:', remarks, 'marks:', marks, 'audioFile:', !!audioFile);

        if (!teacherId) {
            return res.status(401).json({ error: "Teacher authentication required" });
        }

        if (!attempt_id) {
            return res.status(400).json({ error: "attempt_id is required" });
        }

        // At least one of remarks, audioFile, or marks must be provided
        if (!remarks && !audioFile && (marks === undefined || marks === null)) {
            return res.status(400).json({ error: "Either remarks (text), audio feedback, or marks must be provided" });
        }

        // Validate marks if provided
        if (marks !== undefined && marks !== null) {
            const marksNum = parseInt(marks);
            if (isNaN(marksNum) || marksNum < 0) {
                return res.status(400).json({ error: "Marks must be a non-negative number" });
            }
        }

        // Verify attempt exists and is submitted, and get max_marks from speaking material
        console.log('🔍 Fetching attempt from database...');
        const { data: attempt, error: attemptError } = await supabase
            .from('speaking_attempts')
            .select(`
                id, 
                status,
                speaking_material_id
            `)
            .eq('id', attempt_id)
            .eq('status', 'submitted')
            .single();

        console.log('🔍 Attempt query result - error:', attemptError, 'data:', attempt ? 'found' : 'not found');

        if (attemptError || !attempt) {
            console.error('❌ Attempt not found or error:', attemptError);
            return res.status(404).json({ error: "Submitted attempt not found" });
        }

        // Get max_marks from the speaking material directly
        let maxMarks = 0;
        if (attempt.speaking_material_id) {
            console.log('🔍 Fetching max_marks from speaking_materials...');
            const { data: material, error: materialError } = await supabase
                .from('speaking_materials')
                .select('max_marks')
                .eq('id', attempt.speaking_material_id)
                .single();
            
            if (materialError) {
                console.warn('⚠️ Could not fetch max_marks:', materialError);
            } else {
                maxMarks = material?.max_marks || 0;
            }
        }
        
        console.log('📊 Max marks:', maxMarks);

        // Validate marks against max_marks
        if (marks !== undefined && marks !== null) {
            const marksNum = parseInt(marks);
            if (marksNum > maxMarks) {
                return res.status(400).json({ 
                    error: `Marks (${marksNum}) cannot exceed maximum marks (${maxMarks}) for this speaking material` 
                });
            }
        }

        let audioUrl = null;

        // If audio file is provided, upload it
        if (audioFile) {
            try {
                // Generate unique filename
                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 15);
                const fileExt = audioFile.mimetype === 'audio/webm' || audioFile.mimetype === 'audio/ogg' ? '.webm' : 
                               audioFile.mimetype === 'audio/mpeg' || audioFile.mimetype === 'audio/mp3' ? '.mp3' : 
                               audioFile.mimetype === 'audio/wav' ? '.wav' : '.webm';
                const fileName = `feedback_${attempt_id}_${timestamp}_${randomString}${fileExt}`;
                const filePath = `speaking_feedback/${attempt_id}/${fileName}`;

                // Determine content type (use audio/mpeg for compatibility)
                let contentType = 'audio/mpeg';
                if (audioFile.mimetype === 'audio/wav' || audioFile.mimetype === 'audio/wave') {
                    contentType = 'audio/wav';
                } else if (audioFile.mimetype === 'audio/mpeg' || audioFile.mimetype === 'audio/mp3') {
                    contentType = 'audio/mpeg';
                }

                // Upload to Supabase storage
                const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
                    .from('lsrw')
                    .upload(filePath, audioFile.buffer, {
                        contentType: contentType,
                        upsert: false
                    });

                if (uploadError) {
                    console.error('Audio feedback upload error:', uploadError);
                    return res.status(500).json({ error: `Failed to upload audio feedback: ${uploadError.message}` });
                }

                // Get public URL
                const { data: urlData } = supabaseAdmin.storage
                    .from('lsrw')
                    .getPublicUrl(filePath);

                audioUrl = urlData.publicUrl;
            } catch (uploadErr) {
                console.error('Error uploading audio feedback:', uploadErr);
                return res.status(500).json({ error: `Failed to upload audio feedback: ${uploadErr.message}` });
            }
        }

        // Check if feedback already exists
        const { data: existingFeedback } = await supabase
            .from('speaking_feedback')
            .select('id, audio_url')
            .eq('attempt_id', attempt_id)
            .single();

        let feedback;
        const feedbackData = {
            remarks: remarks || null,
            marks: marks !== undefined && marks !== null ? parseInt(marks) : null,
            updated_at: new Date().toISOString()
        };

        // If audio is provided, add it to feedback data
        if (audioUrl) {
            feedbackData.audio_url = audioUrl;
        }

        // If updating and audio is provided, delete old audio if it exists
        if (existingFeedback && audioUrl && existingFeedback.audio_url) {
            // Extract file path from old URL and delete it
            try {
                const oldUrl = existingFeedback.audio_url;
                const urlParts = oldUrl.split('/');
                const filePath = urlParts.slice(urlParts.indexOf('speaking_feedback')).join('/');
                await supabaseAdmin.storage
                    .from('lsrw')
                    .remove([filePath]);
            } catch (deleteErr) {
                console.error('Error deleting old audio feedback:', deleteErr);
                // Continue even if deletion fails
            }
        }

        if (existingFeedback) {
            // Update existing feedback
            const { data, error } = await supabase
                .from('speaking_feedback')
                .update(feedbackData)
                .eq('id', existingFeedback.id)
                .select()
                .single();

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            feedback = data;
        } else {
            // Create new feedback
            const { data, error } = await supabase
                .from('speaking_feedback')
                .insert([{
                    attempt_id,
                    teacher_id: teacherId,
                    remarks: remarks || null,
                    marks: marks !== undefined && marks !== null ? parseInt(marks) : null,
                    audio_url: audioUrl
                }])
                .select()
                .single();

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            feedback = data;
        }

        console.log('✅ Feedback saved successfully:', feedback?.id);
        res.json({
            success: true,
            message: "Feedback saved successfully",
            data: feedback
        });
        console.log('📤 Response sent to client');

    } catch (error) {
        console.error('❌ Error adding speaking feedback:', error);
        console.error('❌ Error stack:', error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || "Internal server error" });
        } else {
            console.error('⚠️ Response already sent, cannot send error response');
        }
    }
};

// =====================================================
// READING MODULE FUNCTIONS
// =====================================================

/**
 * Upload Reading Material (Academic Admin)
 * POST /api/reading/upload
 * - Accepts text file (DOCX/TXT) OR direct text input
 * - Extracts text content and stores in reading_materials table
 * - Stores original file in Supabase storage (not shown to teacher/student)
 * - Admin enters 5 MCQs manually
 * - Auto-maps to all batches under that course
 */
exports.uploadReadingMaterial = async (req, res) => {
    try {
        const course_id = req.body.course_id;
        const title = req.body.title;
        const instruction = req.body.instruction;
        const max_marks = req.body.max_marks ? parseInt(req.body.max_marks) : 0; // Max marks for reading
        const content_text = req.body.content_text; // Direct text input
        // Parse questions JSON if it's a string
        let questions = req.body.questions;
        if (typeof questions === 'string') {
            try {
                questions = JSON.parse(questions);
            } catch (e) {
                return res.status(400).json({ error: "Invalid questions format. Must be a valid JSON array." });
            }
        }
        const readingFile = req.files?.readingFile?.[0]; // Optional file upload

        console.log('📤 Reading Material Upload Request:', {
            course_id,
            title,
            max_marks,
            hasFile: !!readingFile,
            hasDirectText: !!content_text,
            questionsCount: questions ? (Array.isArray(questions) ? questions.length : 0) : 0
        });

        // Validation
        if (!course_id || !title) {
            return res.status(400).json({ error: "Course ID and title are required" });
        }

        // Must have either file or direct text
        if (!readingFile && !content_text) {
            return res.status(400).json({ error: "Either a text file or direct text content is required" });
        }

        // Validate questions format if provided (optional, but if provided must be valid)
        if (questions) {
            if (!Array.isArray(questions)) {
                return res.status(400).json({ error: "Questions must be an array" });
            }
            
            // Validate each question has required fields (if questions are provided)
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                if (!q.question || !q.optionA || !q.optionB || !q.optionC || !q.optionD || !q.correct_answer) {
                    return res.status(400).json({ 
                        error: `Question ${i + 1} is missing required fields. Each question must have: question, optionA, optionB, optionC, optionD, correct_answer` 
                    });
                }
                if (!['A', 'B', 'C', 'D'].includes(q.correct_answer.toUpperCase())) {
                    return res.status(400).json({ 
                        error: `Question ${i + 1}: correct_answer must be A, B, C, or D` 
                    });
                }
            }
            
            // No limit on number of questions - all questions will be accepted
        }
        
        // If no questions provided, use empty array
        const finalQuestions = questions && questions.length > 0 ? questions : [];

        // Get course details
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('id, language, course_name')
            .eq('id', course_id)
            .single();

        if (courseError || !course) {
            return res.status(404).json({ 
                error: "Course not found",
                details: courseError?.message || "Course does not exist in database"
            });
        }

        let extractedText = content_text || '';
        let fileUrl = null;

        // If file is uploaded, extract text from it and store file
        if (readingFile) {
            // Validate file type (DOCX, TXT only - PDF not supported yet)
            if (!isValidTextFile(readingFile.mimetype, readingFile.originalname)) {
                if (readingFile.mimetype === 'application/pdf' || readingFile.originalname.toLowerCase().endsWith('.pdf')) {
                    return res.status(400).json({ 
                        error: "PDF files are not currently supported",
                        hint: "Please convert your PDF to DOCX or TXT format, or enter the text content directly in the text input field"
                    });
                }
                return res.status(400).json({ 
                    error: "Invalid file type. Only DOCX, DOC, or TXT files are allowed" 
                });
            }

            // Extract text from file
            try {
              extractedText = await extractTextFromFile(
                readingFile.buffer,
                readingFile.mimetype,
                readingFile.originalname
              );

              if (!extractedText || extractedText.trim().length === 0) {
                return res.status(400).json({
                  error: "File appears to be empty or could not extract text",
                  hint: "Please ensure the file contains readable text content",
                });
              }

              // Store original file in Supabase storage
              // Path format: lsrw/<course_name>/<course_unique_id>/reading/<filename>
              const language = (course.language || "general")
                .toLowerCase()
                .replace(/\s+/g, "_");
              const courseCode = (course.course_name || "course")
                .toLowerCase()
                .replace(/\s+/g, "_")
                .replace(/[^a-z0-9_]/g, "");
              const timestamp = Date.now();
              const fileExt = path.extname(readingFile.originalname);
              const fileName = `${title
                .toLowerCase()
                .replace(/\s+/g, "_")}_${timestamp}${fileExt}`;
              // Using format: lsrw/<language>/<course_code>/reading/<filename>
              const filePath = `${language}/${courseCode}/reading/${fileName}`;

              const { data: fileUpload, error: uploadError } =
                await supabaseAdmin.storage
                  .from("lsrw")
                  .upload(filePath, readingFile.buffer, {
                    contentType: readingFile.mimetype,
                    upsert: false,
                  });

              if (!uploadError) {
                const { data: urlData } = supabaseAdmin.storage
                  .from("lsrw")
                  .getPublicUrl(filePath);
                fileUrl = urlData.publicUrl;
              } else {
                console.error("File upload error (non-critical):", uploadError);
                // Continue without file URL - text extraction succeeded
              }
            } catch (extractError) {
                console.error('Error extracting text:', extractError);
                
                if (extractError.code === 'PDF_NOT_SUPPORTED') {
                    return res.status(400).json({ 
                        error: "PDF files are not currently supported",
                        details: extractError.message,
                        hint: "Please convert your PDF to DOCX or TXT format, or enter the text content directly in the text input field"
                    });
                }
                
                return res.status(400).json({ 
                    error: "Failed to extract text from file",
                    details: extractError.message
                });
            }
        }

        // Normalize correct_answer to uppercase (if questions provided)
        const normalizedQuestions = finalQuestions.map(q => ({
            question: q.question,
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            correct_answer: q.correct_answer.toUpperCase()
        }));

        // Calculate session_number for reading module (auto-assign based on existing count)
        let sessionNumber = 1;
        const { data: existingSessions, error: countError } = await supabase
            .from('reading_materials')
            .select('session_number')
            .eq('course_id', course_id)
            .not('session_number', 'is', null);

        if (!countError && existingSessions && existingSessions.length > 0) {
            // Get the maximum session_number for this course's reading materials
            const maxSessionNumber = Math.max(...existingSessions.map(s => s.session_number || 0));
            sessionNumber = maxSessionNumber + 1;
        }

        // Insert into reading_materials table
        const { data: readingMaterial, error: insertError } = await supabase
            .from('reading_materials')
            .insert([{
                course_id,
                title,
                instruction: instruction || null,
                max_marks: max_marks || 0,
                file_url: fileUrl,
                content_text: extractedText,
                questions: normalizedQuestions.length > 0 ? normalizedQuestions : [], // Empty array if no questions
                session_number: sessionNumber,
                created_by: req.user?.id
            }])
            .select()
            .single();

        if (insertError) {
            console.error('Error inserting reading material:', insertError);
            return res.status(500).json({ error: insertError.message || "Failed to save reading material" });
        }

        // Auto-mapping to batches is handled by trigger
        console.log('✅ Reading material uploaded successfully:', readingMaterial.id);

        res.status(201).json({
            success: true,
            message: "Reading material uploaded successfully",
            data: readingMaterial
        });

    } catch (error) {
        console.error('Error uploading reading material:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Reading Materials by Course (Academic Admin)
 * GET /api/reading/byCourse/:course_id
 */
exports.getReadingByCourse = async (req, res) => {
    try {
        const { course_id } = req.params;

        const { data, error } = await supabase
            .from('reading_materials')
            .select('*')
            .eq('course_id', course_id)
            .order('session_number', { ascending: true });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching reading materials:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Reading Materials by Batch (Teacher View)
 * GET /api/reading/batch/:batch_id
 */
exports.getReadingByBatch = async (req, res) => {
    try {
        const { batch_id } = req.params;

        // Get batch details
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Get reading materials mapped to this batch
        const { data: mappings, error: mappingError } = await supabase
            .from('reading_batch_map')
            .select('*')
            .eq('batch_id', batch_id)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get material details
        const materialIds = mappings.map(m => m.reading_material_id);
        if (materialIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { data: materials, error: materialError } = await supabase
            .from('reading_materials')
            .select('id, title, instruction, content_text, questions, max_marks, session_number, created_at')
            .in('id', materialIds)
            .eq('course_id', batch.course_id);

        if (materialError) {
            return res.status(500).json({ error: materialError.message });
        }

        // Merge mappings with materials (exclude file_url - teacher should not see it)
        const mergedData = mappings.map(mapping => {
            const material = materials.find(m => m.id === mapping.reading_material_id);
            return {
                ...mapping,
                reading_material: material || null
            };
        }).filter(item => item.reading_material !== null);

        // Sort by session_number (ascending)
        const data = mergedData.sort((a, b) => {
            const sessionA = a.reading_material?.session_number || 999999;
            const sessionB = b.reading_material?.session_number || 999999;
            return sessionA - sessionB;
        });

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching reading materials:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Mark Reading Material as Completed (Teacher)
 * PUT /api/reading/complete/:mapping_id
 */
exports.markReadingComplete = async (req, res) => {
    try {
        const { mapping_id } = req.params;
        const teacherId = req.user?.id;

        if (!teacherId) {
            return res.status(401).json({ error: "Teacher authentication required" });
        }

        const { data, error } = await supabase
            .from('reading_batch_map')
            .update({
                tutor_status: 'completed',
                student_visible: true,
                completed_at: new Date().toISOString(),
                completed_by: teacherId
            })
            .eq('id', mapping_id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!data) {
            return res.status(404).json({ error: "Mapping not found" });
        }

        res.json({
            success: true,
            message: "Reading material marked as completed",
            data
        });

    } catch (error) {
        console.error('Error marking reading material complete:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Student Reading Materials (Student View)
 * GET /api/reading/student/:batch_id
 */
exports.getStudentReading = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const studentId = req.user?.id || req.query.student_id;

        // Get batch details
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Get reading materials visible to students
        const { data: mappings, error: mappingError } = await supabase
            .from('reading_batch_map')
            .select('*')
            .eq('batch_id', batch_id)
            .eq('student_visible', true)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get material details (exclude file_url - student should not see it)
        const materialIds = mappings.map(m => m.reading_material_id);
        if (materialIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { data: materials, error: materialError } = await supabase
            .from('reading_materials')
            .select('id, title, instruction, content_text, questions, max_marks, session_number, created_at')
            .in('id', materialIds)
            .eq('course_id', batch.course_id);

        if (materialError) {
            return res.status(500).json({ error: materialError.message });
        }

        // Merge mappings with materials
        const mergedData = mappings.map(mapping => {
            const material = materials.find(m => m.id === mapping.reading_material_id);
            return {
                ...mapping,
                reading_material: material || null
            };
        }).filter(item => item.reading_material !== null);

        // Sort by session_number (ascending)
        const data = mergedData.sort((a, b) => {
            const sessionA = a.reading_material?.session_number || 999999;
            const sessionB = b.reading_material?.session_number || 999999;
            return sessionA - sessionB;
        });

        // Get student's attempts if student_id provided
        if (studentId) {
            const materialIds = data.map(m => m.reading_material_id);
            const { data: attempts } = await supabase
                .from('reading_attempts')
                .select('*')
                .eq('student_id', studentId)
                .in('reading_material_id', materialIds)
                .order('created_at', { ascending: false });

            // Get feedback for attempts
            const attemptIds = attempts?.map(a => a.id) || [];
            let feedbackMap = new Map();
            if (attemptIds.length > 0) {
                const { data: feedbacks } = await supabase
                    .from('reading_feedback')
                    .select('*')
                    .in('attempt_id', attemptIds);
                
                feedbacks?.forEach(feedback => {
                    feedbackMap.set(feedback.attempt_id, feedback);
                });
            }

            // Group attempts by material_id (prefer submitted over draft)
            const attemptsMap = new Map();
            attempts?.forEach(attempt => {
                const key = attempt.reading_material_id;
                const existing = attemptsMap.get(key);
                if (!existing || attempt.submitted_at) {
                    attemptsMap.set(key, {
                        ...attempt,
                        feedback: feedbackMap.get(attempt.id) || null
                    });
                }
            });

            // Add attempt info to each material
            data.forEach(material => {
                const attempt = attemptsMap.get(material.reading_material_id);
                material.attempt = attempt || null;
                material.attempted = !!attempt;
                material.submitted = !!attempt?.submitted_at;
            });
        } else {
            data.forEach(material => {
                material.attempt = null;
                material.attempted = false;
                material.submitted = false;
            });
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching student reading materials:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Submit Student Reading Quiz (Student)
 * POST /api/reading/attempt
 */
exports.submitReadingAttempt = async (req, res) => {
    try {
        console.log('📥 submitReadingAttempt called - body:', req.body);
        const { reading_material_id, batch_id, answers } = req.body;
        const studentId = req.user?.id || req.student?.student_id;

        console.log('📋 Parsed values - reading_material_id:', reading_material_id, 'batch_id:', batch_id, 'studentId:', studentId, 'answers count:', answers ? Object.keys(answers).length : 0);

        if (!studentId) {
            return res.status(401).json({ error: "Student authentication required" });
        }

        if (!reading_material_id || !batch_id || !answers) {
            return res.status(400).json({ error: "reading_material_id, batch_id, and answers are required" });
        }

        // Validate answers format
        if (typeof answers !== 'object') {
            return res.status(400).json({ error: "Answers must be an object" });
        }

        // Get reading material to validate questions and calculate score
        const { data: material, error: materialError } = await supabase
            .from('reading_materials')
            .select('questions, max_marks')
            .eq('id', reading_material_id)
            .single();

        if (materialError || !material) {
            return res.status(404).json({ error: "Reading material not found" });
        }

        const questions = material.questions || [];
        if (!Array.isArray(questions)) {
            return res.status(400).json({ error: "Invalid reading material: questions must be an array" });
        }
        
        if (questions.length === 0) {
            return res.status(400).json({ error: "This reading material has no questions" });
        }
        
        // Validate that answers match the number of questions
        const answerKeys = Object.keys(answers);
        if (answerKeys.length !== questions.length) {
            return res.status(400).json({ error: `Answers must contain responses for all ${questions.length} question(s)` });
        }

        // Calculate score (number of correct answers)
        let correctCount = 0;
        questions.forEach((q, index) => {
            const questionKey = `question${index + 1}`;
            const studentAnswer = answers[questionKey]?.toUpperCase();
            const correctAnswer = q.correct_answer?.toUpperCase();
            if (studentAnswer === correctAnswer) {
                correctCount++;
            }
        });

        // Calculate marks based on max_marks (like listening module)
        const maxMarks = material.max_marks || questions.length;
        const calculatedMarks = maxMarks > 0 ? Math.round((correctCount / questions.length) * maxMarks) : correctCount;
        
        // Use calculated marks as score, and max_marks as max_score
        // Ensure values are integers and not null/undefined
        const score = Math.max(0, Math.round(calculatedMarks) || 0);
        const maxScore = Math.max(1, Math.round(maxMarks) || questions.length);
        
        console.log('📊 Reading Quiz Marks Calculation:', {
            correctCount,
            totalQuestions: questions.length,
            maxMarks,
            calculatedMarks: score,
            maxScore
        });

        // Check if attempt already exists
        const { data: existingAttempt, error: existingError } = await supabase
            .from('reading_attempts')
            .select('id, submitted_at, score, max_score')
            .eq('reading_material_id', reading_material_id)
            .eq('student_id', studentId)
            .single();
        
        if (existingError && existingError.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('❌ Error checking existing attempt:', existingError);
        }
        
        if (existingAttempt) {
            console.log('🔍 Existing attempt found:', {
                id: existingAttempt.id,
                current_score: existingAttempt.score,
                current_max_score: existingAttempt.max_score,
                submitted_at: existingAttempt.submitted_at
            });
        }

        if (existingAttempt && existingAttempt.submitted_at) {
            return res.status(400).json({ error: "You have already submitted this reading quiz. Only one attempt is allowed." });
        }

        // Insert or update attempt
        let attempt;
        if (existingAttempt) {
            // Update existing attempt with auto-calculated marks
            console.log('💾 Updating reading attempt with calculated marks:', { 
                attempt_id: existingAttempt.id,
                score, 
                max_score: maxScore 
            });
            const { data, error } = await supabase
                .from('reading_attempts')
                .update({
                    answers,
                    score: parseInt(score) || 0, // Ensure it's an integer
                    max_score: parseInt(maxScore) || questions.length, // Ensure it's an integer
                    submitted_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingAttempt.id)
                .select()
                .single();

            if (error) {
                console.error('❌ Error updating reading attempt:', error);
                return res.status(500).json({ error: error.message });
            }
            console.log('✅ Successfully updated reading attempt with marks:', { 
                attempt_id: data?.id, 
                score: data?.score, 
                max_score: data?.max_score 
            });
            attempt = data;
        } else {
            // Create new attempt with auto-calculated marks
            console.log('💾 Inserting reading attempt with calculated marks:', { 
                score, 
                max_score: maxScore,
                reading_material_id,
                student_id: studentId,
                batch_id
            });
            const { data, error } = await supabase
                .from('reading_attempts')
                .insert([{
                    reading_material_id,
                    student_id: studentId,
                    batch_id,
                    answers,
                    score: parseInt(score) || 0, // Ensure it's an integer
                    max_score: parseInt(maxScore) || questions.length, // Ensure it's an integer
                    submitted_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) {
                console.error('❌ Error inserting reading attempt:', error);
                console.error('❌ Error details:', JSON.stringify(error, null, 2));
                return res.status(500).json({ error: error.message || "Failed to save reading attempt" });
            }
            console.log('✅ Successfully inserted reading attempt with marks:', { 
                attempt_id: data?.id, 
                score: data?.score, 
                max_score: data?.max_score 
            });
            attempt = data;
        }

        // Verify marks were stored correctly by re-fetching from database
        if (attempt && attempt.id) {
            console.log('✅ Reading attempt saved successfully:', {
                attempt_id: attempt.id,
                stored_score: attempt.score,
                stored_max_score: attempt.max_score,
                expected_score: score,
                expected_max_score: maxScore
            });
            
            // Double-check that marks match what we calculated
            if (attempt.score !== score || attempt.max_score !== maxScore) {
                console.warn('⚠️ Warning: Stored marks do not match calculated marks!', {
                    calculated: { score, maxScore },
                    stored: { score: attempt.score, max_score: attempt.max_score }
                });
            }
            
            // Verify by re-fetching from database to ensure persistence
            const { data: verifyAttempt, error: verifyError } = await supabase
                .from('reading_attempts')
                .select('id, score, max_score')
                .eq('id', attempt.id)
                .single();
            
            if (verifyError) {
                console.error('❌ Error verifying stored marks:', verifyError);
            } else if (verifyAttempt) {
                console.log('✅ Verified marks in database:', {
                    attempt_id: verifyAttempt.id,
                    score: verifyAttempt.score,
                    max_score: verifyAttempt.max_score
                });
                
                if (verifyAttempt.score !== score || verifyAttempt.max_score !== maxScore) {
                    console.error('❌ CRITICAL: Marks not persisted correctly!', {
                        expected: { score, maxScore },
                        in_database: { score: verifyAttempt.score, max_score: verifyAttempt.max_score }
                    });
                }
            }
        }

        res.status(201).json({
            success: true,
            message: "Reading quiz submitted successfully",
            data: attempt
        });

    } catch (error) {
        console.error('Error submitting reading attempt:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Student Reading Attempts for Teacher Review
 * GET /api/reading/batch/:batch_id/submissions
 */
exports.getReadingSubmissions = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const readingMaterialId = req.query.reading_material_id;

        let query = supabase
            .from('reading_attempts')
            .select(`
                id,
                reading_material_id,
                student_id,
                batch_id,
                answers,
                score,
                max_score,
                submitted_at,
                created_at,
                updated_at,
                verified,
                verified_at,
                verified_by,
                reading_materials:reading_material_id (
                    id,
                    title,
                    instruction,
                    content_text,
                    questions,
                    max_marks
                ),
                students:student_id (
                    student_id,
                    name,
                    email,
                    registration_number
                )
            `)
            .eq('batch_id', batch_id)
            .not('submitted_at', 'is', null)
            .order('submitted_at', { ascending: false });

        if (readingMaterialId) {
            query = query.eq('reading_material_id', readingMaterialId);
        }

        const { data: attempts, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Get feedback for each attempt
        const attemptIds = attempts?.map(a => a.id) || [];
        let feedbackMap = new Map();

        if (attemptIds.length > 0) {
            const { data: feedbacks } = await supabase
                .from('reading_feedback')
                .select('*')
                .in('attempt_id', attemptIds);

            feedbacks?.forEach(feedback => {
                feedbackMap.set(feedback.attempt_id, feedback);
            });
        }

        // Add feedback to each attempt, and include verified status
        const data = attempts?.map(attempt => ({
            ...attempt,
            feedback: feedbackMap.get(attempt.id) || null,
            verified: attempt.verified || false,
            verified_at: attempt.verified_at || null,
            verified_by: attempt.verified_by || null
        })) || [];

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching reading submissions:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Add/Update Teacher Feedback for Reading Attempt
 * POST /api/reading/feedback
 * Supports: remarks (text) and audio feedback
 * Note: Marks are auto-calculated from quiz submission, so marks parameter is optional/ignored
 */
exports.addReadingFeedback = async (req, res) => {
    try {
        console.log('📥 addReadingFeedback called - body:', req.body, 'files:', req.files);
        
        // For multipart requests, body fields come from FormData
        // For JSON requests, body fields come from JSON
        const attempt_id = req.body?.attempt_id;
        const remarks = req.body?.remarks;
        const marks = req.body?.marks;
        const audioFile = req.files?.audioFeedback?.[0]; // Optional audio feedback file
        const teacherId = req.user?.id;

        console.log('📋 Parsed values - attempt_id:', attempt_id, 'remarks:', remarks, 'marks:', marks, 'audioFile:', !!audioFile);

        if (!teacherId) {
            return res.status(401).json({ error: "Teacher authentication required" });
        }

        if (!attempt_id) {
            return res.status(400).json({ error: "attempt_id is required" });
        }

        // At least one of remarks or audioFile must be provided (marks are auto-calculated from quiz)
        if (!remarks?.trim() && !audioFile) {
            return res.status(400).json({ error: "Either remarks or audio feedback must be provided" });
        }

        // Validate marks if provided
        if (marks !== undefined && marks !== null && marks !== '') {
            const marksNum = parseInt(marks);
            if (isNaN(marksNum) || marksNum < 0) {
                return res.status(400).json({ error: "Marks must be a non-negative number" });
            }
        }

        // Verify attempt exists and is submitted, and get max_marks from reading material
        console.log('🔍 Fetching attempt from database...');
        const { data: attempt, error: attemptError } = await supabase
            .from('reading_attempts')
            .select(`
                id,
                reading_material_id
            `)
            .not('submitted_at', 'is', null)
            .eq('id', attempt_id)
            .single();

        console.log('🔍 Attempt query result - error:', attemptError, 'data:', attempt ? 'found' : 'not found');

        if (attemptError || !attempt) {
            console.error('❌ Attempt not found or error:', attemptError);
            return res.status(404).json({ error: "Submitted attempt not found" });
        }

        // Get max_marks from the reading material directly
        let maxMarks = 0;
        if (attempt.reading_material_id) {
            console.log('🔍 Fetching max_marks from reading_materials...');
            const { data: material, error: materialError } = await supabase
                .from('reading_materials')
                .select('max_marks')
                .eq('id', attempt.reading_material_id)
                .single();
            
            if (materialError) {
                console.warn('⚠️ Could not fetch max_marks:', materialError);
            } else {
                maxMarks = material?.max_marks || 0;
            }
        }
        
        console.log('📊 Max marks:', maxMarks);

        // Validate marks against max_marks
        if (marks !== undefined && marks !== null && marks !== '') {
            const marksNum = parseInt(marks);
            if (maxMarks > 0 && marksNum > maxMarks) {
                return res.status(400).json({ 
                    error: `Marks (${marksNum}) cannot exceed maximum marks (${maxMarks}) for this reading material` 
                });
            }
        }

        let audioUrl = null;

        // If audio file is provided, upload it
        if (audioFile) {
            try {
                // Generate unique filename
                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 15);
                const fileExt = audioFile.mimetype === 'audio/webm' || audioFile.mimetype === 'audio/ogg' ? '.webm' : 
                               audioFile.mimetype === 'audio/mpeg' || audioFile.mimetype === 'audio/mp3' ? '.mp3' : 
                               audioFile.mimetype === 'audio/wav' ? '.wav' : '.webm';
                const fileName = `feedback_${attempt_id}_${timestamp}_${randomString}${fileExt}`;
                const filePath = `reading_feedback/${attempt_id}/${fileName}`;

                // Determine content type (use audio/mpeg for compatibility)
                let contentType = 'audio/mpeg';
                if (audioFile.mimetype === 'audio/wav' || audioFile.mimetype === 'audio/wave') {
                    contentType = 'audio/wav';
                } else if (audioFile.mimetype === 'audio/mpeg' || audioFile.mimetype === 'audio/mp3') {
                    contentType = 'audio/mpeg';
                }

                // Upload to Supabase storage
                const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
                    .from('lsrw')
                    .upload(filePath, audioFile.buffer, {
                        contentType: contentType,
                        upsert: false
                    });

                if (uploadError) {
                    console.error('Audio feedback upload error:', uploadError);
                    return res.status(500).json({ error: `Failed to upload audio feedback: ${uploadError.message}` });
                }

                // Get public URL
                const { data: urlData } = supabaseAdmin.storage
                    .from('lsrw')
                    .getPublicUrl(filePath);

                audioUrl = urlData.publicUrl;
            } catch (uploadErr) {
                console.error('Error uploading audio feedback:', uploadErr);
                return res.status(500).json({ error: `Failed to upload audio feedback: ${uploadErr.message}` });
            }
        }

        // Check if feedback already exists
        const { data: existingFeedback } = await supabase
            .from('reading_feedback')
            .select('id, audio_url')
            .eq('attempt_id', attempt_id)
            .single();

        let feedback;
        const feedbackData = {
            remarks: remarks || null,
            marks: marks !== undefined && marks !== null && marks !== '' ? parseInt(marks) : null,
            updated_at: new Date().toISOString()
        };

        // If audio is provided, add it to feedback data
        if (audioUrl) {
            feedbackData.audio_url = audioUrl;
        }

        // If updating and audio is provided, delete old audio if it exists
        if (existingFeedback && audioUrl && existingFeedback.audio_url) {
            // Extract file path from old URL and delete it
            try {
                const oldUrl = existingFeedback.audio_url;
                const urlParts = oldUrl.split('/');
                const filePath = urlParts.slice(urlParts.indexOf('reading_feedback')).join('/');
                await supabaseAdmin.storage
                    .from('lsrw')
                    .remove([filePath]);
            } catch (deleteErr) {
                console.error('Error deleting old audio feedback:', deleteErr);
                // Continue even if deletion fails
            }
        }

        if (existingFeedback) {
            // Update existing feedback
            const { data, error } = await supabase
                .from('reading_feedback')
                .update(feedbackData)
                .eq('id', existingFeedback.id)
                .select()
                .single();

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            feedback = data;
        } else {
            // Create new feedback
            const { data, error } = await supabase
                .from('reading_feedback')
                .insert([{
                    attempt_id,
                    teacher_id: teacherId,
                    remarks: remarks || null,
                    marks: marks !== undefined && marks !== null && marks !== '' ? parseInt(marks) : null,
                    audio_url: audioUrl
                }])
                .select()
                .single();

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            feedback = data;
        }

        // Automatically verify the attempt when feedback is provided (teacher has reviewed)
        // This ensures the verified status is set when feedback is added
        const { error: verifyError } = await supabase
            .from('reading_attempts')
            .update({
                verified: true,
                verified_by: teacherId,
                verified_at: new Date().toISOString()
            })
            .eq('id', attempt_id);

        if (verifyError) {
            console.warn('⚠️ Warning: Could not update verified status:', verifyError);
            // Continue anyway - feedback was saved successfully
        } else {
            console.log('✅ Automatically verified reading attempt when feedback was added');
        }

        res.json({
            success: true,
            message: "Feedback saved successfully",
            data: feedback
        });

    } catch (error) {
        console.error('Error adding reading feedback:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Verify Reading Attempt and Release Marks
 * PUT /api/reading/verify/:attempt_id
 */
exports.verifyReadingAttempt = async (req, res) => {
    try {
        const { attempt_id } = req.params;
        const userId = req.user?.id || null;
        let validUserId = null;

        if (userId) {
            // Verify user exists in public.users table
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // Get attempt to verify it exists and is submitted
        const { data: attempt, error: attemptError } = await supabase
            .from('reading_attempts')
            .select('id, batch_id, submitted_at')
            .eq('id', attempt_id)
            .not('submitted_at', 'is', null)
            .single();

        if (attemptError || !attempt) {
            return res.status(404).json({ error: "Submitted reading attempt not found" });
        }

        // Update verification status
        const { data, error } = await supabase
            .from('reading_attempts')
            .update({
                verified: true,
                verified_by: validUserId,
                verified_at: new Date().toISOString()
            })
            .eq('id', attempt_id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            success: true,
            message: "Reading attempt verified and marks released to student",
            data
        });

    } catch (error) {
        console.error('Error verifying reading attempt:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

// =====================================================
// WRITING MODULE FUNCTIONS
// =====================================================

/**
 * Upload Writing Task (Academic Admin)
 * POST /api/writing/upload
 * - Accepts image (JPEG/PNG), document (PDF/DOCX), OR direct text input
 * - Stores in writing_tasks table
 * - Auto-maps to all batches with same course_id
 */
exports.uploadWritingTask = async (req, res) => {
    try {
        const course_id = req.body.course_id;
        const title = req.body.title;
        const instruction = req.body.instruction;
        const max_marks = req.body.max_marks ? parseInt(req.body.max_marks) : 0; // Max marks for writing task
        const content_text = req.body.content_text; // Direct text input
        const writingImage = req.files?.writingImage?.[0]; // Optional image upload
        const writingDocument = req.files?.writingDocument?.[0]; // Optional document upload

        console.log('📤 Writing Task Upload Request:', {
            course_id,
            title,
            hasImage: !!writingImage,
            hasDocument: !!writingDocument,
            hasDirectText: !!content_text
        });

        // Validation
        if (!course_id || !title) {
            return res.status(400).json({ error: "Course ID and title are required" });
        }

        // Must have exactly one content type
        const contentTypes = [!!writingImage, !!writingDocument, !!content_text].filter(Boolean);
        if (contentTypes.length !== 1) {
            return res.status(400).json({ error: "Exactly one content type is required: image, document, or text" });
        }

        // Get course details
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('id, language, course_name')
            .eq('id', course_id)
            .single();

        if (courseError || !course) {
            return res.status(404).json({ 
                error: "Course not found",
                details: courseError?.message || "Course does not exist in database"
            });
        }

        let contentType = 'text';
        let fileUrl = null;
        let fileType = null;

        // Handle image upload
        if (writingImage) {
            contentType = 'image';
            fileType = writingImage.mimetype;
            
            // Upload to Supabase storage
            const language = (course.language || 'general').toLowerCase().replace(/\s+/g, '_');
            const courseCode = (course.course_name || 'course').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const timestamp = Date.now();
            const fileExt = path.extname(writingImage.originalname);
            const fileName = `${title.toLowerCase().replace(/\s+/g, '_')}_${timestamp}${fileExt}`;
            const filePath = `${language}/${courseCode}/writing/tasks/${fileName}`;

            const { data: fileUpload, error: uploadError } = await supabaseAdmin.storage
                .from('lsrw')
                .upload(filePath, writingImage.buffer, {
                    contentType: writingImage.mimetype,
                    upsert: false
                });

            if (uploadError) {
                return res.status(500).json({ error: `Failed to upload image: ${uploadError.message}` });
            }

            const { data: urlData } = supabaseAdmin.storage
                .from('lsrw')
                .getPublicUrl(filePath);
            fileUrl = urlData.publicUrl;
        }
        // Handle document upload
        else if (writingDocument) {
            contentType = 'document';
            fileType = writingDocument.mimetype;
            
            // Upload to Supabase storage
            const language = (course.language || 'general').toLowerCase().replace(/\s+/g, '_');
            const courseCode = (course.course_name || 'course').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            const timestamp = Date.now();
            const fileExt = path.extname(writingDocument.originalname);
            const fileName = `${title.toLowerCase().replace(/\s+/g, '_')}_${timestamp}${fileExt}`;
            const filePath = `${language}/${courseCode}/writing/tasks/${fileName}`;

            const { data: fileUpload, error: uploadError } = await supabaseAdmin.storage
                .from('lsrw')
                .upload(filePath, writingDocument.buffer, {
                    contentType: writingDocument.mimetype,
                    upsert: false
                });

            if (uploadError) {
                return res.status(500).json({ error: `Failed to upload document: ${uploadError.message}` });
            }

            const { data: urlData } = supabaseAdmin.storage
                .from('lsrw')
                .getPublicUrl(filePath);
            fileUrl = urlData.publicUrl;
        }
        // Handle text content
        else if (content_text) {
            contentType = 'text';
            if (!content_text.trim()) {
                return res.status(400).json({ error: "Content text cannot be empty" });
            }
        }

        // Get user ID
        const userId = req.user?.id || null;
        let validUserId = null;

        if (userId) {
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // Calculate session_number for writing module (auto-assign based on existing count)
        let sessionNumber = 1;
        const { data: existingSessions, error: countError } = await supabase
            .from('writing_tasks')
            .select('session_number')
            .eq('course_id', course_id)
            .not('session_number', 'is', null);

        if (!countError && existingSessions && existingSessions.length > 0) {
            // Get the maximum session_number for this course's writing tasks
            const maxSessionNumber = Math.max(...existingSessions.map(s => s.session_number || 0));
            sessionNumber = maxSessionNumber + 1;
        }

        // Insert writing task into database
        const { data: writingTask, error: insertError } = await supabase
            .from('writing_tasks')
            .insert([{
                course_id,
                title,
                instruction: instruction || null,
                max_marks: max_marks || 0,
                content_type: contentType,
                content_text: contentType === 'text' ? content_text.trim() : null,
                file_url: fileUrl,
                file_type: fileType,
                session_number: sessionNumber,
                created_by: validUserId
            }])
            .select()
            .single();

        if (insertError) {
            console.error('Database insert error:', insertError);
            // Clean up uploaded file if exists
            if (fileUrl) {
                const urlParts = fileUrl.split('/lsrw/');
                if (urlParts.length > 1) {
                    const filePath = urlParts[1];
                    await supabaseAdmin.storage.from('lsrw').remove([filePath]);
                }
            }
            return res.status(500).json({ error: `Failed to save writing task: ${insertError.message}` });
        }

        // The trigger will automatically link this task to all batches with the same course_id

        res.status(201).json({
            success: true,
            message: "Writing task uploaded successfully",
            data: writingTask
        });

    } catch (error) {
        console.error('Error uploading writing task:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Delete a writing session (delete entire session with all files)
 * DELETE /api/writing/session/:id
 * This will delete the writing_tasks record and all associated files from storage
 */
exports.deleteWritingSession = async (req, res) => {
    try {
        const { id } = req.params; // writing_tasks id

        if (!id) {
            return res.status(400).json({ error: "Session ID is required" });
        }

        // First, get the session data to find all file paths
        const { data: sessionData, error: fetchError } = await supabase
            .from('writing_tasks')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !sessionData) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Collect all file paths to delete from storage
        const filesToDelete = [];
        
        // Extract file paths from URLs
        const extractPathFromUrl = (url) => {
            if (!url) return null;
            // Supabase storage URLs format: https://[project].supabase.co/storage/v1/object/public/lsrw/[path]
            const match = url.match(/\/storage\/v1\/object\/public\/lsrw\/(.+)$/);
            return match ? match[1] : null;
        };

        // Add file path (image or document)
        if (sessionData.file_url) {
            const filePath = extractPathFromUrl(sessionData.file_url);
            if (filePath) filesToDelete.push(filePath);
        }

        // Delete files from storage
        if (filesToDelete.length > 0) {
            const { error: storageError } = await supabaseAdmin.storage
                .from('lsrw')
                .remove(filesToDelete);

            if (storageError) {
                console.error('Error deleting files from storage:', storageError);
                // Continue with database deletion even if storage deletion fails
                // (files might have been manually deleted or don't exist)
            } else {
                console.log(`✅ Deleted ${filesToDelete.length} file(s) from storage`);
            }
        }

        // Get course_id before deletion for reordering
        const courseId = sessionData.course_id;
        const sessionNumber = sessionData.session_number;

        // Delete the database record
        const { error: deleteError } = await supabase
            .from('writing_tasks')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: `Failed to delete session: ${deleteError.message}` });
        }

        // Reorder remaining sessions (decrease session numbers for sessions after deleted one)
        if (sessionNumber) {
            // Get all sessions after the deleted one
            const { data: sessionsToUpdate, error: fetchError } = await supabase
                .from('writing_tasks')
                .select('id, session_number')
                .eq('course_id', courseId)
                .gt('session_number', sessionNumber)
                .order('session_number', { ascending: true });

            if (sessionsToUpdate && sessionsToUpdate.length > 0) {
                // Update each session number (decrement by 1)
                const updatePromises = sessionsToUpdate.map(session => 
                    supabase
                        .from('writing_tasks')
                        .update({ session_number: session.session_number - 1 })
                        .eq('id', session.id)
                );

                await Promise.all(updatePromises);
                console.log(`✅ Reordered ${sessionsToUpdate.length} session(s) after deletion`);
            }
        }

        res.json({
            success: true,
            message: "Session deleted successfully",
            data: {
                deleted_session_id: id,
                deleted_files_count: filesToDelete.length
            }
        });

    } catch (error) {
        console.error('Error deleting writing session:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Writing Tasks by Course (Academic Admin)
 * GET /api/writing/byCourse/:course_id
 */
exports.getWritingByCourse = async (req, res) => {
    try {
        const { course_id } = req.params;

        const { data, error } = await supabase
            .from('writing_tasks')
            .select('*')
            .eq('course_id', course_id)
            .order('session_number', { ascending: true });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Convert relative file paths to full Supabase URLs
        const supabaseUrl = process.env.SUPABASE_URL;
        const processedData = (data || []).map(item => {
            const processedItem = { ...item };
            
            // Process file_url if it exists and is a relative path
            if (processedItem.file_url && !processedItem.file_url.startsWith('http') && !processedItem.file_url.startsWith('/')) {
                // Clean malformed paths (remove "https:" fragments)
                let filePath = processedItem.file_url;
                if (filePath.includes('https:') && !filePath.startsWith('http')) {
                    filePath = filePath.replace(/https:.*$/, '').replace(/https:$/, '').trim();
                    filePath = filePath.replace(/[:/]+$/, '');
                }
                
                // Convert to full Supabase storage URL
                if (filePath && (filePath.includes('/writing/tasks/') || filePath.includes('/writing/') || filePath.match(/^[^/]+\/[^/]+\/writing\//))) {
                    processedItem.file_url = `${supabaseUrl}/storage/v1/object/public/lsrw/${filePath}`;
                }
            }
            
            return processedItem;
        });

        res.json({
            success: true,
            data: processedData
        });

    } catch (error) {
        console.error('Error fetching writing tasks:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Writing Tasks for a Batch (Teacher)
 * GET /api/writing/batch/:batch_id
 */
exports.getWritingByBatch = async (req, res) => {
    try {
        const { batch_id } = req.params;

        // Get batch details to find course_id
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        const batchCourseId = batch.course_id;

        // Get writing tasks mapped to this batch
        const { data: mappings, error: mappingError } = await supabase
            .from('writing_batch_map')
            .select('*')
            .eq('batch_id', batch_id)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get task details for each mapping
        const taskIds = mappings.map(m => m.writing_task_id);
        if (taskIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { data: tasks, error: taskError } = await supabase
            .from('writing_tasks')
            .select('*')
            .in('id', taskIds)
            .eq('course_id', batchCourseId)
            .order('session_number', { ascending: true });

        if (taskError) {
            return res.status(500).json({ error: taskError.message });
        }

        // Merge mappings with tasks
        const data = mappings.map(mapping => {
            const task = tasks.find(t => t.id === mapping.writing_task_id);
            return {
                ...mapping,
                writing_task: task || null
            };
        }).filter(item => item.writing_task !== null);

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching batch writing tasks:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Mark Writing Task as Read/Completed (Teacher)
 * PUT /api/writing/complete/:mapping_id
 */
exports.markWritingComplete = async (req, res) => {
    try {
        const { mapping_id } = req.params;
        const { status } = req.body; // 'read' or 'completed'
        const userId = req.user?.id || null;
        let validUserId = null;

        if (!status || !['read', 'completed'].includes(status)) {
            return res.status(400).json({ error: "Status must be 'read' or 'completed'" });
        }

        if (userId) {
            const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (userData) {
                validUserId = userId;
            }
        }

        // Update mapping
        const updateData = {
            tutor_status: status,
            updated_at: new Date().toISOString()
        };

        // If marking as completed, make visible to students
        if (status === 'completed') {
            updateData.student_visible = true;
            updateData.completed_at = new Date().toISOString();
            updateData.completed_by = validUserId;
        }

        const { data, error } = await supabase
            .from('writing_batch_map')
            .update(updateData)
            .eq('id', mapping_id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        if (!data) {
            return res.status(404).json({ error: "Mapping not found" });
        }

        res.json({
            success: true,
            message: `Writing task marked as ${status}`,
            data
        });

    } catch (error) {
        console.error('Error marking writing task complete:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Student Writing Tasks (Student View)
 * GET /api/writing/student/:batch_id
 */
exports.getStudentWriting = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const studentId = req.user?.id || req.query.student_id;

        // Get batch details
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Get writing tasks visible to students
        const { data: mappings, error: mappingError } = await supabase
            .from('writing_batch_map')
            .select('*')
            .eq('batch_id', batch_id)
            .eq('student_visible', true)
            .order('created_at', { ascending: false });

        if (mappingError) {
            return res.status(500).json({ error: mappingError.message });
        }

        // Get task details
        const taskIds = mappings.map(m => m.writing_task_id);
        if (taskIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const { data: tasks, error: taskError } = await supabase
            .from('writing_tasks')
            .select('*')
            .in('id', taskIds)
            .eq('course_id', batch.course_id);

        if (taskError) {
            return res.status(500).json({ error: taskError.message });
        }

        // Merge mappings with tasks and sort by session_number
        const data = mappings.map(mapping => {
            const task = tasks.find(t => t.id === mapping.writing_task_id);
            if (!task) return null;
            
            return {
                writing_task_id: task.id,
                title: task.title,
                instruction: task.instruction,
                content_type: task.content_type,
                content_text: task.content_text,
                file_url: task.file_url,
                file_type: task.file_type,
                session_number: task.session_number,
                created_at: task.created_at,
                mapping_id: mapping.id
            };
        }).filter(item => item !== null)
        .sort((a, b) => {
            const aSession = a.session_number || 9999;
            const bSession = b.session_number || 9999;
            return aSession - bSession;
        });

        // Get student's submissions if student_id provided
        if (studentId) {
            const taskIds = data.map(t => t.writing_task_id);
            const { data: submissions } = await supabase
                .from('writing_submissions')
                .select('*')
                .eq('student_id', studentId)
                .in('writing_task_id', taskIds)
                .order('submitted_at', { ascending: false });

            // Get feedback for submissions
            const submissionIds = submissions?.map(s => s.id) || [];
            let feedbackMap = new Map();
            
            if (submissionIds.length > 0) {
                const { data: feedbacks } = await supabase
                    .from('writing_feedback')
                    .select('*')
                    .in('submission_id', submissionIds);
                
                feedbacks?.forEach(feedback => {
                    feedbackMap.set(feedback.submission_id, feedback);
                });
            }

            // Group submissions by task_id
            const submissionsMap = new Map();
            submissions?.forEach(submission => {
                submissionsMap.set(submission.writing_task_id, {
                    ...submission,
                    feedback: feedbackMap.get(submission.id) || null
                });
            });

            // Add submission info to each task
            data.forEach(task => {
                const submission = submissionsMap.get(task.writing_task_id);
                task.submission = submission || null;
                task.submitted = !!submission;
            });
        } else {
            data.forEach(task => {
                task.submission = null;
                task.submitted = false;
            });
        }

        res.json({
            success: true,
            data: data || []
        });

    } catch (error) {
        console.error('Error fetching student writing tasks:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Get Student Writing Submissions for Review (Teacher)
 * GET /api/writing/batch/:batch_id/submissions
 */
exports.getWritingSubmissions = async (req, res) => {
    try {
        const { batch_id } = req.params;
        const { writing_task_id } = req.query;

        // Get all submissions for this batch
        let query = supabase
            .from('writing_submissions')
            .select(`
                *,
                writing_tasks:writing_task_id (
                    id,
                    title,
                    instruction,
                    content_type,
                    content_text,
                    file_url,
                    file_type,
                    max_marks
                ),
                students:student_id (
                    student_id,
                    name,
                    email,
                    registration_number
                )
            `)
            .eq('batch_id', batch_id)
            .order('submitted_at', { ascending: false });

        if (writing_task_id) {
            query = query.eq('writing_task_id', writing_task_id);
        }

        const { data: submissions, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Get feedback for each submission
        const submissionIds = submissions?.map(s => s.id) || [];
        let feedbackMap = new Map();

        if (submissionIds.length > 0) {
            const { data: feedbacks } = await supabase
                .from('writing_feedback')
                .select('*')
                .in('submission_id', submissionIds);

            feedbacks?.forEach(feedback => {
                feedbackMap.set(feedback.submission_id, feedback);
            });
        }

        // Add feedback to each submission
        const data = submissions?.map(submission => ({
            ...submission,
            feedback: feedbackMap.get(submission.id) || null
        })) || [];

        res.json({
            success: true,
            data
        });

    } catch (error) {
        console.error('Error fetching writing submissions:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Add/Update Teacher Feedback for Writing Submission
 * POST /api/writing/feedback
 */
exports.addWritingFeedback = async (req, res) => {
    try {
        console.log('📥 addWritingFeedback called - body:', req.body, 'files:', req.files);
        
        // For multipart requests, body fields come from FormData
        // For JSON requests, body fields come from JSON
        const submission_id = req.body?.submission_id;
        const feedback_text = req.body?.feedback_text;
        const status = req.body?.status;
        const marks = req.body?.marks;
        const audioFile = req.files?.audioFeedback?.[0]; // Optional audio feedback file
        const teacherId = req.user?.id;
        
        console.log('📋 Parsed values - submission_id:', submission_id, 'feedback_text:', feedback_text, 'marks:', marks, 'audioFile:', !!audioFile);

        if (!teacherId) {
            return res.status(401).json({ error: "Teacher authentication required" });
        }

        if (!submission_id) {
            return res.status(400).json({ error: "submission_id is required" });
        }

        // At least one of feedback_text, audioFile, or marks must be provided
        if (!feedback_text && !audioFile && (marks === undefined || marks === null)) {
            return res.status(400).json({ error: "Either feedback_text, audio feedback, or marks must be provided" });
        }

        if (status && !['reviewed', 'needs_improvement', 'completed'].includes(status)) {
            return res.status(400).json({ error: "Status must be 'reviewed', 'needs_improvement', or 'completed'" });
        }

        // Validate marks if provided
        if (marks !== undefined && marks !== null) {
            const marksNum = parseInt(marks);
            if (isNaN(marksNum) || marksNum < 0) {
                return res.status(400).json({ error: "Marks must be a non-negative number" });
            }
        }

        // Verify submission exists and get max_marks from writing task
        console.log('🔍 Fetching submission from database...');
        const { data: submission, error: submissionError } = await supabase
            .from('writing_submissions')
            .select(`
                id,
                writing_task_id
            `)
            .eq('id', submission_id)
            .single();

        console.log('🔍 Submission query result - error:', submissionError, 'data:', submission ? 'found' : 'not found');

        if (submissionError || !submission) {
            console.error('❌ Submission not found or error:', submissionError);
            return res.status(404).json({ error: "Submission not found" });
        }

        // Get max_marks from the writing task directly
        let maxMarks = 0;
        if (submission.writing_task_id) {
            console.log('🔍 Fetching max_marks from writing_tasks...');
            const { data: task, error: taskError } = await supabase
                .from('writing_tasks')
                .select('max_marks')
                .eq('id', submission.writing_task_id)
                .single();
            
            if (taskError) {
                console.warn('⚠️ Could not fetch max_marks:', taskError);
            } else {
                maxMarks = task?.max_marks || 0;
            }
        }
        
        console.log('📊 Max marks:', maxMarks);

        // Validate marks against max_marks
        if (marks !== undefined && marks !== null) {
            const marksNum = parseInt(marks);
            if (maxMarks > 0 && marksNum > maxMarks) {
                return res.status(400).json({ 
                    error: `Marks (${marksNum}) cannot exceed maximum marks (${maxMarks}) for this writing task` 
                });
            }
        }

        let audioUrl = null;

        // If audio file is provided, upload it
        if (audioFile) {
            try {
                // Generate unique filename
                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 15);
                const fileExt = audioFile.mimetype === 'audio/webm' || audioFile.mimetype === 'audio/ogg' ? '.webm' : 
                               audioFile.mimetype === 'audio/mpeg' || audioFile.mimetype === 'audio/mp3' ? '.mp3' : 
                               audioFile.mimetype === 'audio/wav' ? '.wav' : '.webm';
                const fileName = `feedback_${submission_id}_${timestamp}_${randomString}${fileExt}`;
                const filePath = `writing_feedback/${submission_id}/${fileName}`;

                // Determine content type (use audio/mpeg for compatibility)
                let contentType = 'audio/mpeg';
                if (audioFile.mimetype === 'audio/wav' || audioFile.mimetype === 'audio/wave') {
                    contentType = 'audio/wav';
                } else if (audioFile.mimetype === 'audio/mpeg' || audioFile.mimetype === 'audio/mp3') {
                    contentType = 'audio/mpeg';
                }

                // Upload to Supabase storage
                const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
                    .from('lsrw')
                    .upload(filePath, audioFile.buffer, {
                        contentType: contentType,
                        upsert: false
                    });

                if (uploadError) {
                    console.error('Audio feedback upload error:', uploadError);
                    return res.status(500).json({ error: `Failed to upload audio feedback: ${uploadError.message}` });
                }

                // Get public URL
                const { data: urlData } = supabaseAdmin.storage
                    .from('lsrw')
                    .getPublicUrl(filePath);

                audioUrl = urlData.publicUrl;
            } catch (uploadErr) {
                console.error('Error uploading audio feedback:', uploadErr);
                return res.status(500).json({ error: `Failed to upload audio feedback: ${uploadErr.message}` });
            }
        }

        // Check if feedback already exists
        const { data: existingFeedback } = await supabase
            .from('writing_feedback')
            .select('id, audio_url')
            .eq('submission_id', submission_id)
            .single();

        let feedback;
        const feedbackData = {
            feedback_text: feedback_text || null,
            status: status || 'reviewed',
            marks: marks !== undefined && marks !== null ? parseInt(marks) : null,
            updated_at: new Date().toISOString()
        };

        // If audio is provided, add it to feedback data
        if (audioUrl) {
            feedbackData.audio_url = audioUrl;
        }

        // If updating and audio is provided, delete old audio if it exists
        if (existingFeedback && audioUrl && existingFeedback.audio_url) {
            // Extract file path from old URL and delete it
            try {
                const oldUrl = existingFeedback.audio_url;
                const urlParts = oldUrl.split('/');
                const filePath = urlParts.slice(urlParts.indexOf('writing_feedback')).join('/');
                await supabaseAdmin.storage
                    .from('lsrw')
                    .remove([filePath]);
            } catch (deleteErr) {
                console.error('Error deleting old audio feedback:', deleteErr);
                // Continue even if deletion fails
            }
        }

        if (existingFeedback) {
            // Update existing feedback
            const { data, error } = await supabase
                .from('writing_feedback')
                .update(feedbackData)
                .eq('id', existingFeedback.id)
                .select()
                .single();

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            feedback = data;
        } else {
            // Create new feedback
            const { data, error } = await supabase
                .from('writing_feedback')
                .insert([{
                    submission_id,
                    teacher_id: teacherId,
                    feedback_text: feedback_text || null,
                    status: status || 'reviewed',
                    marks: marks !== undefined && marks !== null ? parseInt(marks) : null,
                    audio_url: audioUrl
                }])
                .select()
                .single();

            if (error) {
                return res.status(500).json({ error: error.message });
            }
            feedback = data;
        }

        console.log('✅ Feedback saved successfully:', feedback?.id);
        res.json({
            success: true,
            message: "Feedback saved successfully",
            data: feedback
        });

    } catch (error) {
        console.error('Error adding writing feedback:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

/**
 * Upload Student Writing Submission (Student)
 * POST /api/writing/submit
 * - Student uploads an image of their written answer
 */
exports.submitWritingSubmission = async (req, res) => {
    try {
        const { writing_task_id, batch_id } = req.body;
        const submissionImage = req.file; // Single image file
        const studentId = req.user?.id || req.student?.student_id;

        if (!studentId) {
            return res.status(401).json({ error: "Student authentication required" });
        }

        if (!writing_task_id || !batch_id || !submissionImage) {
            return res.status(400).json({ error: "writing_task_id, batch_id, and submission image are required" });
        }

        // Check if task is visible to students
        const { data: mapping, error: mappingError } = await supabase
            .from('writing_batch_map')
            .select('*')
            .eq('writing_task_id', writing_task_id)
            .eq('batch_id', batch_id)
            .eq('student_visible', true)
            .single();

        if (mappingError || !mapping) {
            return res.status(403).json({ error: "This writing task is not available for students yet" });
        }

        // Check if student has already submitted
        const { data: existingSubmission } = await supabase
            .from('writing_submissions')
            .select('id, submission_image_url')
            .eq('writing_task_id', writing_task_id)
            .eq('student_id', studentId)
            .eq('batch_id', batch_id)
            .single();

        // Get batch and course details for storage path
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('course_id')
            .eq('batch_id', batch_id)
            .single();

        if (batchError || !batch) {
            return res.status(404).json({ error: "Batch not found" });
        }

        // Get course details
        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('language, course_name')
            .eq('id', batch.course_id)
            .single();

        if (courseError || !course) {
            return res.status(404).json({ error: "Course not found" });
        }
        const language = (course?.language || 'general').toLowerCase().replace(/\s+/g, '_');
        const courseCode = (course?.course_name || 'course').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExt = path.extname(submissionImage.originalname);
        const fileName = `submission_${timestamp}_${randomString}${fileExt}`;
        const filePath = `${language}/${courseCode}/writing/student-submissions/${studentId}/${fileName}`;

        // Upload image to Supabase storage
        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('lsrw')
            .upload(filePath, submissionImage.buffer, {
                contentType: submissionImage.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('Image upload error:', uploadError);
            return res.status(500).json({ error: `Failed to upload submission image: ${uploadError.message}` });
        }

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage
            .from('lsrw')
            .getPublicUrl(filePath);

        const submissionImageUrl = urlData.publicUrl;

        // If existing submission, delete old image and update
        if (existingSubmission) {
            // Delete old image
            if (existingSubmission.submission_image_url) {
                try {
                    const oldUrl = existingSubmission.submission_image_url;
                    const urlParts = oldUrl.split('/lsrw/');
                    if (urlParts.length > 1) {
                        const oldFilePath = urlParts[1];
                        await supabaseAdmin.storage.from('lsrw').remove([oldFilePath]);
                    }
                } catch (deleteErr) {
                    console.error('Error deleting old submission image:', deleteErr);
                    // Continue even if deletion fails
                }
            }

            // Update existing submission
            const { data, error } = await supabase
                .from('writing_submissions')
                .update({
                    submission_image_url: submissionImageUrl,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingSubmission.id)
                .select()
                .single();

            if (error) {
                // Clean up uploaded file if update fails
                await supabaseAdmin.storage.from('lsrw').remove([filePath]);
                return res.status(500).json({ error: error.message });
            }

            return res.json({
                success: true,
                message: "Writing submission updated successfully",
                data
            });
        } else {
            // Create new submission
            const { data, error } = await supabase
                .from('writing_submissions')
                .insert([{
                    writing_task_id,
                    student_id: studentId,
                    batch_id,
                    submission_image_url: submissionImageUrl
                }])
                .select()
                .single();

            if (error) {
                // Clean up uploaded file if insert fails
                await supabaseAdmin.storage.from('lsrw').remove([filePath]);
                return res.status(500).json({ error: error.message });
            }

            return res.status(201).json({
                success: true,
                message: "Writing submission uploaded successfully",
                data
            });
        }

    } catch (error) {
        console.error('Error submitting writing:', error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
};

