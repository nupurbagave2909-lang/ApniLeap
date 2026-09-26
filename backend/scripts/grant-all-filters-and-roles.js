const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const jiraService = require('../services/jira.service');

const NUPUR_ACCOUNT_ID = '712020:b45f0add-c266-4481-8388-fc6d4dac8035';
const ADMIN_GROUP = 'jira-admins-apnileap-portfolio';

async function grantAllFiltersAndRoles() {
    console.log('===========================================================');
    console.log('Granting Universal Filter Share Permissions & Admin Roles');
    console.log('===========================================================');

    if (!jiraService.isConfigured()) {
        console.error('Jira is not configured in .env. Exiting.');
        process.exit(1);
    }

    try {
        const { rows: projects } = await pool.query(`
            SELECT p.id, p.project_code, p.title
            FROM projects p
            ORDER BY p.project_code ASC
        `);

        console.log(`Processing ${projects.length} projects...`);
        let count = 0;

        for (const proj of projects) {
            const key = jiraService.deriveJiraKey(proj.project_code);
            console.log(`\n[${proj.project_code}] (${key}): "${proj.title}"`);

            // 1. Get Jira project details
            let jiraProj = null;
            try {
                jiraProj = await jiraService.jiraFetch(`/rest/api/3/project/${key}`);
            } catch (e) {
                console.warn(`  ! Jira project ${key} not found: ${e.message}`);
                continue;
            }

            // 2. Add Nupur & Admin Group to Administrators role
            try {
                const roles = await jiraService.jiraFetch(`/rest/api/3/project/${key}/role`);
                if (roles?.Administrators) {
                    const adminUrl = roles.Administrators.replace(jiraService.baseUrl(), '');
                    await jiraService.jiraFetch(adminUrl, {
                        method: 'POST',
                        body: JSON.stringify({ user: [NUPUR_ACCOUNT_ID] })
                    });
                    try {
                        await jiraService.jiraFetch(adminUrl, {
                            method: 'POST',
                            body: JSON.stringify({ group: [ADMIN_GROUP] })
                        });
                    } catch (ge) {}
                    console.log(`  ✓ Granted Administrators role to Nupur Bagave & ${ADMIN_GROUP}`);
                }
            } catch (roleErr) {
                console.warn(`  ! Could not update roles for ${key}: ${roleErr.message}`);
            }

            // 3. Find Kanban board & update filter share permissions
            try {
                const bRes = await jiraService.jiraFetch(`/rest/agile/1.0/board?projectKeyOrId=${key}`);
                const boards = bRes?.values || [];
                for (const board of boards) {
                    try {
                        const cfg = await jiraService.jiraFetch(`/rest/agile/1.0/board/${board.id}/configuration`);
                        const filterId = cfg?.filter?.id;
                        if (filterId) {
                            const curPerms = await jiraService.jiraFetch(`/rest/api/3/filter/${filterId}/permission`);
                            const hasLoggedin = (curPerms || []).some(p => p.type === 'loggedin');
                            if (!hasLoggedin) {
                                await jiraService.jiraFetch(`/rest/api/3/filter/${filterId}/permission`, {
                                    method: 'POST',
                                    body: JSON.stringify({ type: 'authenticated' })
                                });
                                console.log(`  ✓ Filter ${filterId} (Board ${board.id}): Added "loggedin" share permission`);
                            } else {
                                console.log(`  ✓ Filter ${filterId} (Board ${board.id}): Already shared`);
                            }
                        }
                    } catch (filterErr) {
                        console.warn(`  ! Error updating filter for board ${board.id}: ${filterErr.message}`);
                    }
                }
            } catch (boardErr) {
                console.warn(`  ! Could not fetch boards for ${key}: ${boardErr.message}`);
            }

            count++;
        }

        console.log('\n===========================================================');
        console.log(`Completed successfully for ${count} / ${projects.length} projects!`);
        console.log('===========================================================');

    } catch (e) {
        console.error('Fatal error in grant script:', e);
    } finally {
        await pool.end();
    }
}

grantAllFiltersAndRoles();
