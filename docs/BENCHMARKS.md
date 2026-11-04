# Benchmarks and reproducibility

Everything below was measured on this tree. Where a number is not yet measured it is
labelled **measured** or **not measured** — no estimates are presented as results.

## 1. Automated test suite

```bash
npm run typecheck && npm run lint && npm test
```

| Suite | Result |
|---|---|
| Jest suites | **64 passing** |
| Jest tests | **578 passing** |
| TypeScript (`tsc --noEmit`) | **0 diagnostics** |
| ESLint (`expo lint`) | **0 warnings** |

Coverage includes ledger immutability, RLS string-tests, unit conversion, offline queue
retry semantics, staff privacy masking, parchi/PDF math, and the Meta provider contract.

## 2. Unit normalization

Corpus: 20 hand-written Hinglish commands covering `bori`, `peti`, `crate`, `dozen`,
`paav`, `savaa`, `paune`, `kg`, `gm`, `litre`, plus cross-dimension guards (mass vs volume)
and Devanagari numerals.

| Metric | Result |
|---|---|
| Correct resolution | **20 / 20 (100%)** |
| Cross-dimension mis-pairs | **0** |

Run: `npx jest tests/utils tests/services/ValueBasedSales.test.ts`

## 3. Intent parsing

| Metric | Result |
|---|---|
| Section S1 (15 cases) | **14 / 15 (93.3%)** |
| Full corpus (248 cases) | **not measured** — provider TPM limit cannot absorb 248 × ~4.8k prompt tokens in one run |

The single S1 failure is a canonicalization case (`Fortune Refined Oil` → `Fortune Oil`),
not an intent misclassification. The full-corpus number is deliberately not claimed.

Run: `npm run test:intent` (live provider calls; requires `OPENROUTER_API_KEY`).

## 4. Latency

| Stage | p50 | p95 | n |
|---|---|---|---|
| ASR (Whisper large-v3) | **314 ms** | **473 ms** | 7 |
| Intent (Muse Spark 1.1, `reasoning_effort: minimal`) | **1.1 s** | **1.6 s** | 12 |
| End-to-end voice command | **7.4 s** | **10.6 s** | 7 |

Muse Spark spends most of its time on the ~2.9k-token system prompt and reasoning tokens.
On the S1 eval both Spark models scored 12/12 intent and 12/12 item; latency was dominated by
`reasoning_effort`, not model size:

| Config | Accuracy | Avg |
|---|---|---|
| Spark 1.3, `low` | 12/12 | 6.5 s |
| Spark 1.1, `low` | 12/12 | 2.3 s |
| **Spark 1.1, `minimal`** | **12/12** | **1.1 s** |
| Spark 1.2, `minimal` | 12/12 | 1.6 s |

`minimal` is the default. For reference, gpt-oss-120b on Groq answers the same prompt in
1.0-1.2 s, so the Meta tier costs roughly nothing in latency. `prompt_cache_key` groups requests
so the prefix can cache.

## 5. Idempotency proof

The ledger must never double-apply a retried voice command. Three mechanisms, each testable:

1. **Replay short-circuit** — `process-recording` returns the stored result when
   `voice_command_logs.status ∈ {applied, parsed}` and `processed_at` is set, before any
   ASR or model call.
2. **Content hashing** — `contentLedgerIds()` derives `${recordingId}:${fnv1a(type|payload)}:${occurrence}`,
   so the same action at the same occurrence can only ever produce one id.
3. **Advisory lock + unique constraint** — `pg_advisory_xact_lock(user_id, ledger_event_id)`
   plus the unique index on `(store_id, ledger_event_id)`.

| Scenario | Attempts | Unique ledger ids |
|---|---|---|
| Same recording replayed 3× | 15 action attempts | **5** |
| Same content, different recording | 2 | **2** (intentional: different transactions) |

Run: `npx jest tests/database` (string-level guarantees) and
`npx jest tests/services/offline` (queue retry semantics).

## 6. Cost per voice command

Measured token usage from `npm run meta:smoke`: ~5.2k total tokens on Muse Spark
(2.9k system prompt + catalog hints + reasoning + 1 action).

| Tier | Per command | Per 1,000 |
|---|---|---|
| Muse Spark via OpenRouter ($1.25 / $4.25 per M) | ~$0.004 | ~$4 |
| Llama 3.3 70B open weights ($0.10 / $0.32 per M) | ~$0.0002 | ~$0.20 |
| gpt-oss-120b on Groq | ~$0.0005 | ~$0.50 |

The system prompt dominates. It is a deliberate trade: 2.9k tokens of kirana-specific
rules (units, aliases, negative-scope intents) buy accuracy that a shorter prompt loses.

## 7. Reproducing without keys

```bash
npm run meta:smoke -- --replay      # replays fixtures/meta-parse.json
npm test                            # no network required
```

The replay fixture is the exact request/response pair captured from a live Muse Spark
call, so the keyless path exercises the same parser, validator and provider-label logic.
