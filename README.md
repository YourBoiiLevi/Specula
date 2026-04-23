# Specula

AI-powered RSS intelligence monitor. Specula ingests curated RSS/Atom feeds, runs them through LLM-driven analysis pipelines, and publishes synthesized briefings.

See the architecture blueprint for design details.

## Setup

```
pnpm install && cp config.json.example config.json && cp .env.example .env
```

Then edit `config.json` (or use the Config UI once available) and set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`.
