# Vocal Kaka

**Speak Hinglish. Your kirana's stock, sales and profit update themselves.**

Vocal Kaka is a voice-first inventory app for Indian corner shops. The shopkeeper says
"do kilo cheeni aaya hai" or "aaj ka profit kya hai"; the app transcribes it, parses it into
ledger actions, updates the shelf, and answers back — in the language the shop actually runs in.

Built for the **Meta Global AI Developer Hackathon 2026** · Indie Developer track ·
Theme: **Build for Your World**.

---

## Provenance (read this first)

**What existed before the hackathon.** Vocal Kaka is a private project that started on
**26 January 2026**. By **mid-October 2026** it had grown into the baseline in this repository:
the Expo Router app shell, auth, the Postgres event ledger and its migrations, multi-store
membership and staff roles, inventory and catalog screens, barcode scanning, the Hinglish unit
registry, and an initial server-side voice pipeline. The private repository's last commit is dated
**6 October 2026**; an uncommitted delta through **mid-October 2026** (quick counter, analytics,
staff mode, invite-code expiry, database hardening) is included in that baseline.

**What was built for this submission (26 October – 4 November 2026).**

- **Meta became the reasoning layer of the voice loop.** Every transcript is parsed by
  **Muse Spark 1.3** into structured ledger actions (JSON-schema constrained), with
  **Llama 3.3 70B** (Meta open weights) as the first failover, then `gpt-oss-120b` as the
  reliability floor. Muse Spark runs through OpenRouter (upstream provider: *Meta*) or directly
  against `api.meta.ai` — one code path, one env var.
- **A verifiable Meta smoke test** (`npm run meta:smoke`) that prints the same provider label the
  Edge Function stores in `voice_command_logs`, plus a keyless replay mode.
- **The submission packaging**: this README, the architecture docs, the license, a fresh public
  git history, and the secret-scrubbing pass that made this repository publishable.
- **Hardening found by a five-wave audit**: replay short-circuit for duplicate voice retries,
  service-only unit learning, recording-id validation, audio cleanup, fail-closed staff privacy,
  strict legacy scope filters, and 18 new provider regression tests.

**How this repository was created.** This is a **new git history created for this submission in
November 2026**. The private repository's `.git` directory was deliberately not copied, and **no
commit was backdated** — every commit here is dated the day it was made. The dates above describe
when the code was written; they are not forged into git metadata. The private repository remains
private and is not a remote or parent of this one.

**What a judge should assume.** The baseline is real, working, pre-existing product code — not
scaffolding written for the demo. The hackathon delta is the Meta integration, the hardening and
the packaging. Where a claim depends on live infrastructure we cannot ship (a Supabase project,
provider keys), the **keyless Meta replay is the reproducible path** and the hosted demo is the
convenience path.

---

## The problem

A kirana shop is run by one or two people, standing, for twelve hours, switching between customers,
suppliers and a notebook. Existing inventory software assumes a keyboard, English, barcodes on every
item, and time to fill forms. None of that is true at the counter.

What *is* true:

- The interface they already use is **speech**, in **Hinglish** — "do peti aashirvaad atta aaya",
  "aadha kilo dhaniya bech do", "paav kilo mirchi".
- The units are physical, not abstract: **bori** (50 kg), **peti**, **paav** (0.25), **savaa**,
  **paune**, **dozen**, **crate**.
- They do not want a credit ledger. Udhaar is explicitly **out of scope** — this app is about
  stock truth, not debt.

Vocal Kaka turns one spoken sentence into an append-only ledger event, a stock update, and — when
asked — a spoken answer. No forms. No barcode required. No English required.

### What you can see in 60 seconds

1. Tap the mic, say **"do kilo cheeni kharida, ek sau bees rupaye"**.
2. The transcript appears; the item is matched; stock goes up by 2 kg.
3. One `PURCHASED` event lands in the ledger; the dashboard and low-stock card update.
4. Say **"aaj ka profit kya hai"** and get an answer, with cost/margin hidden if the active role is staff.

---

## Meta AI integration (the load-bearing part)

| Stage | Primary | Failover 1 | Failover 2 |
|---|---|---|---|
| **Intent parsing** | **Muse Spark 1.3** (`meta/muse-spark-1.3` via OpenRouter, upstream provider *Meta* — or `muse-spark-1.3` direct on `api.meta.ai`) | **Llama 3.3 70B** (`meta-llama/llama-3.3-70b-instruct`, Meta open weights) | `openai/gpt-oss-120b` (Groq) |
| **Speech → text** | **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, direct transport, RIFF/WAVE) | Whisper large-v3 (Groq) | Nemotron (OpenRouter) |

Why this is not a wrapper:

- **Structured output, not free text.** The request carries a JSON schema generated from the same
  `ACTION_INTENTS` list the validator uses, so the model cannot invent an intent that the ledger
  cannot execute. If the envelope is malformed the call is rejected and the next Meta tier answers.
- **The model is inside the transaction path.** Its output is converted into append-only ledger
  events with content-hash idempotency and an advisory-locked projection — not rendered as prose.
- **Failover is explicit and observable.** `provider`, `provider_used` and `meta_transport` are
  returned on every response and persisted to `voice_command_logs`, so you can query which model
  actually handled a command.

```bash
# live: one real Meta call, prints the provider label + parsed actions
npm run meta:smoke

# keyless: replays fixtures/meta-parse.json (no keys, no network)
npm run meta:smoke -- --replay

# direct transport, Muse Voice Transcribe on a WAV file
META_TRANSPORT=direct npm run meta:smoke -- --asr fixtures/sample.wav
```

Transport resolution is automatic: `META_TRANSPORT=direct` uses `MODEL_API_KEY` against
`api.meta.ai`; `openrouter` uses `OPENROUTER_API_KEY`; unset defaults to direct when a Meta key
exists, otherwise OpenRouter. `META_MODE=off` is a kill switch.

---

## Architecture

```text
┌──────────────────────────── Expo app (React Native, SDK 54) ────────────────────────────┐
│  VoiceOrb ── expo-av recorder ──► OfflineQueue (AsyncStorage, max 50)                     │
│      │                                    │                                              │
│      │ upload (user-scoped path)          │ retry on reconnect / foreground              │
│      ▼                                    ▼                                              │
│  Storage: recordings/<uid>/<recording_id>.m4a      functions.invoke('process-recording') │
│                                                                                          │
│  Screens: dashboard · inventory · history · analytics · quick-counter · low-stock · scanner │
│  Data:    Container → InventoryService → SupabaseInventoryRepository (RLS-scoped)        │
└───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                            │ anon key + user JWT
┌───────────────────────────────────────────▼──────────────────────────────────────────────┐
│ Supabase                                                                                 │
│  Postgres                                                                                │
│    events               append-only ledger (VOID instead of UPDATE/DELETE)               │
│    handle_new_event()   trigger → inventory projection + idempotency                     │
│    inventory, stores, store_members, unit_registry, voice_command_logs                   │
│    RLS: is_store_member(store_id); staff profit masking; owner/admin invariants           │
│  Storage: recordings/ (private, owner-only policies, deleted after parse)                │
│  Vault:   groq_api_key, openrouter_api_key, model_api_key (never in the client bundle)    │
│  Edge Functions (Deno)                                                                   │
│    process-recording: auth → replay short-circuit → ASR → Muse Spark parse →              │
│                       validate → upsert_inventory_movement → spoken answers              │
│    resolve-unit:      service-role only; learns unknown units into the global registry   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Quickstart

### 1. App (needs a Supabase project)

```bash
cp .env.example .env      # EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start            # or: npm run android / npm run ios
```

### 2. Database

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push      # applies supabase/migrations/*.sql
```

### 3. Edge Functions

Provider keys live in **Supabase Vault** and are read only by the service-role Edge Function —
never in the client bundle, never in `EXPO_PUBLIC_*`.

```bash
# store the secrets in Vault (SQL editor, service role)
select vault.create_secret('<key>', 'groq_api_key');
select vault.create_secret('<key>', 'openrouter_api_key');
select vault.create_secret('<key>', 'model_api_key');   -- optional: direct Meta transport

npx supabase functions deploy process-recording resolve-unit --use-api
```

### 4. Verify the Meta path

```bash
npm run meta:smoke            # live
npm run meta:smoke -- --replay
```

---

## Tests and evals

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # 64 suites, 578 tests
```

Measured on this tree:

| Metric | Result |
|---|---|
| Jest suites / tests | **64 / 578 passing** |
| Unit normalization corpus | **20/20 (100%)** — bori, peti, paav, crate, dozen, cross-dimension guards |
| Intent parsing, section S1 | **14/15 (93.3%)** — full 248-case run is TPM-limited; not claimed as corpus-wide |
| ASR latency (7 samples) | p50 **314 ms**, p95 **473 ms** |
| Parse latency (Muse Spark, low reasoning) | **~5.7–6.0 s** on a 2.9k-token system prompt |
| Duplicate ledger events on replay | **0** — 3 replays × 5 actions collapse to 5 unique content-hash ids |

The benchmark methodology, runner spec and the idempotency proof are in `docs/BENCHMARKS.md`.

---

## Repository layout

```text
app/            Expo Router screens (thin; no business logic)
components/     presentational + container UI
services/       business logic, Supabase calls, offline + voice queues
hooks/          data hooks (inventory, analytics, low stock, history)
data/           repositories and scope filters
utils/          pure helpers (units, numbers, parchi/PDF, formatting)
supabase/
  functions/    Deno Edge Functions + shared provider layer
  migrations/   immutable, timestamped SQL
tests/          Jest unit/integration + live eval harness
fixtures/       keyless replay fixtures
```

---

## License

**Source-available, not open source.** Judges and evaluators may read, clone, build and run this
repository to assess the submission. Commercial use, redistribution and derivative works require
written permission. See [LICENSE](LICENSE).
