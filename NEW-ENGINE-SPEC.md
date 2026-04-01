# V2 AI Engine Spec

## Architecture
- Single LLM call per turn (no planner + composer split)
- LLM receives: system prompt + full KB + conversation history + booking draft
- LLM outputs: structured JSON (reply + action + slots + intent)
- Post-validator checks: service name exists, price matches KB, date/time valid
- 5 files total: types.ts, prompt.ts, engine.ts, validator.ts, index.ts

## File Structure