import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

// ES Modules __dirname setup
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'ramiu'; // Auto-detected by GitHub Actions or fallback
const OVERRIDE_STATE = process.env.OVERRIDE_STATE; // Local testing option

// Utility function to perform HTTP requests using native https (compatible with any Node version)
function getGitHubEvents(username) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/users/${username}/events/public`,
      method: 'GET',
      headers: {
        'User-Agent': 'Red-October-Profile-App',
        // Use GITHUB_TOKEN if available to avoid API rate limits
        ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {})
      }
    };

    https.get(options, (res) => {
      let data = '';
      
      if (res.statusCode === 403 || res.statusCode === 404) {
        return reject(new Error(`API Error: Status ${res.statusCode}. Rate limited or user not found.`));
      }

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Extract activity parsing logic to reduce Cognitive Complexity
function parseActivity(events) {
  if (!Array.isArray(events)) {
    return { lastPushDate: null, commitsLast24h: 0, latestPushHour: null };
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  let lastPushDate = null;
  let commitsLast24h = 0;
  let latestPushHour = null;

  for (const event of events) {
    if (event.type === 'PushEvent') {
      const eventDate = new Date(event.created_at);
      
      if (!lastPushDate) {
        lastPushDate = eventDate;
        latestPushHour = eventDate.getUTCHours(); // Hour in UTC format
      }

      if (eventDate >= oneDayAgo) {
        commitsLast24h += event.payload?.commits?.length || 0;
      }
    }
  }

  return { lastPushDate, commitsLast24h, latestPushHour };
}

// State selection logic
function determineSubmarineState(events) {
  if (OVERRIDE_STATE) {
    console.log(`[TEST] Forced state override: ${OVERRIDE_STATE}`);
    return OVERRIDE_STATE;
  }

  const { lastPushDate, commitsLast24h, latestPushHour } = parseActivity(events);

  console.log(`[INFO] Completed analysis for user: ${USERNAME}`);
  console.log(`[INFO] Commits in the last 24h: ${commitsLast24h}`);
  console.log(`[INFO] Latest detected push: ${lastPushDate ? lastPushDate.toISOString() : 'None in the last 90 days'}`);

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Rule 1: Sunk (Ghost)
  if (!lastPushDate || lastPushDate < threeDaysAgo) {
    return 'ghost';
  }

  // Rule 2: Silent Running (Chill)
  if (lastPushDate < oneDayAgo) {
    return 'chill';
  }

  // Rule 3: Red Alert (Burnout)
  if (commitsLast24h >= 15) {
    return 'burnout';
  }

  // Rule 4: Night Surface (Night)
  if (latestPushHour !== null && (latestPushHour >= 22 || latestPushHour <= 3)) {
    return 'night';
  }

  // Rule 5: Standard Route (Happy)
  return 'happy';
}

// Main execution with top-level await
try {
  let events = [];
  if (!OVERRIDE_STATE) {
    events = await getGitHubEvents(USERNAME);
  }

  const state = determineSubmarineState(events);
  console.log(`[STATUS] Submarine state set to: ${state.toUpperCase()}`);

  const templatePath = path.join(__dirname, 'templates', `${state}.svg`);
  const outputPath = path.join(__dirname, 'submarine.svg');

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template for state "${state}" not found at: ${templatePath}`);
  }

  // Copy calculated state template to final submarine.svg file
  fs.copyFileSync(templatePath, outputPath);
  console.log(`[SUCCESS] Updated submarine.svg with template: ${state}.svg`);

} catch (error) {
  console.error(`[ERROR] An error occurred during the update:`, error.message);
  // Safe fallback
  try {
    const fallbackPath = path.join(__dirname, 'templates', 'happy.svg');
    const outputPath = path.join(__dirname, 'submarine.svg');
    if (fs.existsSync(fallbackPath) && !fs.existsSync(outputPath)) {
      fs.copyFileSync(fallbackPath, outputPath);
      console.log('[FALLBACK] Restored happy.svg as a safety fallback.');
    }
  } catch (e) {
    console.error('[CRITICAL] Unable to apply safety fallback:', e.message);
  }
  process.exit(1);
}
