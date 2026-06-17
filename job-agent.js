#!/usr/bin/env node

/**
 * AI Job Application Agent
 * Scrapes jobs from JSearch API, customizes resume with Claude, generates emails, logs to Airtable
 */

import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";
import { promises as fs } from "fs";

// ============ CONFIGURATION ============
const CONFIG = {
  // API Keys (from environment variables)
  ADZUNA_APP_ID: process.env.ADZUNA_APP_ID,
  ADZUNA_APP_KEY: process.env.ADZUNA_APP_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  AIRTABLE_API_KEY: process.env.AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID: process.env.AIRTABLE_BASE_ID,

};

// ============ LOGGING & TRACKING ============

let apiRequestCount = 0;

function logApiRequest(service, endpoint) {
  apiRequestCount++;
  console.log(`  [API #${apiRequestCount}] ${service}: ${endpoint}`);
}

// ============ UTILITY FUNCTIONS ============

// Only pass titles that contain at least one of these — everything else is rejected.
// Tuned to Sintu's profile: React/Next.js/TypeScript frontend + full-stack.
const ALLOWED_TITLE_PATTERNS = [
  /\bsoftware engineer/,
  /\bsoftware developer/,
  /\bweb developer/,
  /\bweb engineer/,
  /\bfrontend\b/,
  /\bfront.end\b/,
  /\bfull.?stack/,
  /\breact\b/,
  /\bnext\.?js\b/,
  /\bjavascript\b/,
  /\btypescript\b/,
  /\bui developer/,
  /\bui engineer/,
  /\bapplication developer/,
  /\bapplication engineer/,
  // Broad catch-all — covers "Senior Engineer", "Backend Engineer", etc.
  // Blocked list still filters out data/ml/devops/qa/manager roles.
  /\bengineer\b/,
  /\bdeveloper\b/,
];

// Blocked even if an allowed pattern matches (catches edge cases like "React Sales Engineer").
const BLOCKED_TITLE_PATTERNS = [
  /\bmanager\b/,
  /\bdirector\b/,
  /\bvp\b/,
  /\bhead of\b/,
  /\bprincipal\b/,
  /\bstaff engineer/,
  /\bconsultant\b/,
  /\bsales\b/,
  /\bdata\b/,            // data engineer, data developer, data/ai engineer
  /\bml\b/,
  /\bmachine learning/,
  /\bdevops\b/,
  /\bsre\b/,
  /\bsecurity engineer/,
  /\bembedded\b/,
  /\bfirmware\b/,
  /\bqa\b/,
];

function applyFilters(job) {
  const title = job.job_title.toLowerCase();
  const text = `${title} ${job.job_description}`.toLowerCase();

  const notRelevant = !ALLOWED_TITLE_PATTERNS.some((p) => p.test(title));
  const wrongTitle = BLOCKED_TITLE_PATTERNS.some((p) => p.test(title));

  if (notRelevant || wrongTitle)
    console.log(`  [skip] "${job.job_title}" at ${job.employer_name}`);

  const hasClearance =
    text.includes("security clearance") ||
    text.includes("clearance required") ||
    text.includes("secret clearance") ||
    text.includes("top secret") ||
    text.includes("ts/sci") ||
    text.includes("clearance") ||
    text.includes("defense contractor");

  const tooMuchExp = [
    /\b([6-9]|\d{2,})\+?\s*years?\s+(?:of\s+)?(?:\w+\s+){0,3}experience/,
    /\b([6-9]|\d{2,})\s*-\s*\d+\s*years?\s+(?:of\s+)?(?:\w+\s+){0,3}experience/,
    /experience\s*(?:of\s+)?(?:at\s+least\s+)?([6-9]|\d{2,})\+?\s*years?/,
    /minimum\s+(?:of\s+)?([6-9]|\d{2,})\s*years?/,
  ].some((pattern) => {
    const match = text.match(pattern);
    return match && parseInt(match[1]) > 5;
  });

  return !notRelevant && !wrongTitle && !hasClearance && !tooMuchExp;
}

const ADZUNA_SEARCHES = [
  // Local / hybrid roles
  ["react next.js typescript developer", "Madison WI"],
  ["frontend software engineer",         "Madison WI"],
  ["frontend software engineer",         "Chicago IL"],
  ["full stack react developer",         "Chicago IL"],
  ["software engineer react",            "New York NY"],
  // Remote
  ["react next.js frontend developer remote",   ""],
  ["full stack typescript engineer remote",      ""],
  ["javascript react software engineer remote",  ""],
];

async function fetchAdzunaJobs(query, location) {
  const params = new URLSearchParams({
    app_id: CONFIG.ADZUNA_APP_ID,
    app_key: CONFIG.ADZUNA_APP_KEY,
    what: query,
    results_per_page: "50",
    sort_by: "date",
    max_days_old: "7",
  });
  if (location) params.set("where", location);

  logApiRequest("Adzuna", `"${query}" in "${location || "remote"}"`);
  try {
    const response = await fetch(
      `https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`
    );
    if (!response.ok) {
      const body = await response.text();
      console.error(`❌ Adzuna error: ${response.status} — ${body}`);
      return [];
    }
    const data = await response.json();
    return (data.results || [])
      .map((j) => ({
        job_id: "adzuna-" + j.id,
        job_title: j.title,
        employer_name: j.company?.display_name || "Unknown",
        job_location: j.location?.display_name || location,
        job_description: j.description || "",
        job_apply_link: j.redirect_url || "",
      }))
      .filter(applyFilters);
  } catch (error) {
    console.error("Error fetching Adzuna jobs:", error.message);
    return [];
  }
}

// RemoteOK: job must have at least one of these tags (client-side filter)
const REMOTE_OK_TAGS = ["react", "javascript", "typescript", "next.js", "full-stack", "frontend", "node"];

async function fetchRemoteOKJobs() {
  logApiRequest("RemoteOK", "US remote tech jobs");
  try {
    const response = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "job-search-agent/1.0" },
    });
    if (!response.ok) {
      console.error(`❌ RemoteOK error: ${response.status}`);
      return [];
    }
    const data = await response.json();
    console.log(`  [RemoteOK] ${data.length - 1} total jobs fetched`);
    return data
      .slice(1)
      .filter((j) => j.tags?.some((t) => REMOTE_OK_TAGS.includes(t.toLowerCase())))
      .map((j) => ({
        job_id: "remoteok-" + j.id,
        job_title: j.position,
        employer_name: j.company,
        job_location: j.location || "Remote (US)",
        job_description: j.description || "",
        job_apply_link: j.url || "",
      }))
      .filter(applyFilters);
  } catch (error) {
    console.error("Error fetching RemoteOK jobs:", error.message);
    return [];
  }
}

async function fetchAllJobs() {
  // Adzuna requests run sequentially to avoid 429 rate limiting
  const adzunaResults = [];
  for (const [q, l] of ADZUNA_SEARCHES) {
    const jobs = await fetchAdzunaJobs(q, l);
    adzunaResults.push(...jobs);
    await new Promise((r) => setTimeout(r, 350));
  }
  const remoteOkJobs = await fetchRemoteOKJobs();

  const seen = new Set();
  return [...adzunaResults, ...remoteOkJobs].filter((j) =>
    seen.has(j.job_id) ? false : seen.add(j.job_id)
  );
}

// ============ SEEN-JOBS CACHE (Airtable-backed, works in CI) ============

async function loadSeenJobUrls() {
  if (!CONFIG.AIRTABLE_API_KEY || !CONFIG.AIRTABLE_BASE_ID) return new Set();
  const seen = new Set();
  let offset = null;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    params.append("fields[]", "Job URL");
    if (offset) params.set("offset", offset);
    const response = await fetch(
      `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/Applications?${params}`,
      { headers: { Authorization: `Bearer ${CONFIG.AIRTABLE_API_KEY}` } }
    );
    if (!response.ok) break;
    const data = await response.json();
    data.records?.forEach((r) => { if (r.fields["Job URL"]) seen.add(r.fields["Job URL"]); });
    offset = data.offset ?? null;
  } while (offset);
  return seen;
}

async function generateKeywords(jobTitle, company, jobDescription) {
  const client = new Anthropic();
  const prompt = `Analyze this job description and extract the most important keywords a candidate should include in their resume.

Job: ${jobTitle} at ${company}
Description: ${jobDescription}

Return JSON only:
{
  "tech_skills": ["React", "TypeScript"],
  "tools": ["Docker", "Jira"],
  "methodologies": ["Agile", "CI/CD"],
  "key_phrases": ["cross-functional collaboration", "scalable architecture"]
}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].text.trim()
      .replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    return JSON.parse(text);
  } catch (error) {
    console.error("Error generating keywords:", error);
    return null;
  }
}

function formatKeywords(kw) {
  if (!kw) return "";
  return [
    kw.tech_skills?.length   ? `Tech: ${kw.tech_skills.join(", ")}`       : "",
    kw.tools?.length         ? `Tools: ${kw.tools.join(", ")}`            : "",
    kw.methodologies?.length ? `Methods: ${kw.methodologies.join(", ")}`  : "",
    kw.key_phrases?.length   ? `Phrases: ${kw.key_phrases.join(", ")}`    : "",
  ].filter(Boolean).join("\n");
}

async function generateEmailTemplates(
  jobTitle,
  company,
  jobDescription,
  recruiterName = null
) {
  const client = new Anthropic();

  const prompt = `Generate 3 professional email templates for applying to a job. Keep each under 150 words.

Job Details:
- Company: ${company}
- Title: ${jobTitle}
- Description: ${jobDescription}

Generate:
1. Cold outreach email to recruiter (if no specific recruiter mentioned)
2. Cover letter summary email
3. LinkedIn outreach message (if applicable)

Format as JSON:
{
  "cold_outreach": "email text here",
  "cover_letter": "email text here",
  "linkedin_message": "message text here"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "{}";
    try {
      // Strip markdown code fences if Claude wrapped the JSON in them
      const jsonText = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      return JSON.parse(jsonText);
    } catch {
      return {
        cold_outreach: text,
        cover_letter: text,
        linkedin_message: text,
      };
    }
  } catch (error) {
    console.error("Error generating emails:", error);
    return null;
  }
}

async function logToAirtable(jobData, keywords, emails) {
  if (
    !CONFIG.AIRTABLE_API_KEY ||
    !CONFIG.AIRTABLE_BASE_ID ||
    process.env.NODE_ENV === "test"
  ) {
    console.log("Skipping Airtable logging (no credentials or test mode)");
    return true;
  }

  const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/Applications`;

  const record = {
    fields: {
      Company: jobData.employer_name,
      "Job Title": jobData.job_title,
      Location: jobData.job_location,
      "Job URL": jobData.job_apply_link,
      Status: "Generated",
      "Date Applied": new Date().toISOString().split("T")[0],
      "Visa Sponsorship": true,
      "Keywords": formatKeywords(keywords),
      "Cold Outreach Email": emails?.cold_outreach || "",
      "Cover Letter Email": emails?.cover_letter || "",
      "LinkedIn Message": emails?.linkedin_message || "",
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [record] }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`Airtable error: ${response.status} — ${body}`);
      return false;
    }

    console.log(`✓ Logged to Airtable: ${jobData.job_title} at ${jobData.employer_name}`);
    return true;
  } catch (error) {
    console.error("Error logging to Airtable:", error);
    return false;
  }
}

// ============ MAIN EXECUTION ============

async function main() {
  console.log("🚀 Starting Job Application Agent...\n");

  // Validate required environment variables
  if (!CONFIG.ADZUNA_APP_ID || !CONFIG.ADZUNA_APP_KEY || !CONFIG.ANTHROPIC_API_KEY) {
    console.error(
      "❌ Missing required environment variables: ADZUNA_APP_ID, ADZUNA_APP_KEY, or ANTHROPIC_API_KEY"
    );
    process.exit(1);
  }

  // Fetch jobs from Adzuna + RemoteOK
  console.log("📋 Fetching jobs from Adzuna + RemoteOK...");
  const allJobs = await fetchAllJobs();

  // Dedup against Airtable (works locally and in CI — no local file needed)
  console.log("🔍 Loading already-logged jobs from Airtable...");
  const seenUrls = await loadSeenJobUrls();
  const newJobs = allJobs.filter((j) => !seenUrls.has(j.job_apply_link));
  console.log(`✓ ${allJobs.length} total jobs, ${newJobs.length} new (${allJobs.length - newJobs.length} already logged)`);

  const maxJobs = process.argv.includes("--test") ? 1 : 50;
  let jobs = newJobs.slice(0, maxJobs);
  console.log(`  Processing up to ${maxJobs}: ${jobs.length} queued\n`);

  if (jobs.length === 0) {
    console.log("No matching jobs found today.");
    return;
  }

  // Process each job
  let successCount = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(
      `\n[${i + 1}/${jobs.length}] Processing: ${job.job_title} at ${job.employer_name}`
    );

    // Extract keywords
    console.log("  → Extracting keywords...");
    const keywords = await generateKeywords(job.job_title, job.employer_name, job.job_description);
    if (!keywords) {
      console.log("  ✗ Failed to extract keywords");
      continue;
    }
    console.log(`  ✓ Keywords: ${keywords.tech_skills?.slice(0, 3).join(", ")}...`);

    // Generate emails
    console.log("  → Generating email templates...");
    const emails = await generateEmailTemplates(
      job.job_title,
      job.employer_name,
      job.job_description
    );

    if (!emails) {
      console.log("  ✗ Failed to generate emails");
      continue;
    }

    // Log to Airtable
    const logged = await logToAirtable(job, keywords, emails);

    if (logged) {
      successCount++;
    }

    // Rate limiting to avoid API throttling
    if (i < jobs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`\n✅ Completed! Successfully processed ${successCount}/${jobs.length} applications`);
}

main().catch(console.error);
