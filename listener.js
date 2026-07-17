const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

console.log('📡 Realtime Listener Started. Monitoring student approvals...');

const channel = supabase
  .channel('student-approval')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'students'
    },
    async (payload) => {
      const { new: newStudent, old: oldStudent } = payload;

      // Check if student status changed from false to true (approved)
      if (newStudent.status === true && (!oldStudent || oldStudent.status === false)) {
        console.log(`\n👤 Student Approved: ${newStudent.registration_number || newStudent.name}`);
        
        try {
          const defaultPassword = "Isml@20$14!";
          const hashedPassword = await bcrypt.hash(defaultPassword, 10);

          const { error } = await supabase
            .from('students')
            .update({ password: hashedPassword })
            .eq('student_id', newStudent.student_id);

          if (error) {
            console.error(`❌ Failed to update password for ${newStudent.registration_number}:`, error.message);
          } else {
            console.log(`✅ Default password auto-set to: ${defaultPassword}`);
          }
        } catch (err) {
          console.error(`❌ Error during password update:`, err.message);
        }
      }
    }
  )
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('🟢 Successfully connected to Supabase Realtime channel.');
    } else {
      console.log(`🟡 Channel status changed to: ${status}`);
    }
  });

// Keep process alive
process.on('SIGINT', () => {
  channel.unsubscribe();
  console.log('🔌 Listener stopped.');
  process.exit();
});
