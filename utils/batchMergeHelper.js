const supabase = require("../config/supabase.js");

// Helper function to get all batch IDs in a merge group (including the original batch)
const getMergedBatchIds = async (batch_id) => {
    try {
        console.log('🔍 Checking merge group for batch:', batch_id);
        
        // First check if this batch is part of a merge group
        const { data: mergeMember, error: memberError } = await supabase
            .from('batch_merge_members')
            .select('merge_group_id')
            .eq('batch_id', batch_id)
            .single();

        if (memberError || !mergeMember) {
            console.log('ℹ️ Batch not in merge group, returning single batch');
            return [batch_id];
        }

        console.log('🔗 Found merge group:', mergeMember.merge_group_id);

        // Get all batch IDs in this merge group
        const { data: allMembers, error: membersError } = await supabase
            .from('batch_merge_members')
            .select('batch_id')
            .eq('merge_group_id', mergeMember.merge_group_id);

        if (membersError || !allMembers) {
            console.log('❌ Error fetching members:', membersError);
            return [batch_id];
        }

        const batchIds = allMembers.map(member => member.batch_id);
        console.log('✅ Merged batches:', batchIds);
        return batchIds;
    } catch (error) {
        console.error('❌ Error getting merged batch IDs:', error);
        return [batch_id];
    }
};

module.exports = { getMergedBatchIds };
