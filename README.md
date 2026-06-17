# Job Search Agent

Automated job search agent that runs daily on GitHub Actions. Fetches relevant software engineering jobs, extracts resume keywords using Claude AI, generates email templates, and logs everything to Airtable.

## What it does

Every weekday at 8 AM Central:

1. Fetches jobs from **Adzuna** and **RemoteOK** matching your target stack (React, Next.js, TypeScript, full-stack)
2. Filters out irrelevant roles (data engineers, managers, DevOps, 6+ years experience, security clearance)
3. Skips jobs already logged to Airtable (no duplicates across runs)
4. For each new job, uses Claude to extract resume keywords (tech skills, tools, methodologies, key phrases)
5. Generates 3 email templates per job (cold outreach, cover letter, LinkedIn message)
6. Logs everything to your Airtable base

## Setup

### 1. Airtable

Create a base called **Job Applications** with a table called **Applications** and these fields:

| Field | Type |
|---|---|
| Company | Single line text |
| Job Title | Single line text |
| Location | Single line text |
| Job URL | URL |
| Status | Single select |
| Date Applied | Date |
| Visa Sponsorship | Checkbox |
| Keywords | Long text |
| Cold Outreach Email | Long text |
| Cover Letter Email | Long text |
| LinkedIn Message | Long text |

### 2. API keys

You need:
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- **Airtable personal access token** — [airtable.com/create/tokens](https://airtable.com/create/tokens) (scopes: `data.records:read`, `data.records:write`)
- **Airtable base ID** — from your base URL: `airtable.com/YOUR_BASE_ID/...`
- **Adzuna API credentials** — [developer.adzuna.com](https://developer.adzuna.com) (free, 250 req/month)

### 3. GitHub Actions

1. Push this repo to GitHub
2. Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `AIRTABLE_API_KEY` | your Airtable PAT |
| `AIRTABLE_BASE_ID` | your base ID |
| `ADZUNA_APP_ID` | your Adzuna app ID |
| `ADZUNA_APP_KEY` | your Adzuna app key |

3. Go to **Actions → Job Search Agent → Run workflow** to test manually

## Local usage

```bash
npm install
# Create .env with the keys listed above
node --env-file=.env job-agent.js --test   # process 1 job
node --env-file=.env job-agent.js          # full run
```

## Customization

**Target locations** — edit `ADZUNA_SEARCHES` in `job-agent.js`

**Title filter** — edit `ALLOWED_TITLE_PATTERNS` and `BLOCKED_TITLE_PATTERNS` in `job-agent.js`

**Schedule** — edit the cron expression in `.github/workflows/job-agent.yml` (currently `0 13 * * 1-5` = 8 AM Central, Mon–Fri)

## Cost

- **Claude API (Haiku):** ~$0.50–2/month depending on job volume
- **GitHub Actions:** Free tier (2,000 min/month)
- **Adzuna:** Free (250 requests/month)
- **RemoteOK:** Free (no limit)
- **Airtable:** Free tier (1,000 records/base)
