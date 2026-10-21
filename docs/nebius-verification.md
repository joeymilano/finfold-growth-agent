# Nebius × NVIDIA — live verification record

Run on 2026-10-20 against the production Token Factory endpoint, with the
model the app ships by default (`nvidia/nemotron-3-super-120b-a12b`):

```text
$ NEBIUS_API_KEY=... node scripts/verify-nebius.mjs

  NVIDIA models available on this account (5):
    · nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
    · nvidia/Nemotron-3_5-Lightning
    · nvidia/Nemotron-3-Ultra-550b-a55b
    · nvidia/nemotron-3-super-120b-a12b
    · nvidia/Nemotron-3.5-Super-VL
✓ GET https://api.tokenfactory.nebius.com/v1/models is reachable (1603ms)
✓ POST /chat/completions — nvidia/nemotron-3-super-120b-a12b answers (902ms)
  · replied "pong" · usage: 26 prompt + 28 completion tokens
  · completion_tokens_details.reasoning_tokens: 23 (hybrid-reasoning checkpoint)
✓ structured JSON round-trip (product's jsonMode:none path) (2067ms)
  · parsed {"platform":"x","hook":"Capture ideas instantly"}

All Nebius checks passed — the app will route direct-LLM traffic through Nemotron on Nebius.
```

What each step proves:

1. **Runs on Nebius** — every call above hits `https://api.tokenfactory.nebius.com/v1/`, the Nebius Token Factory.
2. **An NVIDIA open-source model answers** — `nvidia/nemotron-3-super-120b-a12b` (NVIDIA Nemotron 3 Super, 120B hybrid MoE) completes both a plain chat turn and the structured-JSON shape the product's generation path uses.
3. The reasoning-token detail confirms the hybrid reasoning architecture is active on the serving side.

Re-run it yourself after cloning:

```bash
NEBIUS_API_KEY=... node scripts/verify-nebius.mjs
```
