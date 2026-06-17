import fetch from "node-fetch";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

console.log(`Key starts with: ${(AIRTABLE_API_KEY || "").slice(0, 10)}`);
console.log(`Key length: ${(AIRTABLE_API_KEY || "").length}`);
console.log(`Base ID: ${AIRTABLE_BASE_ID}`);

// Test writing one record
console.log("\n--- Testing record write ---");
const writeRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Applications`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    records: [{
      fields: {
        Company: "Test Company",
        "Job Title": "Test Engineer",
        Location: "Remote",
        "Job URL": "https://example.com",
        Status: "Generated",
        "Date Applied": new Date().toISOString().split("T")[0],
        "Visa Sponsorship": true,
      },
    }],
  }),
});
const writeBody = await writeRes.text();
console.log(`Status: ${writeRes.status}`);
console.log(`Response: ${writeBody}`);
