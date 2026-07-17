const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

async function fixPassword() {
  const regNo = process.argv[2];
  if (!regNo) {
    return console.log('Usage: node fix_password.js ISMLONIS1306');
  }

  const hashed = await bcrypt.hash("Isml@20$14!", 10);
  const { data, error } = await supabase
    .from('students')
    .update({ password: hashed })
    .eq('registration_number', regNo)
    .select();

  if (error) return console.error('❌ Error:', error.message);
  if (!data || data.length === 0) return console.log('❌ Student not found:', regNo);

  console.log(`✅ Password fixed for ${regNo}`);
  console.log(`   Login with: Isml@20$14!`);
}

fixPassword();
