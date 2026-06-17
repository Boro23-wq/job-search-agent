// Run this ONCE: node auth.js
// It opens Google sign-in in your browser and saves google-token.json

import { google } from "googleapis";
import { promises as fs } from "fs";
import { createServer } from "http";
import { URL } from "url";

const REDIRECT = "http://localhost:3000";
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

const creds = JSON.parse(await fs.readFile("google-oauth-credentials.json", "utf-8"));
const { client_id, client_secret } = creds.installed;

const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT);
const authUrl = auth.generateAuthUrl({ access_type: "offline", scope: SCOPES });

console.log("\n👉 Open this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for you to authorize...\n");

const server = createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) return res.end("No code — try again.");
  res.end("<h1>✅ Done! Close this tab and check your terminal.</h1>");
  server.close();
  const { tokens } = await auth.getToken(code);
  await fs.writeFile("google-token.json", JSON.stringify(tokens, null, 2));
  console.log("✅ Saved google-token.json — auth complete!");
  process.exit(0);
});

server.listen(3000);
