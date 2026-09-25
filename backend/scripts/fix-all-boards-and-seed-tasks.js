const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const jiraService = require('../services/jira.service');

async function fixAllBoardsAndSeedTasks() {
    console.log('===========================================================');
    console.log('Starting Universal Jira Board Fix & Tasks Seeding for All Projects');
    console.log('===========================================================');

    if (!jiraService.isConfigured()) {
        console.error('Jira is not configured in .env. Exiting.');
        process.exit(1);
    }

    try {
        const { rows: projects } = await pool.query(`
            SELECT p.*, i.code AS institute_code, d.name AS department_name
            FROM projects p
            JOIN institutes i ON i.id = p.institute_id
            JOIN departments d ON d.id = p.department_id
            ORDER BY p.project_code ASC
        `);

        console.log(`Found ${projects.length} projects in PostgreSQL database.`);

        let successCount = 0;
        let tasksCreatedTotal = 0;

        for (const proj of projects) {
            const key = jiraService.deriveJiraKey(proj.project_code);
            console.log(`\n[${proj.project_code}] (${key}): "${proj.title}"`);

            // 1. Ensure Jira Project & Kanban board WITH location
            let jiraInfo;
            try {
                jiraInfo = await jiraService.ensureJiraProject(proj, pool);
                console.log(`  -> Board Verified: ID=${jiraInfo.boardId}, URL=${jiraInfo.url}`);
            } catch (err) {
                console.error(`  -> Board verification error for ${key}:`, err.message);
                continue;
            }

            // 2. Fetch existing issues in this Jira project
            let existingJiraIssues = [];
            try {
                existingJiraIssues = await jiraService.fetchJiraProjectIssues(key);
            } catch (e) {
                console.warn(`  -> Could not fetch Jira issues for ${key}:`, e.message);
            }

            console.log(`  -> Currently ${existingJiraIssues.length} issues on Jira board.`);

            // 3. If Jira board has no tasks (or fewer than 3), populate tasks
            if (existingJiraIssues.length < 3) {
                const { rows: students } = await pool.query(
                    `SELECT name FROM project_students WHERE project_id = $1 ORDER BY slot ASC`,
                    [proj.id]
                );
                const s1 = students[0]?.name || 'Lead Student';
                const s2 = students[1]?.name || 'Co-developer';
                const s3 = students[2]?.name || 'Validation Engineer';
                const s4 = students[3]?.name || 'Documentation Lead';

                // Check existing workspace_tasks in DB
                const { rows: dbTasks } = await pool.query(
                    `SELECT * FROM workspace_tasks WHERE project_id = $1 ORDER BY created_at ASC`,
                    [proj.id]
                );

                const starterTemplates = [
                    {
                        title: 'System Architecture & Requirements Baseline',
                        description: `Define technical architecture diagrams, component BOM, sensor interfaces, and delivery milestones for "${proj.title}".`,
                        status: 'COMPLETED',
                        priority: 'HIGH',
                        assignee: s1,
                    },
                    {
                        title: 'Core Module Implementation & Hardware Interfacing',
                        description: `Implement algorithm logic, data acquisition loops, interface drivers, and fail-safe handling.`,
                        status: 'IN_PROGRESS',
                        priority: 'HIGH',
                        assignee: s2,
                    },
                    {
                        title: 'Integration Testing, Benchmarking & Acceptance Sign-off',
                        description: `Execute comprehensive regression tests, stress tests under simulated network/load, and verify KPI targets.`,
                        status: 'TODO',
                        priority: 'MEDIUM',
                        assignee: s3,
                    },
                ];

                for (let i = 0; i < starterTemplates.length; i++) {
                    const tmpl = starterTemplates[i];
                    // Check if already in DB or Jira
                    const alreadyInJira = existingJiraIssues.find(ji => ji.fields?.summary?.toLowerCase() === tmpl.title.toLowerCase());
                    let issueKey = alreadyInJira?.key;

                    if (!issueKey) {
                        try {
                            const newIssue = await jiraService.createWorkspaceTaskIssue(key, tmpl.title, tmpl.description);
                            issueKey = newIssue.key;
                            if (tmpl.status !== 'TODO') {
                                await jiraService.updateJiraIssueStatus(issueKey, tmpl.status);
                            }
                            tasksCreatedTotal++;
                            console.log(`    + Created Jira task: ${issueKey} ("${tmpl.title}") -> ${tmpl.status}`);
                        } catch (issueErr) {
                            console.warn(`    ! Failed creating Jira task: ${issueErr.message}`);
                        }
                    }

                    if (!issueKey) {
                        issueKey = `${proj.project_code}-${101 + i}`;
                    }

                    // Upsert into workspace_tasks table
                    const existingDbTask = dbTasks.find(t => t.title?.toLowerCase() === tmpl.title.toLowerCase() || t.jira_issue_key === issueKey);
                    if (existingDbTask) {
                        await pool.query(
                            `UPDATE workspace_tasks
                             SET jira_issue_key = $1, assignee_name = COALESCE(assignee_name, $2), status = $3
                             WHERE id = $4`,
                            [issueKey, tmpl.assignee, tmpl.status, existingDbTask.id]
                        );
                    } else {
                        await pool.query(
                            `INSERT INTO workspace_tasks (project_id, title, description, status, priority, assignee_name, jira_issue_key)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [proj.id, tmpl.title, tmpl.description, tmpl.status, tmpl.priority, tmpl.assignee, issueKey]
                        );
                    }
                }
            } else {
                console.log(`  -> Tasks already present on Jira board (${existingJiraIssues.length} tasks). Skipping task seeding.`);
            }

            successCount++;
        }

        console.log('\n===========================================================');
        console.log(`Universal Board Fix & Task Seeding Complete!`);
        console.log(`Successfully processed: ${successCount} / ${projects.length} projects`);
        console.log(`Total new Jira tasks seeded: ${tasksCreatedTotal}`);
        console.log('===========================================================');

    } catch (e) {
        console.error('Fatal error during board fix script:', e);
    } finally {
        await pool.end();
    }
}

fixAllBoardsAndSeedTasks();
