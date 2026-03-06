# Salient Bug Triage Console

A lightweight internal triage tool for Salient's CS team. Takes a raw bug report, classifies it by failure bucket and severity, surfaces evidence and follow-up questions, and holds for human confirmation before routing to the right engineering team.

## What it does

- Classifies bug reports into five failure buckets: STT, TTS, LLM, Post-call, Infra
- Assigns severity (Sev0–Sev3) based on compliance risk, business impact, and scope
- Generates evidence quotes, confidence justification, and targeted follow-up questions via Claude API
- Dual-routes compliance cases to both the engineering team and Legal / Compliance
- Requires human confirmation before any ticket enters the queue
- Supports human override of bucket and severity with a reason note
- Queue view with status tracking (New → In Review → Routed → Resolved) and filters

## Architecture

**LLM-first classification.** The Claude API reads the raw report and applies the triage heuristic — bucket definitions, severity rubric, escalation paths, scope signals — through language understanding. This handles novel phrasing and edge cases that keyword matching would miss.

**Deterministic compliance precheck.** A small rules layer runs before the LLM call and catches three hard stops that cannot be left to model judgment: legal threats, LEP/language discrimination, and complete outage signals. If any of these fire, the severity is set to Sev0 and the LLM cannot downgrade it.

**Human in the loop.** Nothing routes automatically. Every classification requires a reviewer to confirm or override before it enters the queue.

## Running locally

This is a single-file React artifact. To run it:

1. Clone the repo
2. Open `triage.jsx` in any React environment (Vite, Create React App, or paste directly into [claude.ai](https://claude.ai) as an artifact)
3. Add your Anthropic API key via the **Set API Key** button in the top bar

```bash
# If running with Vite
npm install
npm run dev
```

## API key

The tool calls the Anthropic API directly from the browser. When reviewing:

1. Click **Set API Key** in the top right
2. Paste your `sk-ant-...` key
3. The key is stored in component state only — it is never persisted or sent anywhere except the Anthropic API

Each triage run costs approximately $0.01. Running all 15 test cases costs under $0.20 total.

## Test cases

15 pre-loaded test reports covering the full range of failure types and severities. Access them via the **Quick-select** buttons (#1–#15) on the submit form. No manual input needed for testing.

## Severity reference

| Level | Trigger |
|-------|---------|
| Sev0 | Compliance violation (illegal threat, LEP discrimination) OR complete data loss across all calls |
| Sev1 | Business cannot be completed AND many callers affected. Also: STT misclassification triggering downstream financial/legal action regardless of scope |
| Sev2 | Functional breakage, few callers, workaround exists. System-level degradation that doesn't block business |
| Sev3 | Cosmetic, one-off, no financial or compliance dimension |

## Bucket reference

| Bucket | Routes to | Failure origin |
|--------|-----------|----------------|
| STT | #voice-ai-bugs | Agent mishears or fails to recognize the caller |
| TTS | #voice-ai-bugs | Agent speaks incorrectly — garbled, wrong pronunciation, barge-in failure, latency |
| LLM | #llm-issues | Agent heard correctly but reasoned or responded incorrectly |
| Post-call | #integrations-bugs | Failure after the call ends — CRM, summaries, disposition codes |
| Infra | #infra-oncall | Call cannot connect, complete, or have its data stored |
