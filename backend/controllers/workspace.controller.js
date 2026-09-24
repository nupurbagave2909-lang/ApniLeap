const { pool } = require('../config/db');
const jiraService = require('../services/jira.service');

// Maps Jira status category / status name to ApniLeap workspace task status
function mapJiraStatusToApniLeap(statusObj) {
    const cat = (statusObj?.statusCategory?.name || statusObj?.statusCategory?.key || '').toLowerCase();
    const name = (statusObj?.name || '').toLowerCase();
    if (cat === 'done' || /done|completed|resolved|closed/.test(name)) {
        return 'COMPLETED';
    }
    if (/to-do|to do|todo|backlog|selected for development/.test(name)) {
        return 'TODO';
    }
    if (cat === 'in progress' || cat === 'indeterminate' || /in progress|in-progress|doing/.test(name)) {
        return 'IN_PROGRESS';
    }
    return 'TODO';
}

function mapJiraPriorityToApniLeap(priorityObj) {
    const name = (priorityObj?.name || '').toUpperCase();
    if (name.includes('HIGH') || name.includes('CRITICAL') || name.includes('BLOCKER')) return 'HIGH';
    if (name.includes('LOW') || name.includes('MINOR') || name.includes('TRIVIAL')) return 'LOW';
    return 'MEDIUM';
}

// GET /api/projects/:projectId/workspace-tasks
// Performs live bidirectional sync with Jira if a Jira Board is linked
async function listWorkspaceTasks(req, res, next) {
    try {
        const projectId = req.params.projectId;

        // Fetch jira link if any
        let { rows: jiraRows } = await pool.query(
            `SELECT * FROM jira_links WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [projectId]
        );

        // Auto-detect project key for AL-KLE-023 and AL-KLE-026 if not in jira_links
        let projectKey = jiraRows[0]?.jira_issue_key;
        const projectCode = req.project?.project_code || '';
        if (!projectKey && projectCode) {
            const stripped = projectCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (['ALKLE023', 'ALKLE026'].includes(stripped)) {
                projectKey = stripped;
                // Auto-create jira_link
                await pool.query(
                    `INSERT INTO jira_links (project_id, jira_issue_key, jira_issue_id, link_type)
                     VALUES ($1, $2, $3, 'JIRA_PROJECT')
                     ON CONFLICT DO NOTHING`,
                    [projectId, projectKey, projectKey]
                );
            }
        }

        // Live Sync: Pull updates from Jira board into ApniLeap
        if (projectKey && jiraService.isConfigured()) {
            try {
                const jiraIssues = await jiraService.fetchJiraProjectIssues(projectKey);
                for (const ji of jiraIssues) {
                    const mappedStatus = mapJiraStatusToApniLeap(ji.fields?.status);
                    const mappedPriority = mapJiraPriorityToApniLeap(ji.fields?.priority);
                    const summary = ji.fields?.summary || 'Untitled Task';
                    const desc = jiraService.fromAdf(ji.fields?.description) || '';
                    const assignee = ji.fields?.assignee?.displayName || null;

                    // 1. Sync to workspace_tasks
                    const { rows: matchedTasks } = await pool.query(
                        `SELECT id, status, title FROM workspace_tasks WHERE jira_issue_key = $1 OR (project_id = $2 AND title = $3)`,
                        [ji.key, projectId, summary]
                    );

                    if (matchedTasks.length > 0) {
                        await pool.query(
                            `UPDATE workspace_tasks
                             SET status = $1, title = $2, description = COALESCE(NULLIF($3, ''), description),
                                 priority = $4, assignee_name = COALESCE($5, assignee_name), jira_issue_key = $6, updated_at = now()
                             WHERE id = $7`,
                            [mappedStatus, summary, desc, mappedPriority, assignee, ji.key, matchedTasks[0].id]
                        );
                    } else {
                        await pool.query(
                            `INSERT INTO workspace_tasks (project_id, title, description, status, priority, assignee_name, jira_issue_key)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [projectId, summary, desc, mappedStatus, mappedPriority, assignee, ji.key]
                        );
                    }

                    // 2. If this issue is a synced Challenge, sync its status in the issues table too
                    if (summary.startsWith('[Challenge]')) {
                        const challengeStatus = mappedStatus === 'COMPLETED' ? 'RESOLVED' : mappedStatus === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN';
                        await pool.query(
                            `UPDATE issues SET status = $1, updated_at = now() WHERE jira_issue_key = $2 AND status != $1`,
                            [challengeStatus, ji.key]
                        );
                    }

                    // 3. If this issue is a synced KPI, sync status
                    if (summary.startsWith('[KPI]')) {
                        // Reflect active KPI tracking status
                    }
                }
            } catch (syncErr) {
                console.error(`Live Jira sync error for ${projectKey} (non-fatal):`, syncErr.message);
            }
        }

        let { rows: tasks } = await pool.query(
            `SELECT * FROM workspace_tasks WHERE project_id = $1 ORDER BY created_at ASC`,
            [projectId]
        );

        // Auto-seed starter tasks if project has none yet
        if (!tasks.length) {
            const { rows: students } = await pool.query(
                `SELECT name FROM project_students WHERE project_id = $1 ORDER BY slot ASC`,
                [projectId]
            );
            const s1 = students[0]?.name || 'Lead Student';
            const s2 = students[1]?.name || 'Co-developer';
            const s3 = students[2]?.name || 'System Integrator';
            const pCode = req.project?.project_code || 'PROJ';

            const initial = [
                {
                    title: 'System Architecture & Requirements Baseline',
                    description: 'Draft software architecture specification, state machine diagrams, and component BOM.',
                    status: 'COMPLETED',
                    priority: 'HIGH',
                    assignee: s1,
                    jiraKey: `${pCode}-101`,
                },
                {
                    title: 'Core Module Implementation & Hardware Interfacing',
                    description: 'Implement driver communication protocols, sensor loop acquisition, and error handling pipeline.',
                    status: 'IN_PROGRESS',
                    priority: 'HIGH',
                    assignee: s2,
                    jiraKey: `${pCode}-102`,
                },
                {
                    title: 'Integration Testing, Benchmarking & Acceptance Tests',
                    description: 'Run automated end-to-end regression tests, measure response latency, and compile test sign-off report.',
                    status: 'TODO',
                    priority: 'MEDIUM',
                    assignee: s3,
                    jiraKey: `${pCode}-103`,
                },
            ];

            for (const item of initial) {
                const { rows: newRows } = await pool.query(
                    `INSERT INTO workspace_tasks (project_id, title, description, status, priority, assignee_name, jira_issue_key)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                    [projectId, item.title, item.description, item.status, item.priority, item.assignee, item.jiraKey]
                );
                tasks.push(newRows[0]);
            }
        }

        // Build proper Jira board URL
        let boardUrl = null;
        if (projectKey && jiraService.isConfigured()) {
            boardUrl = `${jiraService.baseUrl()}/jira/software/projects/${projectKey}/boards`;
        }

        res.json({
            tasks,
            jiraLink: projectKey ? {
                key: projectKey,
                url: boardUrl,
                link_type: 'JIRA_PROJECT',
            } : (jiraRows[0] || null),
            project: {
                id: req.project.id,
                projectCode: req.project.project_code,
                title: req.project.title,
                mentorName: req.project.mentor_name,
                themeName: req.project.theme_name,
                ragStatus: req.project.rag_status,
                completionPct: req.project.completion_pct,
            },
        });
    } catch (err) {
        next(err);
    }
}

function canManageWorkspaceTask(user, project) {
    if (!user || !project) return false;
    const roles = user.roles || [];
    const isGuide = roles.includes('FACULTY_MENTOR') && (
        (project.mentor_user_id && project.mentor_user_id === user.id) ||
        (user.fullName && project.mentor_name &&
         project.mentor_name.trim().toLowerCase() === user.fullName.trim().toLowerCase()) ||
        (user.fullName && project.faculty_mentor_name &&
         project.faculty_mentor_name.trim().toLowerCase() === user.fullName.trim().toLowerCase()) ||
        (user.projectIds || []).includes(project.id)
    );
    const isStudent = roles.includes('STUDENT') && (user.projectIds || []).includes(project.id);
    const isAdmin = roles.includes('PLATFORM_ADMIN') || roles.includes('DEPARTMENT_HEAD');
    return isGuide || isStudent || isAdmin;
}

// POST /api/projects/:projectId/workspace-tasks
async function createWorkspaceTask(req, res, next) {
    try {
        if (!canManageWorkspaceTask(req.user, req.project)) {
            return res.status(403).json({ error: 'Only the assigned faculty guide and team students can create workspace tasks.' });
        }

        const projectId = req.params.projectId;
        const { title, description, status, priority, assigneeName, jiraIssueKey } = req.body || {};

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Task title is required.' });
        }

        const validStatus = ['TODO', 'IN_PROGRESS', 'COMPLETED'];
        const taskStatus = validStatus.includes(status) ? status : 'TODO';

        const validPriority = ['LOW', 'MEDIUM', 'HIGH'];
        const taskPriority = validPriority.includes(priority) ? priority : 'MEDIUM';

        const pCode = req.project?.project_code || 'PROJ';
        let key = jiraIssueKey ? jiraIssueKey.trim() : null;

        // Try to create in Jira if Jira is linked
        if (!key && jiraService.isConfigured()) {
            const { rows: links } = await pool.query(
                `SELECT jira_issue_key FROM jira_links WHERE project_id = $1 AND link_type = 'JIRA_PROJECT' LIMIT 1`,
                [projectId]
            );
            const targetKey = links[0]?.jira_issue_key || pCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (targetKey) {
                try {
                    const issue = await jiraService.createWorkspaceTaskIssue(targetKey, title.trim(), description);
                    key = issue.key;
                    // Also transition to initial status if not TODO
                    if (taskStatus !== 'TODO') {
                        await jiraService.updateJiraIssueStatus(key, taskStatus);
                    }
                } catch (e) {
                    console.error('Failed to create Jira workspace issue:', e.message);
                }
            }
        }

        if (!key) {
            key = `${pCode}-${Math.floor(100 + Math.random() * 900)}`;
        }

        const { rows } = await pool.query(
            `INSERT INTO workspace_tasks (project_id, title, description, status, priority, assignee_name, jira_issue_key, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [projectId, title.trim(), (description || '').trim(), taskStatus, taskPriority, (assigneeName || '').trim() || null, key, req.user?.id || null]
        );

        res.status(201).json({ task: rows[0] });
    } catch (err) {
        next(err);
    }
}

// PUT /api/projects/:projectId/workspace-tasks/:taskId
async function updateWorkspaceTask(req, res, next) {
    try {
        if (!canManageWorkspaceTask(req.user, req.project)) {
            return res.status(403).json({ error: 'Only the assigned faculty guide and team students can update workspace tasks.' });
        }

        const { projectId, taskId } = req.params;
        const { title, description, status, priority, assigneeName } = req.body || {};

        const { rows: existing } = await pool.query(
            `SELECT * FROM workspace_tasks WHERE id = $1 AND project_id = $2`,
            [taskId, projectId]
        );
        if (!existing.length) {
            return res.status(404).json({ error: 'Task not found.' });
        }

        const validStatus = ['TODO', 'IN_PROGRESS', 'COMPLETED'];
        const taskStatus = status && validStatus.includes(status) ? status : existing[0].status;

        const validPriority = ['LOW', 'MEDIUM', 'HIGH'];
        const taskPriority = priority && validPriority.includes(priority) ? priority : existing[0].priority;

        const taskTitle = title !== undefined && title.trim() ? title.trim() : existing[0].title;
        const taskDesc = description !== undefined ? description : existing[0].description;
        const taskAssignee = assigneeName !== undefined ? assigneeName : existing[0].assignee_name;

        // Two-way sync: Push status change to Jira
        const currentJiraKey = existing[0].jira_issue_key;
        if (currentJiraKey && jiraService.isConfigured()) {
            if (taskStatus !== existing[0].status) {
                try {
                    await jiraService.updateJiraIssueStatus(currentJiraKey, taskStatus);
                } catch (e) {
                    console.error('Failed to sync status to Jira:', e.message);
                }
            }
            if ((title && title !== existing[0].title) || (description && description !== existing[0].description)) {
                try {
                    await jiraService.updateJiraIssue(currentJiraKey, { summary: taskTitle, description: taskDesc });
                } catch (e) {
                    console.error('Failed to sync title/desc to Jira:', e.message);
                }
            }
        }

        const { rows } = await pool.query(
            `UPDATE workspace_tasks
             SET title = $1, description = $2, status = $3, priority = $4, assignee_name = $5, updated_at = now()
             WHERE id = $6 AND project_id = $7
             RETURNING *`,
            [taskTitle, taskDesc, taskStatus, taskPriority, taskAssignee, taskId, projectId]
        );

        res.json({ task: rows[0] });
    } catch (err) {
        next(err);
    }
}

// DELETE /api/projects/:projectId/workspace-tasks/:taskId
async function deleteWorkspaceTask(req, res, next) {
    try {
        if (!canManageWorkspaceTask(req.user, req.project)) {
            return res.status(403).json({ error: 'Only the assigned faculty guide and team students can delete workspace tasks.' });
        }

        const { projectId, taskId } = req.params;
        const { rowCount } = await pool.query(
            `DELETE FROM workspace_tasks WHERE id = $1 AND project_id = $2`,
            [taskId, projectId]
        );
        if (!rowCount) {
            return res.status(404).json({ error: 'Task not found.' });
        }
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listWorkspaceTasks,
    createWorkspaceTask,
    updateWorkspaceTask,
    deleteWorkspaceTask,
};