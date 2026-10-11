# SAHARA MVP — Telegram intake, LLM classification, child dashboard, SOS alerts

An elderly parent messages a Telegram bot. SAHARA identifies the parent's household, detects emergencies with **deterministic rules first**, classifies normal requests with an LLM (Google Gemini), stores everything in a SQLite file next to the app, shows it on an authenticated dashboard for the parent's children, and notifies them on Telegram. SOS runs a separate escalation flow that only ends when a human acknowledges it.

> **Scope:** intake, classification, tracking and notification only. Nothing is booked, paid for or dispatched. SAHARA never contacts emergency services.

---

## 1. Architecture

```
Telegram ──webhook (secret header)──► /api/telegram/webhook ─┐
   (or local: npm run bot:poll — same pipeline)              │
                                                              ▼
                     ┌──────────── processTelegramUpdate ────────────┐
                     │ 1 dedupe update_id (telegram_updates PK)       │
                     │ 2 resolve sender by numeric Telegram id        │
                     │ 3 deterministic emergency rules  ◄── no LLM    │
                     │    ├─ emergency → one transaction: request +   │
                     │    │   events + outbox → dispatch immediately  │
                     │    └─ otherwise → rate limit → persist FIRST → │
                     │        Gemini (timeout, strict Zod) → safety   │
                     │        rules → outbox → dispatch               │
                     └────────────────────────────────────────────────┘
SQLite file (lives with the app) ◄── Next.js dashboard (polling, session auth, household-scoped)
            ▲
 worker (inside the server in production; `npm run worker` locally): escalation rounds · outbox retries · crash recovery
```

| Piece | Location |
|---|---|
| Emergency rules (pure, unit-tested) | `src/lib/emergency/detect.ts` |
| Classifier interface / Gemini / offline heuristic | `src/lib/classifier/` |
| Intake pipeline | `src/lib/intake/process-update.ts` |
| Notification abstraction + outbox | `src/lib/notifications/` |
| Escalation + acknowledgement | `src/lib/escalation/escalation.ts` |
| Household authorization | `src/lib/requests/access.ts` |
| Pairing codes / sessions | `src/lib/auth/` |
| Schema and migrations | `prisma/` |

### Key safety decisions
- **Exact `SOS` and clear emergency phrases are detected by code before any LLM call.** The LLM is never the only way an emergency gets recognised.
- **The LLM can only raise urgency, never lower it.** If Gemini says `is_emergency: true`, the request is escalated. Possible-emergency wording ("dizzy", "slipped", "scared", "urgent") floors urgency at `urgent`, flags the request for review, and alerts the child before the LLM is even called.
- **Messages are never lost.** Normal requests are saved before classification. Invalid or missing LLM output is stored as `unclassified` / `NEEDS_REVIEW`.
- **Emergencies are never auto-resolved.** They stay `ESCALATED` until a child acknowledges (who and when are recorded). Re-alerts stop after `ESCALATION_MAX_ROUNDS`, but the alert stays unacknowledged on the dashboard.
- **SOS is never rate-limited.** If an emergency message can't be delivered, the next responder level is escalated immediately.
- **Idempotency:**
  - `update_id` primary key: webhook retries are no-ops.
  - Outbox `idempotencyKey`: no duplicate notifications.
  - Outbox rows are claimed inside a transaction. Run one app process so the SQLite file has a single writer.

### Data model
`users`, `households`, `household_memberships` (role PARENT/CHILD, `isEmergencyContact`, `escalationOrder`), `telegram_accounts` (numeric user/chat ids, `botStarted`), `pairing_codes` (SHA-256 hashed, single-use, TTL), `sessions` (hashed tokens), `telegram_updates` (dedupe), `requests`, `request_events` (audit timeline), `notification_outbox`, `rate_limit_buckets`. Multiple children per household are supported.

---

## 2. Local setup

**Requirements:** Node.js 20+ (tested on 23) and npm. Data is a SQLite file. There is no separate database to install.

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env` (see §3 and §4 for the Telegram and Gemini values). Then, in separate terminals:

```bash
npm run db:deploy
```
(This creates `data/sahara.sqlite` from `DATABASE_URL` in `.env`.)

```bash
npm run dev:all
```

`dev:all` runs the web app (http://localhost:3000), the worker and the Telegram polling bot together. Run them separately with `npm run dev`, `npm run worker` and `npm run bot:poll`.

Open http://localhost:3000/register and create the child account and household.

### Optional demo data
`DEMO_MODE=true npm run db:seed-demo` creates a `[DEMO]` household with sample requests and a `demo.child@example.test` login (password from `DEMO_PASSWORD`). It refuses to run when `DEMO_MODE` isn't `true` or in production. While demo mode is on, the dashboard shows a "DEMO MODE" banner.

---

## 3. Create the Telegram bot (BotFather)

1. In Telegram, open **@BotFather** and send `/newbot`. Choose a name (e.g. *SAHARA Family*) and a username ending in `bot`.
2. Copy the token into `.env` as `TELEGRAM_BOT_TOKEN`. Never commit it. Put the username (without `@`) in `TELEGRAM_BOT_USERNAME`.
3. Optional: `/setdescription` and `/setuserpic`. Keep **privacy mode on** (the default). SAHARA only accepts private chats.
4. Set `TELEGRAM_WEBHOOK_SECRET` to a random 32+ character string (letters, digits, `_` or `-`), e.g.

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

**Local development:** `npm run bot:poll` long-polls Telegram. It removes any webhook first, and no public URL is needed.

**Webhook via a tunnel (optional locally, required in production):** expose port 3000 over HTTPS (e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`), stop the poller, then run:

```bash
npm run bot:set-webhook -- https://your-tunnel.example.com
```

The webhook rejects any request whose `X-Telegram-Bot-Api-Secret-Token` doesn't match, and refuses to run at all if no secret is configured.

> **Network note:** some corporate networks block `api.telegram.org`. If both polling and webhook delivery fail, test from a network that allows Telegram. For UI work without Telegram, set `NOTIFY_CHANNEL="console"` (dev only: notifications are printed to the server log) and inject messages through the real webhook with `npm run bot:simulate` (see §6).

---

## 4. Configure Gemini

```dotenv
LLM_PROVIDER="gemini"
GEMINI_API_KEY="<from Google AI Studio>"
GEMINI_MODEL="gemini-flash-latest"   # alias; gemini-2.5-* is retired for new keys
```

- The key is only used server-side, sent in the `x-goog-api-key` header (never in the URL) and redacted from logs.
- The classifier uses `generateContent` JSON mode with a `responseSchema`. The response is still validated against a strict Zod schema: closed enums for category and urgency, no unknown keys, and consistency rules.
- Without a key, use `LLM_PROVIDER="heuristic"`, an offline keyword classifier. Its confidence is capped at 0.5, so every result is flagged for review; not for production. `LLM_PROVIDER="none"` stores every request as unclassified.
- To add another provider, implement `Classifier` (`src/lib/classifier/types.ts`) and register it in `src/lib/classifier/index.ts`.

---

## 5. Link a parent and a child

All linking uses short-lived (15-minute), single-use, hashed pairing codes created on the authenticated dashboard. Display names and @usernames are **never** used for identity; only Telegram's numeric user and chat ids are.

1. **Child:** register on the dashboard, then go to **Household → Step 1 → Generate my pairing code**.
2. On the child's phone, open the bot, press **Start**, and send `/link CODE`. Opening `t.me/<bot>?start=CODE` also works. The child has now started the bot, so SAHARA may DM them.
3. **Parent:** under **Step 2**, enter the parent's name and generate a parent code. On the parent's phone, open the bot, press **Start**, and send `/link CODE`.
4. The members table shows both as **Linked**. Set emergency contacts and escalation levels there. Level 1 is alerted immediately; level 2 is alerted after `ESCALATION_ACK_TIMEOUT_SECONDS`, and so on.

Pairing attempts are rate-limited (`RATE_LIMIT_LINK_ATTEMPTS_PER_15_MIN`). A Telegram account can't be the parent in two households or be both parent and child.

---

## 6. Try the flows (definition of done)

| Step | Action | Expected |
|---|---|---|
| Normal | Parent sends *"I need an electrician to check my bedroom fan"* | Dashboard shows *Home Maintenance · Electrician*, issue *"Bedroom fan needs inspection"*, *Routine*. The child receives **SAHARA \| NON-EMERGENCY** and the parent gets a receipt saying nothing has been booked. |
| SOS | Parent sends `SOS` | A red banner appears on every dashboard page and the child receives **🚨 SAHARA EMERGENCY — SOS**. Status is `ESCALATED / NOT ACKNOWLEDGED`. |
| Escalation | Wait `ESCALATION_ACK_TIMEOUT_SECONDS` | The timeline shows *Escalation round 1*. The next level (or everyone again) is re-alerted. |
| Acknowledge | Open the alert and press **I'm responding — acknowledge alert** | The acknowledgement records who and when, escalation stops, and the parent is told someone is responding. |
| Dedupe | Re-deliver the same `update_id` | Still only one request (see `npm run bot:simulate -- --update-id …`). |

**Without Telegram** (dev only; requires `NOTIFY_CHANNEL="console"` and the dev server running). On Git Bash, prefix commands with `MSYS_NO_PATHCONV=1` so `/link` isn't rewritten into a path:

```bash
npm run bot:simulate -- --from 222000222 "/link CHILDCODE"
```

```bash
npm run bot:simulate -- --from 111000111 "/link PARENTCODE"
```

```bash
npm run bot:simulate -- --from 111000111 "I need an electrician to check my bedroom fan"
```

```bash
npm run bot:simulate -- --from 111000111 SOS
```

---

## 7. Tests

```bash
npm test
```

The test suite creates a throwaway SQLite file and applies the real migrations. Set `TEST_DATABASE_URL` to a `file:` URL to reuse one. Telegram, Gemini and the clock are mocked, so no paid API calls are made.

| # | Requirement | Test |
|---|---|---|
| 1 | Electrician → `home_maintenance` | `intake.test.ts` "1+2+3", `classifier.test.ts` |
| 2 | Appears on the correct household dashboard | `intake.test.ts` "1+2+3" |
| 3 | Child receives the NON-EMERGENCY notification | `intake.test.ts` "1+2+3" |
| 4 | Exact SOS bypasses the LLM | `intake.test.ts` "4", `emergency-detect.test.ts` |
| 5 | Clear phrase triggers the emergency path | `intake.test.ts` "5", `emergency-detect.test.ts` |
| 6 | Invalid LLM JSON doesn't crash or lose the request | `intake.test.ts` "6", "6b", `classifier.test.ts` |
| 7 | Duplicate updates create no duplicates (incl. concurrent) | `intake.test.ts` "7", `webhook.test.ts` |
| 8 | Unauthorized or spoofed sender rejected | `intake.test.ts` "8", "8b" |
| 9 | Child can't read another household's request | `authz-and-pairing.test.ts` "9" |
| 10 | Failed notification recorded and retried safely | `intake.test.ts` "10", "10b" |
| 11 | Emergency stays unacknowledged until acknowledged | `escalation.test.ts` "11" |
| 12 | Unacknowledged alert follows the escalation policy | `escalation.test.ts` "12" + fallback/cancel tests |

### Manual integration test with a real Telegram bot
Use two Telegram accounts, A (child) and B (parent), on a network that can reach `api.telegram.org`.

1. Configure `.env` with the real bot token, `NOTIFY_CHANNEL="telegram"` and `LLM_PROVIDER="gemini"` plus your key. Set `ESCALATION_ACK_TIMEOUT_SECONDS="60"` to make testing quicker.
2. Run `npm run db:deploy` and `npm run dev:all`.
3. Register the child account on the dashboard and link A, then B, as in §5. Check both show **Linked**.
4. From a third account C, message the bot. Expect a *"not linked"* reply and no request on the dashboard.
5. From B, send the electrician message. Within a few seconds the request appears with no page refresh, A receives the NON-EMERGENCY message, and B receives a receipt.
6. From B, send `SOS`. A receives the emergency message with sound (check the device settings in §8), and the dashboard shows the red banner.
7. Don't acknowledge for about 60 seconds. A receives an **ESCALATION (round 1)** message and the timeline shows the round.
8. Acknowledge on the dashboard. B receives *"… has seen your SOS alert"* and no further escalation messages arrive.
9. In A's Telegram, block the bot and send another SOS from B. The dashboard shows the delivery as **Dead**, plus a *Delivery fallback* event and immediate escalation.

---

## 8. Emergency notification limitation (read this)

- SOS alerts are sent as **ordinary, non-silent Telegram messages**. `disable_notification` is always `false` and the text is visually distinctive (🚨, capitals, clear action).
- **A Telegram bot cannot make a phone ring when it is on silent or Do Not Disturb.** Whether an alert plays a sound depends on the recipient's phone and Telegram settings. SAHARA does **not** claim to bypass silent mode and does not try to bypass OS restrictions.
- Each responder should:
  1. Open the SAHARA bot chat and make sure it is **not muted**. Pick a distinctive sound.
  2. In Telegram → Settings → Notifications and Sounds, enable private-chat notifications, previews and sound.
  3. Allow Telegram notifications, sound and lock-screen display in the phone's settings.
  4. Allow Telegram through Do Not Disturb / Focus.
  5. Turn off battery optimisation for Telegram (Android).
- The dashboard's Household page repeats these steps.
- Reliable critical alerts need another channel: a native app with critical-alert entitlements, SMS, or voice calls. Add one by implementing `NotificationChannel` (`src/lib/notifications/channel.ts`).

---

## 9. Security notes
- Secrets come from environment variables only. `.env` is git-ignored and `.env.example` holds placeholders. Nothing secret is exposed to browser code: there are no `NEXT_PUBLIC_*` secrets, config lives in server-only modules, and `src/lib/http.ts` imports `server-only`.
- **Dashboard auth:**
  - Passwords are hashed with scrypt.
  - Sessions use opaque random tokens; only their SHA-256 hash is stored.
  - The cookie is `httpOnly`, `SameSite=Lax` and `Secure` in production.
  - Mutating requests are checked against the same Origin.
- Every request query is scoped to households where the user is a CHILD member. Other households' ids return 404.
- **Rate limits (stored in the SQLite file, for the single app process):**
  - inbound messages per sender
  - pairing attempts
  - logins per IP and per account
  - registrations per IP
- Logs carry ids and outcomes, never message text, tokens or keys, and a redaction filter backs this up. Message text is stored in the database because the dashboard needs it.

---

## 10. Production deployment (Render)

Host this as **one Render web service**. Do not add a Render Postgres database. `render.yaml` describes the service.

1. In Render, create a **Web Service** from this repo (or use the Blueprint). Build command: `npm install && npm run build`. Start command: `npm start`.
2. Set `DATABASE_URL` to `file:../data/sahara.sqlite`. `npm start` creates that file and applies migrations. The escalation worker starts inside the same process.
3. Set `APP_BASE_URL` to the public Render URL (for example `https://sahara.onrender.com`).
4. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, and `GEMINI_API_KEY`. Leave `NOTIFY_CHANNEL=telegram` and `DEMO_MODE=false`.
5. After the service is up, register the webhook with `npm run bot:set-webhook` from a machine that has those env vars. Don't run `bot:poll` in production.
6. **The SQLite file is less persistent on purpose.** Render's disk is wiped on restart and on every redeploy, so accounts, messages, and alerts are cleared. That avoids a separate database. Do not run more than one instance.

Monitor `notification_outbox` rows in `DEAD` and `ESCALATED` requests that stay unacknowledged.

---

## 11. Known limitations and remaining work
- **Not built:** service booking, helper dispatch, payments, contacting emergency services.
- **Dashboard updates by polling** (every 3–5 s). SSE or WebSockets would cut latency.
- **Only one dashboard user per household can register directly.** The data model supports several children, but there's no "invite another child to an existing household" flow yet (add the membership directly in the DB for now).
- **No password reset, email verification or MFA.** Pairing codes can be revoked only by generating a new code (which expires the old one).
- **No request lifecycle actions beyond emergency acknowledgement** (e.g. close or resolve a normal request), and no in-app clarification round-trip with the parent.
- **The emergency phrase list is English-only.** Extend `detect.ts` for other languages (Hindi, etc.) and test with real elderly users.
- **Voice notes, photos and location** from Telegram are ignored. Only text is processed.
- **Telegram is the only real channel** (see §8).
- **Delivery is at-least-once.** A worker crash mid-send can occasionally produce a duplicate Telegram message (rows stuck in SENDING are reclaimed after 2 minutes).
- **Data does not survive a Render restart or redeploy.** The SQLite file is stored on the service disk only.
- **Data lifecycle:** decide retention for message text and add a data-export and deletion workflow before handling real users' data.
- **Gemini prompt and labels:** validate the prompt and the confidence threshold (`LLM_MIN_CONFIDENCE`) against real messages. Consider an evaluation set.
