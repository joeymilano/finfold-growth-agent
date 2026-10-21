# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Nebius × NVIDIA integration (2026-10-20)

- Nebius Token Factory / AI Studio is now the primary direct-LLM provider (`lib/nebius.ts`). With `NEBIUS_API_KEY` set, NVIDIA Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`, 120B hybrid MoE) fronts the provider chain; everything else becomes outage-only failover. `NEBIUS_API_BASE` / `NEBIUS_MODEL*` overrides supported; non-HTTPS endpoints are rejected outright.
- `scripts/verify-nebius.mjs` verifies the wiring against the live endpoint: model listing, a real Nemotron round-trip, and a structured-JSON call mirroring the product's `jsonMode:none` path.
- `test/nebius.test.ts` (8 cases): chain-front routing, credential gating, endpoint/model overrides, fail-closed parsing, and the paid-tier policy that keeps anonymous extension traffic off prepaid Token Factory credits.


## [1.0.0] - 2026-09-01

- First stable release: workbench generation across 14 platforms, brand memory, growth missions with human approval, outcome tracking, billing, Chrome extension, WeChat mini program, and Cloudflare deployment.
