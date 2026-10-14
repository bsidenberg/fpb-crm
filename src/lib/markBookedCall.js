export const MARK_CALL_DONE_BODY = 'Consultation call marked done'

// Clears the board highlight and logs the activity. RLS still requires an
// authenticated @floridapolebarn.com user; this does not widen access.
export async function markBookedCallDone(client, { leadId, author, userEmail }) {
  const { data, error } = await client
    .from('leads')
    .update({ booked_call: false })
    .eq('id', leadId)
    .select('id')
  if (error || !data || data.length === 0) {
    return { ok: false, error: error || { message: 'not saved' } }
  }
  const { error: activityError } = await client.from('activities').insert([{
    lead_id: leadId,
    type: 'call',
    body: MARK_CALL_DONE_BODY,
    author: author || 'Team',
    user_email: userEmail || null,
  }])
  return { ok: true, activityError: activityError || null }
}
