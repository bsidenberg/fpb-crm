export {
  pickDisplayAppointment,
  formatCallWhen,
  bookedCallPresentation,
  sameAppointment,
} from '../../supabase/functions/_shared/bookedCall.js'

// Whole-card treatment while leads.booked_call is true. Clearing the flag
// returns the card to the normal temperature border.
export const BOOKED_TILE = {
  color: '#4338CA',
  wash: '#EEF2FF',
  line: '#C7D2FE',
}
