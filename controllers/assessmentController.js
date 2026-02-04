const supabase = require("../config/supabase.js");

// Language column mappings
const LANGUAGE_COLUMNS = {
  'German': [
    { key: 'german_lesen_marks', label: 'Lesen', maxMarks: 25 },
    { key: 'german_schreiben_marks', label: 'Schreiben', maxMarks: 25 },
    { key: 'german_horen_marks', label: 'Hören', maxMarks: 25 },
    { key: 'german_sprechen_marks', label: 'Sprechen', maxMarks: 25 },
    { totalKey: 'german_total_marks', totalMaxMarks: 100 }
  ],
  'French': [
    { key: 'french_comprehension_orale_marks', label: 'Compréhension Orale', maxMarks: 25 },
    { key: 'french_comprehension_ecrite_marks', label: 'Compréhension Écrite', maxMarks: 25 },
    { key: 'french_production_orale_marks', label: 'Production Orale', maxMarks: 25 },
    { key: 'french_production_ecrite_marks', label: 'Production Écrite', maxMarks: 25 },
    { totalKey: 'french_total_marks', totalMaxMarks: 100 }
  ],
  'Japanese': [
    { key: 'japanese_vocabulary_grammar_marks', label: 'Vocabulary Grammar', maxMarks: 60 },
    { key: 'japanese_reading_marks', label: 'Reading', maxMarks: 60 },
    { key: 'japanese_listening_marks', label: 'Listening', maxMarks: 60 },
    { totalKey: 'japanese_total_marks', totalMaxMarks: 180 }
  ]
};

// Set assessment date for a batch
const setBatchAssessmentDate = async (req, res) => {
  try {
    const { batchId } = req.params;
    const { assessmentDate } = req.body;
    
    if (!assessmentDate) {
      return res.status(400).json({ error: 'Assessment date is required' });
    }
    

    
    // Check if assessment date already exists for this batch
    const existingDate = await getBatchAssessmentDate(batchId);
    if (existingDate) {
      return res.status(400).json({ 
        error: 'Assessment date already exists for this batch',
        existingDate: existingDate
      });
    }
    
    // Update assessment date for all students in the batch
    const { data, error } = await supabase
      .from('assessment_marks')
      .update({ 
        assessment_date: assessmentDate,
        updated_at: new Date().toISOString()
      })
      .eq('batch_id', batchId);
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Assessment date set successfully',
      data: {
        batchId,
        assessmentDate,
        updatedRecords: data?.length || 0
      }
    });
    
  } catch (error) {
    console.error('Error setting batch assessment date:', error);
    res.status(500).json({ error: 'Failed to set assessment date' });
  }
};

// Get assessment date for a batch
const getBatchAssessmentDate = async (batchId) => {
  try {
    const { data, error } = await supabase
      .from('assessment_marks')
      .select('assessment_date')
      .eq('batch_id', batchId)
      .not('assessment_date', 'is', null)
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found" error
      throw error;
    }
    
    return data ? data.assessment_date : null;
  } catch (error) {
    console.error('Error getting batch assessment date:', error);
    return null;
  }
};

// Get course language for a batch
const getCourseLanguage = async (batchId) => {
  try {
    const { data, error } = await supabase
      .from('batches')
      .select(`
        courses!inner (
          course_name,
          type,
          language
        )
      `)
      .eq('batch_id', batchId)
      .single();

    if (error) throw error;

    const courseName = data.courses.course_name || '';
    const courseType = data.courses.type || '';
    const courseLanguage = data.courses.language || '';
    
    // Check in course_name first, then type, then language field
    if (courseName.toLowerCase().includes('german') || courseType.toLowerCase().includes('german') || courseLanguage.toLowerCase().includes('german')) {
      return 'German';
    } else if (courseName.toLowerCase().includes('french') || courseType.toLowerCase().includes('french') || courseLanguage.toLowerCase().includes('french')) {
      return 'French';
    } else if (courseName.toLowerCase().includes('japanese') || courseType.toLowerCase().includes('japanese') || courseLanguage.toLowerCase().includes('japanese')) {
      return 'Japanese';
    }
    
    return 'Unknown';
  } catch (error) {
    console.error('Error getting course language:', error);
    return 'Unknown';
  }
};

// Get students in a batch with their assessment marks
const getBatchStudentsWithMarks = async (req, res) => {
  try {
    const { batchId } = req.params;
    
    // Get course language
    const courseLanguage = await getCourseLanguage(batchId);
    
    // Get assessment date for the batch
    const assessmentDate = await getBatchAssessmentDate(batchId);
    
    // Get batch information
    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .select(`
        batch_id,
        batch_name,
        status,
        courses!inner (
          course_name,
          type,
          language
        )
      `)
      .eq('batch_id', batchId)
      .single();

    if (batchError) throw batchError;

    // Get students in the batch first
    const { data: studentsData, error: studentsError } = await supabase
      .from('enrollment')
      .select(`
        student,
        students!inner (
          student_id,
          name,
          email,
          registration_number
        )
      `)
      .eq('batch', batchId)
      .eq('status', true);

    if (studentsError) throw studentsError;

    // Get assessment marks for these students separately
    const studentIds = studentsData.map(e => e.student);
    const { data: marksData, error: marksError } = await supabase
      .from('assessment_marks')
      .select('*')
      .eq('batch_id', batchId)
      .in('student_id', studentIds);

    if (marksError) throw marksError;

    // Get generated certificates for these students
    const { data: certData, error: certError } = await supabase
      .from('generated_certificates')
      .select('*')
      .eq('batch_id', batchId)
      .in('student_id', studentIds);

    if (certError) throw certError;

    // Transform data to match expected format
    const students = studentsData.map(enrollment => {
      const studentName = enrollment.students.name || '';
      const nameParts = studentName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Find matching assessment marks for this student
      const assessmentMark = marksData.find(mark => mark.student_id === enrollment.students.student_id);
      
      // Find matching certificate for this student
      const certificate = certData.find(cert => cert.student_id === enrollment.students.student_id);
      
      return {
        student_id: enrollment.students.student_id,
        first_name: firstName,
        last_name: lastName,
        email: enrollment.students.email,
        registration_number: enrollment.students.registration_number,
        assessment_id: assessmentMark?.id || '',
        course_language: assessmentMark?.course_language || courseLanguage,
        german_lesen_marks: assessmentMark?.german_lesen_marks || 0,
        german_schreiben_marks: assessmentMark?.german_schreiben_marks || 0,
        german_horen_marks: assessmentMark?.german_horen_marks || 0,
        german_sprechen_marks: assessmentMark?.german_sprechen_marks || 0,
        german_total_marks: assessmentMark?.german_total_marks || 0,
        french_comprehension_orale_marks: assessmentMark?.french_comprehension_orale_marks || 0,
        french_comprehension_ecrite_marks: assessmentMark?.french_comprehension_ecrite_marks || 0,
        french_production_orale_marks: assessmentMark?.french_production_orale_marks || 0,
        french_production_ecrite_marks: assessmentMark?.french_production_ecrite_marks || 0,
        french_total_marks: assessmentMark?.french_total_marks || 0,
        japanese_vocabulary_grammar_marks: assessmentMark?.japanese_vocabulary_grammar_marks || 0,
        japanese_reading_marks: assessmentMark?.japanese_reading_marks || 0,
        japanese_listening_marks: assessmentMark?.japanese_listening_marks || 0,
        japanese_total_marks: assessmentMark?.japanese_total_marks || 0,
        status: assessmentMark?.status || 'draft',
        submitted_at: assessmentMark?.submitted_at || new Date().toISOString(),
        updated_at: assessmentMark?.updated_at || new Date().toISOString(),
        certificate: certificate ? {
          url: certificate.certificate_url,
          generatedAt: certificate.generated_at,
          certificateId: certificate.certificate_id,
          status: certificate.status
        } : null
      };
    });

    res.json({
      success: true,
      data: {
        batch: {
          batch_id: batchData.batch_id,
          batch_name: batchData.batch_name,
          status: batchData.status,
          course_name: batchData.courses.course_name,
          course_type: batchData.courses.type,
          course_language: batchData.courses.language
        },
        courseLanguage,
        languageColumns: LANGUAGE_COLUMNS[courseLanguage]?.filter(col => col.key) || [],
        assessmentDate,
        students
      }
    });
    
  } catch (error) {
    console.error('Error getting batch students with marks:', error);
    res.status(500).json({ error: 'Failed to fetch students and marks' });
  }
};

// Save or update assessment marks for a batch
const saveBatchMarks = async (req, res) => {
  try {
    const { batchId } = req.params;
    const { marks, assessmentDate } = req.body; // Array of { studentId, marksData } and assessmentDate
    

    
    const courseLanguage = await getCourseLanguage(batchId);

    
    // Check if assessment records already exist for this batch to get existing assessment date
    let finalAssessmentDate = assessmentDate;
    if (assessmentDate) {
      const { data: existingRecords } = await supabase
        .from('assessment_marks')
        .select('assessment_date')
        .eq('batch_id', batchId)
        .limit(1);
      
      if (existingRecords && existingRecords.length > 0 && existingRecords[0].assessment_date) {
        // Use existing assessment date, ignore the provided one
        finalAssessmentDate = existingRecords[0].assessment_date;

      } else {

      }
    }
    
    const results = [];
    
    for (const markData of marks) {
      const { studentId, marksData } = markData;
      

      
      // Handle undefined marksData
      if (!marksData) {

        continue;
      }
      
      // Check if assessment record exists
      const { data: existingRecord, error: fetchError } = await supabase
        .from('assessment_marks')
        .select('*')
        .eq('batch_id', batchId)
        .eq('student_id', studentId)
        .single();



      let assessmentRecord;
      
      if (existingRecord) {

        // Update existing record
        const updateData = {
          course_language: courseLanguage,
          submitted_by: req.user.id,
          updated_at: new Date().toISOString()
        };

        // Add assessment date if this is the first time setting it
        if (finalAssessmentDate && !existingRecord.assessment_date) {
          updateData.assessment_date = finalAssessmentDate;
        }

        // Add language-specific marks
        if (courseLanguage === 'German') {
          updateData.german_lesen_marks = marksData.german_lesen_marks || 0;
          updateData.german_schreiben_marks = marksData.german_schreiben_marks || 0;
          updateData.german_horen_marks = marksData.german_horen_marks || 0;
          updateData.german_sprechen_marks = marksData.german_sprechen_marks || 0;
        } else if (courseLanguage === 'French') {
          updateData.french_comprehension_orale_marks = marksData.french_comprehension_orale_marks || 0;
          updateData.french_comprehension_ecrite_marks = marksData.french_comprehension_ecrite_marks || 0;
          updateData.french_production_orale_marks = marksData.french_production_orale_marks || 0;
          updateData.french_production_ecrite_marks = marksData.french_production_ecrite_marks || 0;
        } else if (courseLanguage === 'Japanese') {
          updateData.japanese_vocabulary_grammar_marks = marksData.japanese_vocabulary_grammar_marks || 0;
          updateData.japanese_reading_marks = marksData.japanese_reading_marks || 0;
          updateData.japanese_listening_marks = marksData.japanese_listening_marks || 0;
        }

        if (marksData.status) {
          updateData.status = marksData.status;
        }



        const { data: updatedRecord, error: updateError } = await supabase
          .from('assessment_marks')
          .update(updateData)
          .eq('id', existingRecord.id)
          .select()
          .single();


        if (updateError) throw updateError;
        assessmentRecord = updatedRecord;
        
      } else {

        // Create new record
        const insertData = {
          batch_id: batchId,
          student_id: studentId,
          course_language: courseLanguage,
          submitted_by: req.user.id,
          status: marksData.status || 'draft'
        };

        // Add assessment date if provided
        if (finalAssessmentDate) {
          insertData.assessment_date = finalAssessmentDate;
        }

        // Add language-specific marks
        if (courseLanguage === 'German') {
          insertData.german_lesen_marks = marksData.german_lesen_marks || 0;
          insertData.german_schreiben_marks = marksData.german_schreiben_marks || 0;
          insertData.german_horen_marks = marksData.german_horen_marks || 0;
          insertData.german_sprechen_marks = marksData.german_sprechen_marks || 0;
        } else if (courseLanguage === 'French') {
          insertData.french_comprehension_orale_marks = marksData.french_comprehension_orale_marks || 0;
          insertData.french_comprehension_ecrite_marks = marksData.french_comprehension_ecrite_marks || 0;
          insertData.french_production_orale_marks = marksData.french_production_orale_marks || 0;
          insertData.french_production_ecrite_marks = marksData.french_production_ecrite_marks || 0;
        } else if (courseLanguage === 'Japanese') {
          insertData.japanese_vocabulary_grammar_marks = marksData.japanese_vocabulary_grammar_marks || 0;
          insertData.japanese_reading_marks = marksData.japanese_reading_marks || 0;
          insertData.japanese_listening_marks = marksData.japanese_listening_marks || 0;
        }



        const { data: newRecord, error: insertError } = await supabase
          .from('assessment_marks')
          .insert(insertData)
          .select()
          .single();


        if (insertError) throw insertError;
        assessmentRecord = newRecord;
      }
      
      results.push(assessmentRecord);
    }
    

    
    res.json({
      success: true,
      data: results,
      message: 'Assessment marks saved successfully'
    });
    
  } catch (error) {
    console.error('=== saveBatchMarks Error ===');
    console.error('Full error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save assessment marks', details: error.message });
  }
};

// Submit final assessment marks for a batch
const submitBatchMarks = async (req, res) => {
  try {
    const { batchId } = req.params;
    

    
    // Update all assessment marks for this batch to 'submitted' status

    const { error: updateError } = await supabase
      .from('assessment_marks')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        submitted_by: req.user.id
      })
      .eq('batch_id', batchId)
      .neq('status', 'approved');



    if (updateError) throw updateError;
    
    // Update batch status to 'completed' (only if not already completed)

    const { data: currentBatch, error: fetchBatchError } = await supabase
      .from('batches')
      .select('status')
      .eq('batch_id', batchId)
      .single();



    if (fetchBatchError) throw fetchBatchError;

    let batchUpdateError = null;
    if (currentBatch.status?.toLowerCase() !== 'completed') {
      const { error: updateError } = await supabase
        .from('batches')
        .update({
          status: 'completed'
        })
        .eq('batch_id', batchId);
      
      batchUpdateError = updateError;

    } else {

    }

    if (batchUpdateError) throw batchUpdateError;
    

    
    res.json({
      success: true,
      message: 'Assessment marks submitted successfully'
    });
    
  } catch (error) {
    console.error('=== submitBatchMarks Error ===');
    console.error('Full error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to submit assessment marks', details: error.message });
  }
};

// Get batch assessment summary
const getBatchAssessmentSummary = async (req, res) => {
  try {
    const { batchId } = req.params;
    
    const courseLanguage = await getCourseLanguage(batchId);
    const columns = LANGUAGE_COLUMNS[courseLanguage];
    
    if (!columns) {
      return res.status(400).json({ error: 'Invalid course language' });
    }
    
    let totalColumn = columns.totalKey;
    let maxTotalMarks = columns.totalMaxMarks;
    
    const { data: summaryData, error: summaryError } = await supabase
      .from('assessment_marks')
      .select(`
        status,
        ${totalColumn}
      `)
      .eq('batch_id', batchId);

    if (summaryError) throw summaryError;

    const totalStudents = summaryData.length;
    const submittedStudents = summaryData.filter(item => item.status === 'submitted').length;
    const approvedStudents = summaryData.filter(item => item.status === 'approved').length;
    
    const marks = summaryData.map(item => item[totalColumn] || 0);
    const averageMarks = marks.length > 0 ? marks.reduce((a, b) => a + b, 0) / marks.length : 0;
    const highestMarks = marks.length > 0 ? Math.max(...marks) : 0;
    const lowestMarks = marks.length > 0 ? Math.min(...marks) : 0;
    const passedStudents = marks.filter(mark => mark >= maxTotalMarks * 0.6).length;
    
    res.json({
      success: true,
      data: {
        courseLanguage,
        maxTotalMarks,
        summary: {
          total_students: totalStudents,
          submitted_students: submittedStudents,
          approved_students: approvedStudents,
          average_marks: averageMarks,
          highest_marks: highestMarks,
          lowest_marks: lowestMarks,
          passed_students: passedStudents
        }
      }
    });
    
  } catch (error) {
    console.error('Error getting batch assessment summary:', error);
    res.status(500).json({ error: 'Failed to fetch assessment summary' });
  }
};

module.exports = {
  getBatchStudentsWithMarks,
  saveBatchMarks,
  submitBatchMarks,
  getBatchAssessmentSummary,
  setBatchAssessmentDate,
  LANGUAGE_COLUMNS
};

