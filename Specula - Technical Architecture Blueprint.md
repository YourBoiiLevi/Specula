
> **Audience**: You, your coding agent (Devin, Claude Code, local agent, etc.), and your future self debugging this at midnight. **Philosophy**: Every module is independently testable with mock data. The system fails gracefully. Config drives everything.

> Project name - Specula

---

## 0. Mental Model

```
Internet (sources)
    ↓  RSSHub (Pi, Docker)
    ↓  Feed Fetcher
    ↓  XML → Markdown files (per item)
    ↓  just-bash VFS (in-memory)
    ↓  Gemini 3.0 Flash (primary) / 3.1 Flash Lite (rate limit fallback) [via Vercel AI SDK]
    ↓  Freeform Markdown Report (may include embedded visualisations + media)
    ↓  Report Store (flat files on disk)
    ↓  Static Site Generator → GitHub Pages
    ↓  RSS feed.xml → your RSS reader
```

One pipeline = one topic = one scheduled run = one report. Pipeline count must be a factor of 60 (e.g. 1, 2, 3, 4, 5, 6, 10, 12…). Offsets are auto-calculated by the scheduler.

---

## 1. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS (TypeScript) | Everything is one TS project |
| Package manager | `pnpm` | Monorepo-friendly |
| Scheduling | `node-cron` | Runs in the main process |
| RSS source routing | RSSHub (self-hosted, Docker) | On Pi, port 1200 |
| RSS cache/state | Redis (Docker, via RSSHub compose) | Already included |
| Feed fetching | `fast-xml-parser` + native `fetch` | Parse RSS/Atom → JSON |
| Feed → Markdown | Custom converter | One `.md` file per item |
| AI sandbox | `just-bash` + `bash-tool` | In-memory VFS |
| AI SDK | `ai` (Vercel AI SDK v4+) | Unified provider interface |
| AI model (primary) | `gemini-3.0-flash` | Via `@ai-sdk/google`; 20 RPD on free tier |
| AI model (fallback) | `gemini-3.1-flash-lite` | Triggered automatically on API rate-limit error |
| Report storage | Flat files (`/data/reports/`) | JSON metadata + Markdown body |
| Config UI | Express + lightweight frontend | Web GUI to manage pipelines and settings |
| Static site | Custom SSG (TypeScript, ~200 lines) | Templates + Fuse.js search |
| Hosting | GitHub Pages | Pushed from Pi via SSH |
| RSS output | Generated `feed.xml` | Atom 1.0, one unified feed |
| Config | Single `config.ts` file + `config.json` | Strongly typed; GUI writes to JSON, TS reads it |

---

## 2. Repository Structure

```
situation-monitor/
├── config.ts                  # THE source of truth. Reads from config.json at runtime.
├── config.json                # Written by the Config UI. Git-ignored.
├── config.json.example        # Committed template with placeholder pipelines
├── package.json
├── tsconfig.json
├── .env                       # API keys, never committed
├── .env.example               # Committed template
│
├── src/
│   ├── index.ts               # Entry point. Boots scheduler + config UI server.
│   ├── scheduler.ts           # node-cron, auto-calculates pipeline offsets
│   ├── pipeline.ts            # One pipeline run: fetch → analyze → store → publish
│   │
│   ├── fetcher/
│   │   └── index.ts           # Fetch N feed URLs, return raw XML strings
│   │
│   ├── parser/
│   │   ├── index.ts           # XML → FeedItem[]. Also deduplication.
│   │   └── toMarkdown.ts      # FeedItem → markdown string
│   │
│   ├── analyzer/
│   │   ├── index.ts           # Load files into just-bash VFS, call Gemini, return report
│   │   └── prompt.ts          # System prompt + user prompt builders
│   │
│   ├── store/
│   │   ├── index.ts           # Read/write reports to /data/reports/{pipeline}/{date}.json
│   │   └── types.ts           # Report, FeedItem, Pipeline types
│   │
│   ├── ssg/
│   │   ├── index.ts           # Main SSG runner. Reads /data/reports, writes /site/
│   │   ├── templates.ts       # HTML template strings (tagged template literals)
│   │   └── search.ts          # Build Fuse.js search index JSON
│   │
│   ├── config-ui/
│   │   ├── server.ts          # Express server: serves GUI + REST API for config CRUD
│   │   └── public/            # Frontend: single-page config editor (vanilla JS or lightweight framework)
│   │
│   └── publisher/
│       └── index.ts           # git add, commit, push to GitHub Pages repo
│
├── data/
│   ├── reports/               # Generated. Git-ignored.
│   │   ├── ai-research/       # (example pipeline — actual names come from your config)
│   │   └── dev-tools/         # (example pipeline)
│   └── seen/                  # Deduplication state. One JSON file per pipeline.
│       └── {pipeline-id}.json # (one file per configured pipeline)
│
├── site/                      # Generated static site. Git-ignored here, pushed to Pages repo.
│
└── docker-compose.yml         # RSSHub + Redis only
```

> Note: no test files are included in the tree. Tests are an agent deliverable, not scaffolding you maintain. The `ai-research/` and `dev-tools/` entries in `data/reports/` and `data/seen/` are illustrative examples — actual directories mirror whatever pipelines you configure.

---

## 3. Configuration Schema

Everything is driven by `config.ts`, which reads `config.json` at runtime. The Config UI (§4.9) writes to `config.json`. You never need to hand-edit it — but the schema is here so you and the agent understand what it contains.

```typescript
// config.ts — reads config.json and exports a validated, typed config object

export interface FeedGroup {
  id: string;       // e.g. "openai-blog"
  label: string;    // Human readable, e.g. "OpenAI Blog"
  url: string;      // Full RSSHub or native RSS URL
}

export interface Pipeline {
  id: string;           // e.g. "ai-research" — used as directory name, URL slug
  label: string;        // e.g. "AI Research" — displayed in UI and reports
  description: string;  // What this pipeline monitors; fed to the AI as context
  feedGroups: FeedGroup[];
  focusInstructions?: string; // Optional extra prompt instructions for this pipeline's angle
}

export const config = {
  // Scheduler
  // Pipeline count MUST be a factor of 60 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60).
  // offsetMinutes is NOT set per pipeline — the scheduler auto-calculates it:
  //   offset[i] = Math.round((60 / pipelines.length) * i)
  intervalHours: 1,

  // AI
  primaryModel: "gemini-3.0-flash",
  fallbackModel: "gemini-3.1-flash-lite",  // Used automatically on rate-limit API error
  // you can potentially add a safety cap for the VFS if and only if you deem it necessary
  thinkingLevel: "low",                     // "minimal" | "low" | "medium" | "high"

  // Publisher
  siteRepoPath: "/home/pi/situation-monitor-site", // Local clone of Pages repo
  githubPagesUrl: "https://yourusername.github.io/situation-monitor",

  // RSS output
  feedTitle: "Specula",
  feedDescription: "Hourly AI-synthesized intelligence on tech and AI",

  // Config UI
  configUiPort: 3001,  // Port for the local web-based config editor

  pipelines: [
    {
      id: "ai-research",
      label: "AI Research",
      description: "Cutting-edge AI research papers, model releases, and technical breakthroughs",
      feedGroups: [
        {
          id: "arxiv-cs-ai",
          label: "arXiv CS.AI",
          url: "http://localhost:1200/arxiv/search?query=cs.AI&type=arxiv_id",
        },
        {
          id: "openai-blog",
          label: "OpenAI Blog",
          url: "https://openai.com/blog/rss.xml",
        },
      ],
    },
    {
      id: "dev-tools",
      label: "Dev Tools & Infra",
      description: "Developer tooling, AI coding assistants, infrastructure, open source releases",
      feedGroups: [
        {
          id: "github-trending",
          label: "GitHub Trending",
          url: "http://localhost:1200/github/trending/daily/any",
        },
        {
          id: "hn",
          label: "Hacker News",
          url: "http://localhost:1200/hackernews/best",
        },
      ],
    },
    // Add more pipelines as needed — count must stay a factor of 60
  ] satisfies Pipeline[],
};
```

> No `limit` per feed group. The `maxItemsPerRun` global cap handles total volume. Feed groups pull their natural item count.

---

## 4. Module Specifications

### 4.1 Scheduler (`scheduler.ts`)

Uses `node-cron`. On boot, reads all pipelines from config and registers a cron job for each.

```
Logic:
- n = pipelines.length  (must be a factor of 60; validate at startup and throw if not)
- offsetMinutes[i] = Math.round((60 / n) * i)
  Examples:
    2 pipelines → offsets: 0, 30
    3 pipelines → offsets: 0, 20, 40
    4 pipelines → offsets: 0, 15, 30, 45
    6 pipelines → offsets: 0, 10, 20, 30, 40, 50

- For each pipeline at index i:
  - Schedule: `${offsetMinutes[i]} * * * *`
  - On trigger: call pipeline.run(pipeline)
  - If a run is already active for this pipeline, skip and log warning
```

**Key invariant**: Pipelines never run concurrently with themselves. No queue needed — just a per-pipeline mutex flag.

### 4.2 Feed Fetcher (`fetcher/index.ts`)

```
Input:  FeedGroup[]
Output: { group: FeedGroup, xml: string }[]

- Fetch all URLs in parallel (Promise.all)
- Timeout: 10s per request
- On fetch failure: log error, return empty for that group (don't crash the pipeline)
- User-Agent: set a descriptive string, e.g. "Specula/1.0"
```

### 4.3 Parser (`parser/index.ts` + `toMarkdown.ts`)

```
Input:  { group: FeedGroup, xml: string }[]
Output: FeedItem[]

FeedItem = {
  id: string          // guid or link hash
  title: string
  link: string
  content: string     // description/content stripped of HTML tags (full content, no truncation)
  publishedAt: Date
  source: string      // group.label
  sourceUrl: string   // group.url
}
```

Deduplication: On each run, load `data/seen/{pipeline.id}.json` (a Set of item IDs from the last 48 hours). Filter out any items already in the set. After analysis, update the set with new IDs. Prune IDs older than 48h.

`toMarkdown.ts`: Converts a FeedItem to a clean markdown string:

```markdown
## {title}
**Source**: {source} | **Published**: {publishedAt}
**Link**: {link}

{content}
```

### 4.4 AI Analyzer (`analyzer/index.ts`)

This is the heart of the system.

```
Input:  FeedItem[], Pipeline config
Output: string (markdown report, may include embedded HTML visualisations and media)

Steps:
1. Build files object: { "/feeds/{item.id}.md": toMarkdown(item) }
   for all items (up to config.maxItemsPerRun)

2. Also add "/index.md" = a table of all files with title + source

3. Create bash tool: createBashTool({ files })

4. Attempt with primary model (gemini-3.0-flash):
   - Call Vercel AI SDK generateText()
   - model: google("gemini-3.0-flash")
   - tools: { bash: bashTool }
   - maxSteps: 10  (allow multi-step tool use)
   - system: buildSystemPrompt(pipeline)
   - prompt: buildUserPrompt(pipeline, itemCount)

5. On rate-limit API error (429 / quota exceeded): retry with fallback model (gemini-3.1-flash-lite).
   Log the fallback clearly.

6. Return result.text
```

> The just-bash VFS keeps all content in-memory and Gemini's 1M token context window is large enough to handle the full item set without truncation. Do not truncate item content.

**System Prompt** (`prompt.ts`):

```
You are an expert technology intelligence analyst. You have been given access to
a bash filesystem containing {N} feed items from {pipeline.label} sources,
covering: {pipeline.description}.

Your task: Write a comprehensive intelligence briefing as flowing, narrative prose.
Do NOT use bullet points. Write like a senior technology journalist writing for
a technical audience.

Structure your report with natural sections (use ## headers):
- Lead: The single most important development and why it matters
- Key Developments: 2-4 major themes/stories, each in narrative form
- Under the Radar: Interesting items that may not get mainstream attention
- Signals: Patterns, trends, or early indicators worth watching

For EACH significant claim, inline a source reference as markdown: [Source Name](url)
Links must come from the actual feed items, not invented.

RICH MEDIA: You may embed the following directly in your report where they add value:

1. Interactive HTML visualisations — wrap in a fenced html block:
   \`\`\`html
   <div style="..."><!-- self-contained chart, table, or diagram --></div>
   <script>/* vanilla JS or CDN library from cdnjs.cloudflare.com */</script>
   \`\`\`
   The SSG will render these as live inline widgets. Keep them self-contained.
   Use only CDN libraries from cdnjs.cloudflare.com. No gradients or shadows.
   Dark-mode safe: use CSS variables or explicit dark colours.
   Good uses: trend charts, comparison tables, timelines, data distributions.

2. Images — standard markdown: ![alt text](https://...)
   Use only URLs that appeared in feed items. No invented image URLs.

3. Iframes — for embedding external URLs referenced in items:
   \`\`\`iframe
   https://example.com/some-referenced-page
   \`\`\`
   Use sparingly; only for directly relevant external content.

Use the bash tool to explore the filesystem. Start with `cat /index.md` to see
all available items, then use `cat`, `grep`, or `ls` to read specific files.
You do not need to read every file — focus on what seems most important.

{pipeline.focusInstructions if set}
```

**User Prompt**:

```
It is {currentDateTime} UTC. Analyze the {N} feed items in the filesystem
and write your briefing for the {pipeline.label} pipeline.
```

### 4.5 Report Store (`store/index.ts`)

Reports are stored as flat files. No database.

```
Path: data/reports/{pipeline.id}/{YYYY-MM-DD-HH-mm}.json

Report JSON = {
  id: string                    // "{pipeline.id}-{timestamp}"
  pipelineId: string
  pipelineLabel: string
  generatedAt: string           // ISO timestamp
  itemCount: number
  modelUsed: string             // "gemini-3.0-flash" or "gemini-3.1-flash-lite" (whichever ran)
  sources: { label, url }[]     // Deduplicated list of sources used
  body: string                  // The raw markdown report (may include fenced html/iframe blocks)
  wordCount: number
}
```

The store also exposes:

- `listReports(pipelineId?, limit?)` — for SSG and RSS generation
- `getReport(id)` — for individual report pages

### 4.6 Static Site Generator (`ssg/index.ts`)

Reads all reports from disk. Outputs to `/site/`. Called at the end of every pipeline run (and can be called standalone).

**Output structure:**

```
site/
├── index.html              # Latest reports, all pipelines, tabbed
├── feed.xml                # Unified Atom feed (all pipelines)
├── search-index.json       # Fuse.js index for client-side search
├── reports/
│   ├── {report-id}.html    # Individual report page
│   └── ...
├── pipelines/
│   ├── ai-research.html    # Archive for one pipeline (paginated)
│   └── ...
└── assets/
    ├── style.css
    ├── app.js              # Search, UI logic
    └── fuse.min.js
```

**Features:**

| Feature | Implementation |
|---|---|
| Pipeline tabs | Pure CSS tab pattern on index.html |
| Per-report page | Markdown → HTML via `marked` library |
| Embedded HTML visualisations | Fenced ` ```html ` blocks rendered as live `<div>` containers; scripts re-executed client-side after injection |
| Embedded iframes | Fenced ` ```iframe ` blocks rendered as `<iframe>` elements with `sandbox` attribute |
| Embedded images | Standard markdown images, rendered as `<img>` |
| Source links | Extracted from report JSON, rendered as a sidebar |
| Search | Fuse.js, client-side, index rebuilt on each SSG run |
| Timeline view | `/timeline.html` — all reports across all pipelines, chronological |
| Dark mode | CSS `prefers-color-scheme` media query (dark only — no light mode needed) |
| RSS badge | Link to `/feed.xml` on every page |

> Visualisation embedding is inspired by [Claude's generative UI approach](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui): the AI emits self-contained HTML/JS blocks as part of its text output, and the renderer injects them as live DOM. Script tags are re-executed after innerHTML injection (clone and replace, as the browser won't auto-execute scripts set via innerHTML). The same CDN allowlist principle applies: `cdnjs.cloudflare.com` only.

**Design direction**: The site should feel like a high-end intelligence terminal. Monospace headers, stark contrast, dense information, no decorative fluff. Not a blog. Every pixel earns its place. Geist and Geist Mono from Google Fonts. Dark mode only.

### 4.7 RSS Feed Generator

Built into the SSG. Generates `site/feed.xml` as Atom 1.0.

```xml
<!-- One <entry> per report -->
<entry>
  <id>https://.../{report-id}</id>
  <title>[AI Research] 2026-04-07 14:00 UTC</title>
  <updated>{generatedAt}</updated>
  <link href="https://.../{report-id}.html"/>
  <summary>{first 300 chars of report body, plain text}</summary>
  <category term="{pipelineId}"/>
</entry>
```

Your RSS reader polls this feed. New report = new entry = notification.

### 4.8 Publisher (`publisher/index.ts`)

```
Steps:
1. Run SSG (regenerate entire site)
2. Copy site/ contents into siteRepoPath/
3. cd siteRepoPath
4. git add -A
5. git commit -m "report: {pipeline.label} @ {timestamp}"
6. git push origin main

Implementation: Node's child_process.execSync or the `execa` package.
Failure: log error, do NOT crash the pipeline. A failed push just means the
site is temporarily stale — the report is safely stored on disk.
```

### 4.9 Config UI (`config-ui/server.ts`)

A lightweight local web server providing a GUI to manage `config.json`. Runs alongside the main process on a separate port (default: 3001). Accessible from your browser on the same network as the Pi.

```
Routes:
  GET  /                     → Serve the config editor frontend
  GET  /api/config           → Return current config.json
  POST /api/config           → Validate and write config.json, trigger scheduler reload
  GET  /api/status           → Last run time, item counts, errors per pipeline
  POST /api/run/:pipelineId  → Manually trigger a pipeline run

Frontend features:
  - Add / edit / delete pipelines (id, label, description, focusInstructions)
  - Add / edit / delete feed groups within each pipeline (id, label, url)
  - Edit global settings (models, interval, publisher paths, feed metadata)
  - Live validation: flag non-factor-of-60 pipeline counts before save
  - Status panel: last run per pipeline, model used, item count, any errors
```

The scheduler watches `config.json` for changes (via `fs.watch`) and reloads on write. No restart required.

---

## 5. Data Flow (One Pipeline Run)

```
Cron trigger (offset auto-calculated, e.g. :15 for pipeline index 1 of 4)
    │
    ▼
fetcher.fetch(pipeline.feedGroups)
    → parallel HTTP GET to RSSHub (localhost:1200) + any native RSS URLs
    → returns raw XML per group
    │
    ▼
parser.parse(xmlResults)
    → XML → FeedItem[] (full content, no truncation)
    → load seen/{pipeline.id}.json
    → filter out already-seen items
    → convert remaining to markdown files
    │
    ▼  [if 0 new items: log "nothing new", skip AI call, exit]
    │
    ▼
analyzer.analyze(items, pipeline)
    → build just-bash VFS with one .md file per item
    → call Gemini 3.0 Flash with bash tool (fallback to 3.1 Flash Lite on 429)
    → AI explores filesystem, writes report (may embed HTML visualisations / images / iframes)
    → return report markdown string
    │
    ▼
store.save(report)
    → write data/reports/{pipeline.id}/{timestamp}.json (includes modelUsed field)
    → update data/seen/{pipeline.id}.json
    │
    ▼
publisher.publish(pipeline)
    → ssg.generate() — full site rebuild from all stored reports
    → git commit + push to GitHub Pages repo
    │
    ▼
Done. Elapsed time: ~30-90 seconds typical.
```

---

## 6. Infrastructure (Pi 5, Docker)

### `docker-compose.yml` (on Pi)

```yaml
version: "3.8"
services:
  rsshub:
    image: diygod/rsshub:latest
    restart: unless-stopped
    ports:
      - "1200:1200"
    environment:
      - CACHE_TYPE=redis
      - REDIS_URL=redis://redis:6379/
      # Twitter/X (if using)
      - TWITTER_AUTH_TOKEN=${TWITTER_AUTH_TOKEN}
      - TWITTER_CT0=${TWITTER_CT0}
      # Reddit (if using)
      - REDDIT_CLIENT_ID=${REDDIT_CLIENT_ID}
      - REDDIT_CLIENT_SECRET=${REDDIT_CLIENT_SECRET}
    depends_on:
      - redis

  redis:
    image: redis:alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

RSSHub handles its own caching. If your Pi fetches the same feed multiple times (e.g., two pipelines share a feed group), Redis prevents double-hitting the upstream source.

### Process Manager

Use `pm2` to run the main Node.js scheduler process:

```bash
pm2 start dist/index.js --name specula
pm2 save
pm2 startup   # auto-start on Pi reboot
```

### GitHub Pages Setup

Two repos:

1. `situation-monitor` — the source code (private or public, your choice)
2. `situation-monitor-site` — the generated static site, GitHub Pages enabled on `main` branch

On the Pi:

```bash
git clone git@github.com:yourusername/situation-monitor-site.git /home/pi/situation-monitor-site
```

Add Pi's SSH key to GitHub. Publisher commits and pushes to repo 2. Done.

---

## 7. RSSHub Feed URL Reference

Common routes for tech/AI monitoring:

```bash
# Twitter/X (requires auth cookies)
http://localhost:1200/twitter/user/{username}
http://localhost:1200/twitter/list/{userId}/{listId}
http://localhost:1200/twitter/followings/{userId}

# Reddit
http://localhost:1200/reddit/subreddit/MachineLearning
http://localhost:1200/reddit/subreddit/artificial+LocalLLaMA

# GitHub
http://localhost:1200/github/trending/daily/python
http://localhost:1200/github/repos/{user}

# Hacker News
http://localhost:1200/hackernews/best
http://localhost:1200/hackernews/show

# arXiv
http://localhost:1200/arxiv/search?query=LLM&type=all

# YouTube channels
http://localhost:1200/youtube/channel/{channelId}

# Native RSS (pass through fetcher directly, skip RSSHub)
https://openai.com/blog/rss.xml
https://www.anthropic.com/rss.xml
https://bair.berkeley.edu/blog/feed.xml
```

Twitter/X is the hardest: you need to extract `auth_token` and `ct0` cookies from your logged-in browser session. RSSHub docs explain this. **Do this setup manually on the Pi before handing anything to an agent.**

---

## 8. Vibecoding Strategy

### The Split

| What | Where | Why |
|---|---|---|
| Twitter/X cookie extraction | You, manually | Can't automate, requires your account |
| Docker setup on Pi | You, following a checklist | One-time, ~20 minutes |
| SSH key for GitHub | You, manually | Auth setup |
| pm2 setup | You, following a checklist | One-time |
| `.env` file population | You | Your secrets |
| **Everything in `src/`** | **Cloud or local agent** | Pure TypeScript, testable, no Pi needed |
| **Config UI (`config-ui/`)** | **Cloud or local agent** | Self-contained Express + frontend |
| **SSG + site templates** | **Cloud or local agent** | Completely self-contained |
| **RSS feed generator** | **Cloud or local agent** | Straightforward |
| **`config.json.example` initial feeds** | **You + agent** | You choose sources, agent formats them |
| Integration testing | You on Pi | Actually running against live RSSHub |

> You have a local coding agent available in addition to cloud agents — use it for tasks that benefit from direct Pi filesystem access or long-running builds. The architectural split above applies to both.

### How to Brief the Agent

Give the agent this architecture document plus these explicit instructions:

1. **"Implement each module in isolation. Do not wire anything together until each module works independently with mock data."** This prevents you from ending up with a monolith that only works end-to-end and is impossible to debug.

2. **"Use mock data for tests."** Provide fixtures: a sample RSS XML file, a sample FeedItem array, a sample report string. The agent should never need network access to run tests.

3. **"The config is not your job. Leave `config.json.example` with 2 placeholder pipelines and placeholder feed URLs. The human will fill in real URLs via the Config UI."**

4. **"Do not install unnecessary dependencies. Keep `node_modules` lean."** Agents love adding packages.

5. **"The SSG and Config UI are separate deliverables. Complete them after all pipeline modules are tested."** Prevents scope creep.

6. **"The Config UI runs on port 3001. It reads and writes `config.json`. The scheduler hot-reloads on file change."**

### What Could Go Wrong (and How to Prevent It)

| Risk | Mitigation |
|---|---|
| Agent invents feed URLs | Fixtures only in tests. Real URLs come from you via Config UI. |
| just-bash VFS too large | `config.maxItemsPerRun` cap. Log item count every run. |
| Primary model rate limit (20 RPD free tier) | Auto-fallback to `gemini-3.1-flash-lite` on 429; log clearly. |
| Git push fails silently | Publisher logs stdout/stderr of every git command. |
| Pipeline runs overlap | Per-pipeline mutex flag checked before every run. |
| Gemini API key exposed | `.env` + `.gitignore` enforced from day one. |
| Twitter cookies expire | RSSHub returns error → fetcher logs it → pipeline continues without that source. |
| Pi reboots, loses state | `data/` directory is persistent on Pi's filesystem. pm2 restarts monitor. |
| Invalid pipeline count (non-factor of 60) | Startup validation throws with a clear error before any cron jobs register. |
| Config UI writes invalid config | Server-side validation before writing `config.json`; returns error to frontend. |
| Embedded HTML visualisation breaks layout | SSG sandboxes injected HTML in a container div; scripts scoped to that container. |

---

## 9. Implementation Phases

### Phase 1: Foundation (Agent Task — ~2-4 hours)

- [ ] Repo scaffold + `tsconfig.json` + `package.json`
- [ ] `types.ts` — all shared types
- [ ] `config.ts` + `config.json.example` — schema with 2 placeholder pipelines
- [ ] `fetcher/` — implemented + tested with mock HTTP
- [ ] `parser/` — implemented + tested with fixture XML
- [ ] `store/` — implemented + tested with temp directory

### Phase 2: AI Integration (Agent Task — ~1-2 hours)

- [ ] `analyzer/` — just-bash VFS loading + Vercel AI SDK call + prompt (with rich media embedding instructions)
- [ ] Model fallback logic: 3.0 Flash → 3.1 Flash Lite on 429
- [ ] Manual test: run analyzer standalone with real Gemini API key

### Phase 3: SSG + Publisher (Agent Task — ~2-3 hours)

- [ ] `ssg/` — all templates, search index, RSS feed
- [ ] SSG rich media rendering: fenced `html` blocks → live widgets, fenced `iframe` blocks → sandboxed iframes
- [ ] `publisher/` — git commands + error handling
- [ ] Standalone SSG test: generate site from fixture reports

### Phase 4: Config UI (Agent Task — ~2-3 hours)

- [ ] `config-ui/server.ts` — Express server, REST API for config CRUD
- [ ] `config-ui/public/` — single-page editor for pipelines and settings
- [ ] Scheduler hot-reload on `config.json` change (`fs.watch`)
- [ ] Factor-of-60 validation on save

### Phase 5: Wiring (Agent Task — ~1 hour)

- [ ] `pipeline.ts` — orchestrates all modules in sequence
- [ ] `scheduler.ts` — node-cron + auto-offset calculation + startup validation
- [ ] `index.ts` — entry point, boots scheduler and Config UI server

### Phase 6: Pi Integration (You — ~2-3 hours one evening)

- [ ] Docker Compose up on Pi
- [ ] Populate `.env` with real API keys + Twitter cookies
- [ ] Open Config UI (`:3001`), add real feed URLs
- [ ] `npm run build && pm2 start`
- [ ] Manually trigger one pipeline, watch logs
- [ ] Verify GitHub Pages site updates

### Phase 7: Polish (Agent Task, optional)

- [ ] Retry logic for failed fetches (exponential backoff)
- [ ] Health endpoint (`/health` HTTP on Config UI server)
- [ ] Better error reporting (write error summaries to report store)
- [ ] `--dry-run` flag (fetch + analyze, don't push)

---

## 10. Notes

- **Full-text article fetching**: RSS feeds sometimes deliver truncated content — this is feed-dependent, not universal. For feeds that do truncate, the analyzer can use `curl` inside the just-bash sandbox to fetch the full article HTML and pipe it through `html-to-markdown` (built into just-bash). This is the right approach if report quality suffers, but adds latency and breaks on paywalled sites. Skip for the initial build; add per-pipeline if needed.

- **Cross-pipeline deduplication**: Decided against. If two pipelines cover the same story, that's fine — different angles, different context.

- **Upgrading to Gemini 3.0 Flash (full, non-lite) everywhere**: The primary is already 3.0 Flash. If the fallback (3.1 Flash Lite) produces noticeably worse reports during rate-limited windows, consider caching or spreading runs to stay within the 20 RPD quota rather than switching models. **Idea:** Add configurability on whether the pipeline should use the primary model or always default to 3.1 Flash Lite.
 
- **Debugging:** Include tests and logs for *everything*.

