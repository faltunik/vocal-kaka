# Benchmarks and reproducibility

All measurements were taken on 4 November 2026, during the work on this repository
(Windows 11, Node 24.17.0), unless a row says otherwise. Every row is labelled **measured**,
**partial** or **not measured**; approximations are written with `~`.

## 1. Automated suite — measured

```bash
npm run typecheck && npm run lint && npm test
```

| Check | Result |
|---|---|
| Jest suites | **65 passing / 65 total** |
| Jest tests | **585 passing / 585 total** |
| TypeScript (`tsc --noEmit`) | **0 diagnostics** |
| ESLint (`expo lint`) | **0 warnings** |

`tests/eval/` is excluded from `npm test` by `package.json`; the live provider harness is run
separately. The suite covers ledger immutability, RLS string-tests, unit conversion, offline
queue retry semantics, staff privacy masking, parchi/PDF math, and the Meta provider contract
(`tests/database/MetaProvider.test.ts`, 18 tests).

## 2. Unit normalization — measured

**Method.** A throwaway Node script (not committed) imported the production `UnitNormalizer`
from `supabase/functions/_shared/units.ts`, loaded `data/units/unitDictionary.json` (90 units),
and called `resolve(quantity, spokenUnit)` for each case below. A case passes only when
`recognized === true`, the base quantity matches exactly, and the base unit matches.
Result: **20 / 20 (100%)**.

There is no `npm` command in this repository that reproduces this table — the script was not
kept. The cases and expected values are listed so the run can be repeated by hand against the
same two files.

| # | Spoken unit | Qty | Expected base | Result |
|---|---|---:|---|---|
| 1 | `bori` | 1 | 50 kg | ✅ |
| 2 | `bori` | 2 | 100 kg | ✅ |
| 3 | `peti` | 1 | 24 pcs | ✅ |
| 4 | `crate` | 5 | 120 pcs | ✅ |
| 5 | `dozen` | 2 | 24 pcs | ✅ |
| 6 | `paav` | 4 | 1 kg | ✅ |
| 7 | `adha paav` | 2 | 0.25 kg | ✅ |
| 8 | `kg` | 2 | 2 kg | ✅ |
| 9 | `gm` | 500 | 0.5 kg | ✅ |
| 10 | `gram` | 250 | 0.25 kg | ✅ |
| 11 | `litre` | 1 | 1 l | ✅ |
| 12 | `ml` | 750 | 0.75 l | ✅ |
| 13 | `quintal` | 1 | 100 kg | ✅ |
| 14 | `katta` | 3 | 75 kg | ✅ |
| 15 | `tray` | 1 | 30 pcs | ✅ |
| 16 | `carton` | 1 | 24 pcs | ✅ |
| 17 | `packet` | 6 | 6 pcs | ✅ |
| 18 | `piece` | 10 | 10 pcs | ✅ |
| 19 | `pauwa` | 2 | 0.5 l | ✅ |
| 20 | `half dozen` | 3 | 18 pcs | ✅ |

Caveat: this is **registry resolution accuracy on 20 curated cases**, not voice accuracy. The
end-to-end path (ASR spelling → model extraction → registry) is a different, harder measurement
and is not claimed here.

## 3. Intent parsing — measured in part

The eval harness (`tests/eval/support/IntentParser.ts`) calls **`openai/gpt-oss-120b` on Groq**
first, then the four OpenRouter fallback models. It does **not** call the Meta parser. The S1
result below is therefore a gpt-oss number, not a Muse Spark number.

| Run | Model | n | Passed | Accuracy |
|---|---|---:|---:|---:|
| Fresh S1 section, 4 Nov 2026 | `gpt-oss-120b` (eval harness) | 15 | 14 | **93.3%** |
| Full corpus, 4 Nov 2026 | — | 248 runnable (34 blocked) | — | **not measured** — provider TPM limit |

Report: `tests/eval/reports/intent-eval.latest.json`, generated `2026-11-04T03:45:54Z` with
`EVAL_SECTIONS=S1 EVAL_DELAY_MS=12000`. The single failure is **S1-008**, a canonical-name
miss (`Fortune Refined Oil` → `Fortune Oil`), not an intent or unit error. The full 248-case
run was abandoned at the provider rate limit; the aborts are an infrastructure result, not a
model result.

**Muse Spark measurement.** Separately, a 12-case subset of S1 was run through the production
Muse Spark path on 4 November 2026 with `reasoning_effort: minimal`: **12/12 cases correct
(intent and item), ~1.1 s average**. The public commit message for the `reasoning_effort` change
records the same 12/12 result and the 2.3 s (`low`) / 6.5 s (Spark 1.3, `low`) comparison. No
runner for that subset is included in this repository, so treat it as a manual measurement
rather than a suite.

| Config | Cases correct | Average |
|---|---:|---:|
| **Spark 1.1, `minimal` (shipped)** | 12/12 | **1.1 s** |
| Spark 1.1, `low` | 12/12 | 2.3 s |
| Spark 1.3, `low` | 12/12 | 6.5 s |

`minimal` is the default for that reason. The request body, including the `prompt_cache_key`,
is built in `supabase/functions/_shared/meta.ts`.

## 4. Latency — partial

| Stage | Result | n | Status |
|---|---|---:|---|
| ASR, Whisper large-v3 on Groq (provider round trip, pre-Meta build) | p50 **314 ms**, p95 **473 ms** | 7 usable | **partial** |
| Parse, Muse Spark 1.1, `reasoning_effort: minimal` | **~1.1 s average** | 12 | **manual run** |
| Live `npm run meta:smoke` | **1.1–2.9 s** across calls; the committed fixture records **2,747 ms** | — | observed |
| Parse, `gpt-oss-120b` on Groq (pre-Meta build) | p50 7.06 s, p95 10.22 s | 7 | **partial, not the current path** |
| End-to-end provider time on that pre-Meta build | p50 7.36 s, p95 10.64 s | 7 | **partial, not a Spark number** |

The ASR sample is 7 usable calls out of 20 attempted: **13 calls aborted on HTTP 429** during
the burst. That makes the p95 a smoke signal, not a p95 you should plan against. The ASR row
predates the Meta tier and the forced `language=hi` field; it is the same Whisper large-v3
model.

The 7.36 s / 10.64 s end-to-end figures come from the Groq-primary build measured **before the
Meta tier existed**, with `gpt-oss-120b` parsing and rate-limit backoff inside the timed
window. They must not be added to, or paired with, the ~1.1 s Spark parse figure. **No
end-to-end latency for the Muse Spark path is claimed.**

## 5. Idempotency — measured at the content-key layer

The ledger must never double-apply a retried voice command. Three mechanisms, in order:

1. **Replay short-circuit** — `process-recording` returns the stored result when
   `voice_command_logs.status ∈ {applied, parsed}` and `processed_at` is set, before any
   ASR or model call.
2. **Content hashing** — `contentLedgerIds()` derives `${recordingId}:${fnv1a(type|payload)}:${occurrence}`,
   so the same action at the same occurrence can only ever produce one id.
3. **Advisory lock + unique constraint** — an advisory transaction lock on the ledger key plus
   the unique index on `(store_id, ledger_event_id)`.

| Scenario | Attempts | Unique ledger ids |
|---|---:|---:|
| Same recording replayed 3× (content-key function) | 15 action attempts | **5** |
| Same five actions, different recording | 5 | **5** (0 overlap, by design) |

Reproduced on 4 November 2026 by calling the production `contentLedgerIds()` three times with
the same five actions and `recording_id`: 15 id attempts → 5 unique ids, identical arrays
across runs, order-independent; the same actions under a different `recording_id` produce five
new ids with 0 overlap. **This is not a database row-count measurement.** The DB-side guarantee
rests on the unique index and the advisory lock, which are covered by string-level tests in
`tests/database` — no live database run with duplicate-row counts is included.

Run: `npx jest tests/database` (string-level guarantees) and
`npx jest tests/services/offline` (queue retry semantics).

## 6. Cost per command — not measured

No cost figure is claimed. A live `npm run meta:smoke` logs the provider's `tokens=` count, but
the committed replay fixture does not store usage, and the OpenRouter price for
`muse-spark-1.1` was not re-checked on the submission date. The system prompt is roughly 2.9k
tokens and dominates the input side, so any per-command figure would be driven by it. Do not
quote a dollar amount until a live run records `usage`.

## 7. Reproducing without keys — measured

```bash
npm run meta:smoke -- --replay      # replays fixtures/meta-parse.json, no keys, no network
npm test                            # no network required
```

`fixtures/meta-parse.json` stores the transcript, provider label, transport, latency and parsed
actions from a live Muse Spark call on 4 November 2026 (04:17 UTC). It is a response payload,
not the full HTTP request/response pair, so the replay exercises the parser, validator and
provider-label path, not the network layer.

The app itself is not keyless: it needs a Supabase project, the migrations, and provider keys
in Vault.
