const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const jiraService = require('../services/jira.service');

async function syncAll() {
    console.log('--- Starting Jira Project & Board Sync for All Projects ---');
    if (!jiraService.isConfigured()) {
        console.error('Jira is not configured in .env!');
        process.exit(1);
    }

    const { rows: projects } = await pool.query(
        `SELECT id, project_code, title FROM projects ORDER BY project_code`
    );
    console.log(`Found ${projects.length} projects in database to verify/provision in Jira.`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        process.stdout.write(`[${i + 1}/${projects.length}] Syncing ${p.project_code}... `);
        try {
            const res = await jiraService.ensureJiraProject(p, pool);
            if (res && res.key) {
                console.log(`OK -> Key: ${res.key}, Board URL: ${res.url}`);
                successCount++;
            } else {
                console.log('Skipped / No key returned');
            }
        } catch (err) {
            console.log(`FAILED: ${err.message}`);
            failCount++;
        }
        // Small delay to be polite to Jira rate limits
        await new Promise(r => setTimeout(r, 400));
    }

    console.log(`\n=== Sync Finished: ${successCount} succeeded, ${failCount} failed ===`);
    process.exit(0);
}

syncAll().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
