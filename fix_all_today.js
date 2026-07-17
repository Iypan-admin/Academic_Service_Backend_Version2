const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

async function fixAllToday() {
  const today = new Date().toISOString().split('T')[0];
  const hashed = await bcrypt.hash("Isml@20$14!", 10);

  const { data: students, error } = await supabase
    .from('students')
    .select('registration_number, name')
    .eq('status', true)
    .gte('created_at', today)
    .not('registration_number', 'is', null);

  if (error) return console.error('❌ Error:', error.message);
  if (!students || students.length === 0) return console.log('No new students found today.');

  for (const s of students) {
    const { error: e } = await supabase
      .from('students')
      .update({ password: hashed })
      .eq('registration_number', s.registration_number);

    if (e) console.error(`❌ ${s.registration_number}: ${e.message}`);
    else console.log(`✅ ${s.registration_number} (${s.name})`);
  }

  console.log(`\nDone. ${students.length} student(s) fixed.`);
}

fixAllToday();
