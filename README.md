# Vocal Kaka

**Speak Hinglish. Your kirana's stock, sales and profit update themselves.**

Vocal Kaka is a voice-first inventory app for Indian corner shops. The shopkeeper says
"do kilo cheeni aaya hai" or "aaj ka profit kya hai"; the app transcribes it, parses it into
ledger actions, updates the shelf, and answers the question from the ledger.

Built for the **Meta Global AI Developer Hackathon 2026** - Indie Developer track -
Theme: **Build for Your World**.

---

## Provenance (read this first)

**What existed before the hackathon.** Vocal Kaka is a private project that started on
**26 January 2026**. Its last pre-hackathon commit is dated **6 October 2026**. That tree is
the baseline: the Expo Router app shell, auth, the Postgres event ledger and its migrations,
multi-store membership and staff roles, inventory and catalog screens, barcode scanning, the
Hinglish unit registry, and a server-side voice pipeline. Work that was in the working tree but
never committed separately - quick counter, analytics, staff mode, invite-code expiry, database
hardening, and the voice function's replay and audio cleanup paths - is part of the code here
too. It has no commit dates of its own, so it is not dated in this document.

**What was built for this submission (26 October - 4 November 2026).**

- **Meta became the reasoning layer of the voice loop.** Every transcript is sent to
  **Muse Spark 1.1** first for structured-output parsing, with **Llama 3.3 70B**
  (Meta open weights) as the first failover, then `gpt-oss-120b` as the reliability floor,
  then the legacy OpenRouter tail. Muse Spark can run through OpenRouter
  (`meta/muse-spark-1.1`, the path the recorded fixture used) or directly against
  `api.meta.ai` (`muse-spark-1.1`): one code path, one env var (`META_TRANSPORT`).
- **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) on the direct transport, behind a
  RIFF/WAVE guard, as the first ASR tier. The app's own recordings do not take this path -
  see the caveat below.
- **A verifiable Meta smoke test** (`npm run meta:smoke`) that prints the same provider label
  the Edge Function stores in `voice_command_logs`, plus a keyless replay mode.
- **18 provider regression tests** (`tests/database/MetaProvider.test.ts`): transport
  resolution, request bodies, envelope validation, the WAV guard and the provider label.
- **Voice pipeline fixes**: an action-verb-biased ASR prompt, a forced Hindi language so
  short Hinglish clips are not detected as another language, a feed refresh after a command,
  and clarification answers for incomplete commands.
- **The submission packaging**: this README, the benchmark notes, the license, a fresh public
  git history, and a repository that carries no provider keys.

**How this repository was created.** This is a **new git history created for this submission**;
its first commit is dated 4 November 2026. The private repository's `.git` directory was not
copied, and **no commit was backdated**. The private repository has its own history: initial
commit 26 January 2026, last pre-hackathon commit 6 October 2026, and the hackathon work
committed there on 4 November 2026. It remains private and is not a remote or parent of this
one.

**What a judge should assume.** The baseline is real, pre-existing product code - not
scaffolding written for the demo. The hackathon delta is the Meta integration, the provider
tests, the voice pipeline fixes and the packaging. The **keyless Meta replay is the reproducible
path** (`npm run meta:smoke -- --replay`: no keys, no network). The app itself does not run
keyless: it needs a Supabase project, the migrations applied, and provider keys in Vault.

---

## The problem

A kirana shop is run by one or two people, standing, for twelve hours, switching between customers,
suppliers and a notebook. Existing inventory software assumes a keyboard, English, barcodes on every
item, and time to fill forms. None of that is true at the counter.

What *is* true:

- The interface they already use is **speech**, in **Hinglish** - "do peti aashirvaad atta aaya",
  "aadha kilo dhaniya bech do", "paav kilo mirchi".
- The units are physical, not abstract: **bori** (50 kg), **peti**, **paav** (0.25), **savaa**,
  **paune**, **dozen**, **crate**.
- They do not want a credit ledger. Udhaar is explicitly **out of scope** - this app is about
  stock truth, not debt.

Vocal Kaka turns one spoken sentence into an append-only ledger event, a stock update, and - when
asked - a plain-language answer. No forms. No barcode required. No English required to speak a
command.

### What you can see in 60 seconds

1. Tap the mic, say **"do kilo cheeni kharida, ek sau bees rupaye"**.
2. The transcript appears; the item is matched; stock goes up by 2 kg.
3. One `PURCHASED` event lands in the ledger; the dashboard and low-stock card update.
4. Say **"aaj ka profit kya hai"** and get an answer, with cost/margin hidden if the active role is staff.

---

## Meta AI integration (the load-bearing part)

| Stage | First choice in code | Failover 1 | Failover 2 |
|---|---|---|---|
| **Intent parsing** | **Muse Spark 1.1** (`meta/muse-spark-1.1` on OpenRouter, or `muse-spark-1.1` directly on `api.meta.ai`) | **Llama 3.3 70B** (`meta-llama/llama-3.3-70b-instruct`, Meta open weights, via OpenRouter) | `openai/gpt-oss-120b` (Groq) |
| **Speech to text** | **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, direct transport, RIFF/WAVE only - not reachable from the app's `.m4a` upload) | **Whisper large-v3** (Groq) - the path the app uses | Nemotron (OpenRouter) |

The parse chain does not stop at the table: after `gpt-oss-120b` it falls through four legacy
OpenRouter models. The full order is in `supabase/functions/_shared/providers.ts`.

When Muse Spark is called through OpenRouter, OpenRouter routes `meta/muse-spark-1.1` to
**Meta itself** (`"provider": "Meta"`, `is_byok: false`) - verified against the live endpoint on
2026-11-04, not inferred from the slug. So the request is served by Meta either way; the
transport only decides whose billing pool it lands in.

**ASR caveat - read this with the table.** In a configured deployment, every command is parsed
by Muse Spark first; the failover chain takes over only if that call fails. **Muse Voice
Transcribe is wired and exercised by `npm run meta:smoke -- --asr <file.wav>` on RIFF/WAVE
input, but phone recordings are AAC (`.m4a`)**, and `transcribeAudio` only offers a filename to
Meta ASR when it ends in `.wav`. So the app's ASR runs on **Whisper large-v3 (Groq)**, with
Nemotron on OpenRouter as the failover. The Meta ASR path is not exercised by the phone.

Why this is not a wrapper:

- **Structured output, not free text.** The request carries a JSON schema generated from the same
  `ACTION_INTENTS` list the validator uses, so the model cannot invent an intent that the ledger
  cannot execute. If the envelope is malformed the call is rejected and the next provider answers.
- **The model is inside the transaction path.** Its output is converted into append-only ledger
  events with content-hash idempotency and an advisory-locked projection - not rendered as prose.
- **Failover is explicit and observable.** `provider`, `provider_used` and `meta_transport` are
  returned on every response; `parse_provider` (which carries the transport and model, e.g.
  `meta:openrouter:muse-spark-1.1`) and `transcript_provider` are persisted to
  `voice_command_logs`, so you can query which model actually handled a command.

```bash
# live: one real Meta call, prints the provider label + parsed actions
npm run meta:smoke

# keyless: replays fixtures/meta-parse.json (no keys, no network)
npm run meta:smoke -- --replay

# direct transport, Muse Voice Transcribe on a RIFF/WAVE file
# (set META_TRANSPORT=direct and MODEL_API_KEY in .env first; the repo's eval WAVs
#  are English TTS smoke clips, not shop recordings)
npm run meta:smoke -- --asr tests/eval/fixtures/audio/check-profit.wav
```

Transport resolution is automatic: `META_TRANSPORT=direct` uses `MODEL_API_KEY` against
`api.meta.ai`; `openrouter` uses `OPENROUTER_API_KEY`; unset defaults to direct when a Meta key
exists, otherwise OpenRouter. `META_MODE=off` is a kill switch.

---

## Architecture

```text
+--------------------------------------------------------------------------------------+
|  Expo app (React Native, SDK 54)                                                     |
|                                                                                      |
|  VoiceOrb --(expo-av recorder)--> OfflineQueue (AsyncStorage, max 50)                  |
|      |                                    |                                          |
|      | upload (user-scoped path)          | retry on reconnect / foreground           |
|      v                                    v                                          |
|  Storage: recordings/<uid>/<id>.m4a  -->  functions.invoke('process-recording')       |
|                                                                                      |
|  Screens: dashboard - inventory - history - analytics - quick counter - low stock     |
|  Data:    Container -> InventoryService -> SupabaseInventoryRepository (RLS-scoped)   |
+------------------------------------------+-------------------------------------------+
                                           | anon key + user JWT
+------------------------------------------v-------------------------------------------+
|  Supabase                                                                            |
|    Postgres                                                                          |
|      events              append-only ledger (VOID, never UPDATE/DELETE)              |
|      handle_new_event()  trigger -> inventory projection + idempotency               |
|      inventory, stores, store_members, unit_registry, voice_command_logs             |
|      RLS: is_store_member(store_id); staff profit masking; owner/admin invariants     |
|    Storage: recordings/ (private, owner-only, deleted after parse)                    |
|    Vault:   groq_api_key, openrouter_api_key, model_api_key (server-side only)        |
|    Edge Functions (Deno)                                                             |
|      process-recording: auth -> replay short-circuit -> ASR -> Muse Spark parse ->    |
|                         validate -> insert events -> trigger projects stock -> answer |
|      resolve-unit:      service-role only; learns unknown units into the registry     |
+--------------------------------------------------------------------------------------+
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

Provider keys live in **Supabase Vault** (the direct Meta transport may instead use the
`MODEL_API_KEY` Edge secret) and are read only by the service-role Edge Function - never in the
client bundle, never in `EXPO_PUBLIC_*`.

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
npm test            # 65 suites, 589 tests
```

Measured on 4 November 2026; method and status for every row are in
[docs/BENCHMARKS.md](docs/BENCHMARKS.md).

| Metric | Result |
|---|---|
| Jest suites / tests | **65 / 589 passing** |
| TypeScript / ESLint | **0 diagnostics / 0 warnings** |
| Unit normalization | **20/20 (100%)** on the resolver corpus - bori, peti, paav, crate, dozen, cross-dimension guards; reproduction method in [docs/BENCHMARKS.md](docs/BENCHMARKS.md) |
| Intent parsing, section S1 | **14/15 (93.3%)** through the repo's eval harness, which calls `gpt-oss-120b` on Groq - **not** the Meta tier; the full 248-case run is TPM-limited and not claimed |
| Muse Spark 1.1, 12-case S1 subset | **12/12 cases correct** (intent and item), ~1.1 s average with `reasoning_effort: minimal` (manual run) |
| ASR latency, Whisper large-v3 | p50 **314 ms**, p95 **473 ms** on 7 usable provider round trips (pre-Meta build); 13 of 20 attempted calls hit HTTP 429, so this is a smoke signal, not a trustworthy p95 |
| Replay idempotency | **0 duplicate content-hash ids** - 3 replays x 5 actions collapse to 5 ids (content-key layer, not a database row-count run) |

Not claimed: full-corpus intent accuracy, voice accuracy on real shop audio, end-to-end latency
for the Spark path, database-level duplicate row counts, and cost per command.
[docs/BENCHMARKS.md](docs/BENCHMARKS.md) labels every row **measured**, **partial** or
**not measured**.

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
