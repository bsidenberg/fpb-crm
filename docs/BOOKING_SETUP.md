# Booked calls — setup for Brian and SEALD

The CRM is the source of truth for consultation calls. SEALD asks this API for open slots and creates, reschedules, or cancels bookings. The same function also accepts SEALD’s signed webhook, so the booking is linked once whether the API call or the webhook arrives first.

**These migrations are not applied.** Merging the pull request does not change production. Run the SQL by hand, then deploy only the `booking` function.

Base URL (after deploy):

```
https://flabvhdgqddbfitbqjqk.supabase.co/functions/v1/booking
```

CRM calendar: https://fpbcrm-alpha.vercel.app/calendar

## Assignment and notification

A slot is offered when **either** active member is free. It is listed once. `available_count` is how many members could take it. Member emails are not in the public availability payload.

| Email | Seeded role | `notify_all` | What they get |
| --- | --- | --- | --- |
| mathew@floridapolebarn.com | `primary` | false | Every booking while he is free |
| brian@floridapolebarn.com | `backup` | true | The booking only when Mathew is busy. Optional attendee on Mathew’s Outlook event otherwise |

Order inside a role is alphabetical email. A second primary would lose to the earlier email. Role `member` is last. Reschedule runs the same rule, so a call Brian is covering moves back to Mathew if Mathew is free at the new time. The Outlook event is deleted from the old mailbox and created on the new one.

**Notification choice: optional Outlook attendee. No separate email.**

On create and reschedule, the assignee’s calendar event includes:

- The customer as a **required** attendee when they have an email and `customer_invite` is not `false` (default is to invite them). SEALD sends no reminders, so this invite is the reminder (60 minutes before, `isReminderOn`).
- Every other active member with `notify_all = true` as an **optional** attendee. That puts the call on Brian’s calendar as FYI when Mathew owns it. Brian is not added to his own event when he is the assignee. Mathew is not FYI’d when Brian covers, because Mathew’s `notify_all` is false.

On cancel, the Graph event is deleted. Outlook sends the cancellation to the customer and to Brian. Completed and no-show leave the event in place.

Change role or `notify_all` on the Calls page (member chip → settings). The columns are `team_members.role` (`primary` | `backup` | `member`) and `team_members.notify_all`.

## Assumptions

- Display name for mathew@ is **Mathew** only. No surname was confirmed. Brian is **Brian Sidenberg**, matching the existing CRM user list. Jeff Hicks and Michelle Hoyt stay CRM users and are not bookable.
- Hours: Monday–Friday 8:30 AM–4:30 PM America/New_York. Calls are 30 minutes and start only on `:00` or `:30`, so the last start is 4:00 PM. A start before 8:30, at or after 4:30, on Saturday or Sunday, or at any other minute is rejected. Seeded in `team_members.weekly_hours`. Editable per member inside that window; the database still rejects anything outside it.
- Buffer between calls is **0**. The Calls page can raise `buffer_minutes`. Buffer is applied after appointments and Outlook busy time, not after an explicit block. The database exclusion constraint stops raw overlaps only; `member_is_free` enforces the buffer.
- Minimum notice is **60 minutes**. Configurable per member (`min_notice_minutes`).
- Public slot length is the primary member’s `call_minutes` (30).
- `consultation_call` is stored on the appointment. It is **not** written to `leads.service_type` (that column stays Kit Delivery Only / Kit + Installation).
- New leads are stage `new`, priority `warm`, source **Booking Agent**. Linking an existing lead (any stage, including won and lost) sets `stage` to `new` and `booked_call` true. `lead_source` becomes **Booking Agent** only when it is blank. `quote_sent_at` is not changed. `stage_changed_at` updates only when the stage actually changes.
- Header names below are the defaults. Override them with the secrets in the next section if SEALD settles on different names.
- Signed payload default is `{timestamp}.{body}` (unix timestamp string, a dot, then the raw request body).
- If Microsoft secrets are missing, the booking still succeeds and `outlook.status` is `skipped` (`microsoft_not_configured`).
- If Microsoft secrets are set but `getSchedule` fails, `GET /availability` still returns CRM slots with `outlook: "unavailable"`. `POST` and `PATCH` return **503** and do not book, so a hidden Outlook conflict cannot double-book.
- The CRM Calls page falls back to the SQL functions only when the edge function is unreachable (network or an empty 404). That fallback does not re-check working hours or Outlook. Prefer the edge function once it is deployed.
- Customer email or phone is required. A name is split on the first space; a single name is stored with last name `—`.

## Apply the database (manual)

In the Supabase SQL editor for project `flabvhdgqddbfitbqjqk`, run in this order:

1. `supabase/migrations/20261012000002_booked_calls.sql`
2. `supabase/migrations/20261012000003_booking_agent_lead_source.sql`
3. `supabase/migrations/20261012000005_return_booked_leads_to_new.sql`
4. `supabase/migrations/20261014000001_booking_window_0830.sql`

Do **not** re-run `20260923000001_normalize_lead_source.sql` after step 2. The older file would replace `normalize_lead_channel` and drop the Booking Agent channel. Step 2 does not backfill existing leads.

Step 3 returns a matched lead to stage `new`, sets `booked_call`, and leaves `quote_sent_at` alone. `lead_source` becomes Booking Agent only when it is blank.

Step 4 is the booking window. If steps 1–3 are already applied, run only step 4. It moves team members who are still on Mon–Fri 09:30–16:30 to 08:30–16:30. The replaced `book_consultation` still calls `apply_booking_lead_patch`, so a matched lead returns to New Lead with `booked_call` true. `reschedule_consultation` and the `booked_calls_time_check` trigger reject a weekend, a start before 8:30 AM, a start at or after 4:30 PM, and any minute other than `:00` or `:30`. Do not edit `20261012000002_booked_calls.sql` or `20261012000005_return_booked_leads_to_new.sql`.

Step 2’s file ends with `notify pgrst, 'reload schema'`. If the Calls page says the table is missing after a successful run, run that notify again.

`btree_gist` is created in `public`. If the SQL editor rejects that, replace the first line with:

```sql
create extension if not exists btree_gist with schema extensions;
```

Then redeploy nothing else. Do not redeploy `quote-followup-check`, `daily-followup-digest`, or `geocode`.

### Deploy the function and the web app

```bash
supabase functions deploy booking --no-verify-jwt --project-ref flabvhdgqddbfitbqjqk
```

`verify_jwt` stays false because SEALD has no Supabase user. The function checks its own API key. Deploy the Vite app so `/calendar` and the board badges ship. Anon still has no table access. RLS on the new tables matches `authenticated_crm_all`: signed-in `@floridapolebarn.com` users only. The function uses the service role.

## Secrets

Set these on the `booking` function (Dashboard → Edge Functions → Secrets, or `supabase secrets set`). Do not put them in the repo.

| Secret | Required | Purpose |
| --- | --- | --- |
| `SEALD_API_KEY` | One of the two key secrets | Raw key compared with the API-key header |
| `SEALD_API_KEY_SHA256` | One of the two key secrets | Hex SHA-256 of the key, if you do not want the raw key stored |
| `SEALD_WEBHOOK_SECRET` | Yes, for the webhook | HMAC-SHA256 key |
| `MICROSOFT_TENANT_ID` | For Outlook | Entra tenant id |
| `MICROSOFT_CLIENT_ID` | For Outlook | App (client) id |
| `MICROSOFT_CLIENT_SECRET` | For Outlook | Client secret value |
| `BOOKING_API_KEY_HEADER` | No | Default `x-api-key` |
| `BOOKING_IDEMPOTENCY_HEADER` | No | Default `Idempotency-Key` |
| `SEALD_WEBHOOK_SIGNATURE_HEADER` | No | Default `x-seald-signature` (`sha256=` prefix allowed) |
| `SEALD_WEBHOOK_TIMESTAMP_HEADER` | No | Default `x-seald-timestamp` (unix seconds, milliseconds, or ISO) |
| `SEALD_WEBHOOK_SIGNED_PAYLOAD` | No | Default `{timestamp}.{body}` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. `SERVICE_ROLE_KEY` is accepted as a fallback name.

Issue **one** API key for SEALD. Store either the raw value or its SHA-256, not both requirements — either secret authorizes the caller. If neither is set, booking routes return 503 `api_key_not_configured`. The webhook does not use this key.

Generate a hash:

```bash
printf '%s' "$SEALD_API_KEY" | shasum -a 256
```

## Azure / Entra (Brian)

Outlook sync is app-only (client credentials). No user redirect and no delegated login.

1. Entra admin center → App registrations → New registration.
   - Name: `FPB CRM booking calendar`
   - Supported account types: **this tenant only**
   - Redirect URI: none
2. Copy the Application (client) id and the Directory (tenant) id into `MICROSOFT_CLIENT_ID` and `MICROSOFT_TENANT_ID`.
3. Certificates & secrets → New client secret. Copy the **value** (not the secret id) into `MICROSOFT_CLIENT_SECRET` before you leave the page.
4. API permissions → Add a permission → Microsoft Graph → **Application permissions** → `Calendars.ReadWrite`.
5. Grant **admin consent** for Florida Pole Barn. Delegated permissions are not used.
6. Both mailboxes must be licensed Exchange Online users: `mathew@floridapolebarn.com` and `brian@floridapolebarn.com`.
7. Recommended: limit the app to those two mailboxes with an Exchange application access policy (Exchange Online PowerShell, as an admin):

```powershell
Connect-ExchangeOnline
New-ApplicationAccessPolicy -AppId "<MICROSOFT_CLIENT_ID>" -PolicyScopeGroupId "fpb-booking-calendars@floridapolebarn.com" -AccessRight RestrictAccess -Description "FPB CRM booking calendars"
```

`PolicyScopeGroupId` is a mail-enabled security group that contains only Mathew and Brian. Test with:

```powershell
Test-ApplicationAccessPolicy -Identity mathew@floridapolebarn.com -AppId "<MICROSOFT_CLIENT_ID>"
```

Until the three `MICROSOFT_*` secrets are set, bookings succeed and Outlook is skipped. After they are set, use **Sync Outlook** on a call in the CRM, or `POST /bookings/:id/sync`.

Graph calls:

- Free/busy: `POST /users/{anchor}/calendar/getSchedule`. Busy, out of office, tentative, and working elsewhere all block the slot.
- Create: `POST /users/{assignee}/events`
- Update: `PATCH` the same event (no `transactionId` on update)
- Cancel: `DELETE` the event (404 is treated as already gone)

Event subject: `FPB consultation — {name}`. Body links to `https://fpbcrm-alpha.vercel.app/leads/{id}` and includes intake plus the verification URL. `showAs` is `busy`. `transactionId` is `{appointmentId}:{rescheduleCount}` on create.

## Gateway header vs API key

Supabase’s gateway still expects the project **publishable (anon) key** on `apikey` or `Authorization`. That key cannot read tables. The SEALD secret is a **second** header.

```http
apikey: <supabase publishable key>
x-api-key: <SEALD_API_KEY>
```

Staff actions from the CRM send the user’s Supabase access token as `Authorization: Bearer …` plus `apikey`. The function accepts that when the email is `@floridapolebarn.com`, so the SEALD key is never in the browser. Staff may omit `Idempotency-Key`; the function then generates `staff-{uuid}`.

## API contract

Times in responses are ISO 8601 with the Eastern offset (`-04:00` or `-05:00`). Send `start` / `end` as ISO 8601 (offset or `Z`). Omitted `end` means start plus 30 minutes. A supplied `end` must be within one minute of 30 minutes or the response is `400 duration_mismatch`.

### GET /availability

```http
GET /availability?start=2026-10-13T00:00:00-04:00&end=2026-10-18T00:00:00-04:00
apikey: <publishable>
x-api-key: <SEALD_API_KEY>
```

```json
{
  "timezone": "America/New_York",
  "slot_minutes": 30,
  "assignment": "primary_then_backup",
  "outlook": "not_configured",
  "start": "2026-10-13T00:00:00-04:00",
  "end": "2026-10-18T00:00:00-04:00",
  "slots": [
    {
      "start": "2026-10-13T08:30:00-04:00",
      "end": "2026-10-13T09:00:00-04:00",
      "available_count": 2
    }
  ]
}
```

`outlook` is `ok`, `not_configured`, or `unavailable`. Range must be at most 62 days. A weekday has 16 slots (8:30 through 16:00). Saturday and Sunday are closed. `POST` and `PATCH` reject a start before 8:30, at or after 4:30, on a weekend, or on a minute other than `:00` or `:30`.

### POST /bookings

`Idempotency-Key` is required for SEALD. Replaying the same key returns the original booking with HTTP 200 and `idempotent: true`. It does not move the time. Send the same `signed_record_id` on the API call and the webhook; that is the stable link. If the signed record already exists, is still `scheduled`, and `start` differs, the call is rescheduled. A cancelled row with that key or signed record is returned unchanged and is not reopened.

```http
POST /bookings
apikey: <publishable>
x-api-key: <SEALD_API_KEY>
Idempotency-Key: 4f0c0b2e-6a1d-4c3a-9f0e-2b7d1a8c6e11
Content-Type: application/json

{
  "start": "2026-10-13T14:00:00-04:00",
  "end": "2026-10-13T14:30:00-04:00",
  "service_type": "consultation_call",
  "business": "Florida Pole Barn",
  "brand": "FPB",
  "source_agent": "seald-voice",
  "signed_record_id": "sr_8f2a",
  "verification_url": "https://seald.example/records/sr_8f2a",
  "customer_invite": true,
  "customer": {
    "name": "Sam Rivera",
    "email": "sam@example.com",
    "phone": "352-555-0142"
  },
  "intake": {
    "building_type": "Pole barn",
    "size": "30x40",
    "location": "Clermont, FL",
    "timeline": "This spring"
  }
}
```

`201` created, `200` replay, `409` `slot_taken`, `400` validation, `401` bad key, `503` key missing or Outlook free/busy down.

```json
{
  "id": "b1c2d3e4-0000-4000-8000-000000000001",
  "status": "scheduled",
  "start": "2026-10-13T14:00:00-04:00",
  "end": "2026-10-13T14:30:00-04:00",
  "timezone": "America/New_York",
  "lead_id": "a1b2c3d4-0000-4000-8000-000000000002",
  "service_type": "consultation_call",
  "idempotent": false,
  "reschedule_count": 0,
  "team_member": {
    "id": "…",
    "email": "mathew@floridapolebarn.com",
    "name": "Mathew"
  },
  "outlook": { "status": "skipped", "error": "microsoft_not_configured" }
}
```

`outlook.status` is `synced`, `failed`, `skipped`, or `pending`. A failed Graph write still keeps the CRM booking (`failed` plus `outlook.error`). Retry with `POST /bookings/:id/sync`.

Flat fields (`customer_name`, `email`, `phone`, `building_type`, `size`, `location`, `timeline`, `starts_at`) are accepted as well as the nested shape.

### PATCH /bookings/:id

```http
PATCH /bookings/b1c2d3e4-0000-4000-8000-000000000001
apikey: <publishable>
x-api-key: <SEALD_API_KEY>
Content-Type: application/json

{ "start": "2026-10-14T10:00:00-04:00", "end": "2026-10-14T10:30:00-04:00" }
```

`200` with the same booking object and `reschedule_count` incremented when the time or assignee changes. `409` if neither member is free or the booking is no longer `scheduled`. `404` if the id does not exist.

### DELETE /bookings/:id

```http
DELETE /bookings/b1c2d3e4-0000-4000-8000-000000000001
apikey: <publishable>
x-api-key: <SEALD_API_KEY>
```

`200`, `status: "cancelled"`. Deleting twice is idempotent. The Outlook event is removed so attendees get the cancellation.

### Staff-only routes

Authenticated CRM users (not SEALD):

- `POST /bookings/:id/outcome` with `{ "status": "completed" }` or `"no_show"`. Does not delete the Outlook event.
- `POST /bookings/:id/sync` retries the Graph write.

## Webhook

```http
POST /webhooks/seald
Content-Type: application/json
x-seald-timestamp: 1760392800
x-seald-signature: <hex hmac sha256 of "{timestamp}.{raw body}">
```

No API key. Rejected with `401` when the timestamp is missing, not a number/ISO time, or more than 5 minutes from the server clock, or when the signature does not match. The signature is hex HMAC-SHA256 over the exact raw body (not a re-serialized object).

```json
{
  "event_id": "evt_01",
  "type": "booking.created",
  "business": "Florida Pole Barn",
  "brand": "FPB",
  "service_type": "consultation_call",
  "start": "2026-10-13T14:00:00-04:00",
  "end": "2026-10-13T14:30:00-04:00",
  "timezone": "America/New_York",
  "customer_name": "Sam Rivera",
  "customer_phone": "352-555-0142",
  "customer_email": "sam@example.com",
  "intake": {
    "building_type": "Pole barn",
    "size": "30x40",
    "location": "Clermont, FL",
    "timeline": "This spring"
  },
  "source_agent": "seald-voice",
  "signed_record_id": "sr_8f2a",
  "verification_url": "https://seald.example/records/sr_8f2a",
  "status": "scheduled"
}
```

`type` may be `booking.created`, `booking.updated`, `booking.rescheduled`, or `booking.cancelled` (also `booking.canceled`). `status` `completed` or `no_show` records the outcome. `event_id` is stored in `booking_webhook_events`. A repeat of the same `event_id` returns `{ "ok": true, "duplicate": true }` and does not book again.

Find order when the webhook is an update or cancel: `booking_id`, then `idempotency_key`, then `signed_record_id`, then the single scheduled appointment for that customer email. Created events use `idempotency_key`, else `signed_record_id`, else `event_id`, as the idempotency key. Intake is appended to lead notes once, marked `[booked-call:…]`. Blank building type, size, timeline, city, email, phone, owner, and source are filled; values a rep already entered are left alone. A matched lead is moved to stage `new` with `booked_call` true. `lead_source` is set to Booking Agent only when that field is empty.

SEALD should retry with backoff on 5xx. 401 will not succeed on retry unless the signature or clock is fixed.

## What the board shows

A lead with `booked_call` true uses a light indigo tile (background and left border) and sorts to the top of its column, ahead of older cards. The badge still reads **Call booked**, **Rescheduled**, or **Outcome needed**, plus the Eastern time. **Mark call done** on the card or the lead page sets `booked_call` false, returns the tile to the normal color, and logs a call activity. Completed, no-show, and cancelled badges can remain after that. The board’s **Booked call** filter shows only flagged leads. The tile uses the soonest upcoming scheduled call when a lead has more than one. The Calls page is the day/week calendar, working hours, blocks, role, and `notify_all`.

## Test checklist

Database (after the manual SQL, not before):

- [ ] `team_members` has Mathew (`primary`, `notify_all` false) and Brian Sidenberg (`backup`, `notify_all` true), Mon–Fri 08:30–16:30, 30-minute calls.
- [ ] Anon `select` on `appointments`, `team_members`, `team_blocks`, and `booking_webhook_events` returns no rows / permission denied.
- [ ] A signed-in `@floridapolebarn.com` user can read them.
- [ ] Booking the same instant twice for Mathew hits `slot_taken` or the exclusion constraint. The second customer is not given Mathew’s slot.
- [ ] A lead linked by email moves to stage `new`, sets `booked_call`, keeps `quote_sent_at`, and keeps a `lead_source` that is already filled.
- [ ] `leads.service_type` is unchanged. `appointments.service_type` is `consultation_call`.

API (function deployed, key set, Microsoft secrets unset):

- [ ] `GET /availability` for a weekday returns 16 slots (8:30 through 16:00) and `assignment: "primary_then_backup"`. A Saturday–Sunday range returns no slots. 8:30 and 4:00 are accepted. 4:30, 3:33, and Saturday are rejected.
- [ ] `POST /bookings` assigns `mathew@floridapolebarn.com` and returns 201, `outlook.status: "skipped"`.
- [ ] The same `Idempotency-Key` returns 200 and the same id.
- [ ] Book Mathew into that slot directly in the CRM (or a second booking at the same start). The next `POST` for that start assigns `brian@floridapolebarn.com`.
- [ ] Book both. The next `POST` for that start returns 409.
- [ ] `PATCH` to a free time returns Mathew again when he is free.
- [ ] `DELETE` returns `cancelled`. A second `DELETE` stays cancelled.
- [ ] Webhook with a bad signature returns 401. A timestamp older than 5 minutes returns 401.
- [ ] `booking.created` then the same `event_id` again returns `duplicate: true`.
- [ ] Webhook first, then `POST` with the same `signed_record_id`, does not create a second appointment.

Outlook (after Azure consent and the three secrets):

- [ ] `POST /bookings/:id/sync` creates an event on Mathew’s calendar.
- [ ] The customer is required. `brian@floridapolebarn.com` is optional.
- [ ] An Outlook busy block on Mathew’s calendar removes him from that slot; Brian still fills it; the slot disappears only when both are busy.
- [ ] Cancel deletes the event and Brian receives the cancellation.
- [ ] With secrets removed, a new booking still succeeds and Outlook is `skipped`.

CRM UI (after the web app deploy):

- [ ] A booked lead lands in New Lead with the indigo tile, at the top of that column. Mark call done clears the color and adds an activity. The Booked call filter shows only those leads.
- [ ] Calls page shows both lanes, a block, and a booking. Changing role or `notify_all` saves.
- [ ] Complete, no-show, cancel, and reschedule from the lead and from the calendar.
- [ ] Quote follow-up and the existing board still behave as before. Do not invoke `quote-followup-check` as a test; it emails people.

Local checks that do not need production:

```bash
npm test
npm run lint
npm run build
```

## SEALD webhook (final contract, S-35)

Receiver: `POST https://flabvhdgqddbfitbqjqk.supabase.co/functions/v1/booking/webhooks/seald`

- `Seald-Signature: t=<unix seconds>,v1=<hex hmac-sha256>` over `${t}.${rawBody}` (exact raw bytes), constant-time compare, |now − t| ≤ 300 s. Otherwise 401.
- `Seald-Idempotency-Key` = event id. Processed events are stored in `booking_webhook_events` with `response_status`/`response_body` (migration `20261012000004`); retries return the original result with `duplicate: true`.
- Payload `v` must be `1` (else 400). Events: `booking.created`, `booking.updated`, `booking.cancelled`. `"test": true` events are verified and return 200 without creating anything.
- Secret: Supabase secret `SEALD_WEBHOOK_SECRET` = the secret SEALD returns once from `PUT /api/entities/:id/webhook`. The old `SEALD_WEBHOOK_*_HEADER` / `SIGNED_PAYLOAD` env overrides are no longer used.
