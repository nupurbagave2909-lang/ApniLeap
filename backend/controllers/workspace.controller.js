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

        // Ensure Jira Project and Kanban board are dynamically resolved/provisioned for ANY project
        let jiraInfo = null;
        if (jiraService.isConfigured() && req.project) {
            try {
                jiraInfo = await jiraService.ensureJiraProject(req.project, pool);
            } catch (e) {
                console.warn('ensureJiraProject warning:', e.message);
            }
        }

        let { rows: jiraRows } = await pool.query(
            `SELECT * FROM jira_links WHERE project_id = $1 AND link_type = 'JIRA_PROJECT' ORDER BY created_at DESC LIMIT 1`,
            [projectId]
        );

        let projectKey = jiraInfo?.key || jiraRows[0]?.jira_issue_key || jiraService.deriveJiraKey(req.project?.project_code);
        let boardUrl = jiraInfo?.url || (projectKey ? `${jiraService.baseUrl()}/jira/software/projects/${projectKey}/boards` : null);


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

                    // 1. If this issue is a Challenge, sync its status in the issues table only
                    if (summary.startsWith('[Challenge]')) {
                        const challengeStatus = mappedStatus === 'COMPLETED' ? 'RESOLVED' : mappedStatus === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN';
                        await pool.query(
                            `UPDATE issues SET status = $1, updated_at = now() WHERE jira_issue_key = $2 AND status != $1`,
                            [challengeStatus, ji.key]
                        );
                        continue; // DO NOT put in workspace_tasks
                    }

                    // 2. If this issue is a KPI, do not put in workspace_tasks
                    if (summary.startsWith('[KPI]')) {
                        continue; // DO NOT put in workspace_tasks
                    }

                    // 3. Regular Tasks only go into workspace_tasks
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
                }
            } catch (syncErr) {
                console.error(`Live Jira sync error for ${projectKey} (non-fatal):`, syncErr.message);
            }
        }

        // Clean up any historical [Challenge] or [KPI] entries mistakenly added to workspace_tasks
        await pool.query(
            `DELETE FROM workspace_tasks WHERE project_id = $1 AND (title ILIKE '[Challenge]%' OR title ILIKE '[KPI]%')`,
            [projectId]
        );

        // Fetch regular tasks
        let { rows: tasks } = await pool.query(
            `SELECT * FROM workspace_tasks WHERE project_id = $1 AND title NOT ILIKE '[Challenge]%' AND title NOT ILIKE '[KPI]%' ORDER BY created_at ASC`,
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

        // Fetch challenges for dedicated Challenges Board
        const { rows: challengeRows } = await pool.query(
            `SELECT i.*, u.full_name AS raised_by_name FROM issues i
             LEFT JOIN users u ON u.id = i.raised_by
             WHERE i.project_id = $1 ORDER BY i.created_at ASC`,
            [projectId]
        );
        const challenges = challengeRows.map(c => {
            let kanbanStatus = 'TODO';
            if (c.status === 'IN_PROGRESS') kanbanStatus = 'IN_PROGRESS';
            else if (c.status === 'RESOLVED' || c.status === 'CLOSED') kanbanStatus = 'COMPLETED';
            return {
                id: c.id,
                title: c.title,
                description: [c.root_cause ? `Root Cause: ${c.root_cause}` : '', c.impact ? `Impact: ${c.impact}` : ''].filter(Boolean).join(' | ') || 'Challenge logged.',
                rawStatus: c.status,
                status: kanbanStatus,
                priority: 'HIGH',
                assignee_name: c.raised_by_name || 'Student',
                jira_issue_key: c.jira_issue_key,
                support_required: c.support_required,
                root_cause: c.root_cause,
                impact: c.impact,
                itemType: 'CHALLENGE'
            };
        });

        // Fetch KPIs for dedicated KPIs Board
        const { rows: kpiRows } = await pool.query(
            `SELECT k.*, u.full_name AS owner_name,
                    (SELECT row_to_json(m) FROM (
                        SELECT measured_value, evidence, measured_at,
                               (SELECT full_name FROM users WHERE id = km.recorded_by) AS recorded_by_name
                        FROM kpi_measurements km WHERE km.kpi_id = k.id
                        ORDER BY km.measured_at DESC LIMIT 1
                    ) m) AS latest_measurement
             FROM kpis k
             LEFT JOIN users u ON u.id = k.owner_user_id
             WHERE k.project_id = $1 ORDER BY k.created_at ASC`,
            [projectId]
        );
        const kpis = kpiRows.map(k => {
            let kanbanStatus = 'TODO';
            if (k.latest_measurement) {
                const targetNum = parseFloat(k.target_value);
                const measuredNum = parseFloat(k.latest_measurement.measured_value);
                if (!isNaN(targetNum) && !isNaN(measuredNum) && measuredNum >= targetNum) {
                    kanbanStatus = 'COMPLETED';
                } else {
                    kanbanStatus = 'IN_PROGRESS';
                }
            }
            return {
                id: k.id,
                title: k.name,
                description: `Target: ${k.target_value || '-'} ${k.unit || ''}${k.latest_measurement ? ` | Measured: ${k.latest_measurement.measured_value} ${k.unit || ''}` : ' (Target Defined)'}`,
                status: kanbanStatus,
                priority: 'MEDIUM',
                assignee_name: k.owner_name || 'Faculty Mentor',
                jira_issue_key: k.jira_issue_key,
                target_value: k.target_value,
                unit: k.unit,
                latest_measurement: k.latest_measurement,
                itemType: 'KPI'
            };
        });

        // Query dedicated board links from DB
        const { rows: chBoardLinks } = await pool.query(
            `SELECT * FROM jira_links WHERE project_id = $1 AND link_type IN ('JIRA_BOARD_CHALLENGES', 'JIRA_BOARD_CHALLENGES_KPIS') ORDER BY created_at DESC LIMIT 1`,
            [projectId]
        );
        const { rows: kpBoardLinks } = await pool.query(
            `SELECT * FROM jira_links WHERE project_id = $1 AND link_type IN ('JIRA_BOARD_KPIS', 'JIRA_BOARD_CHALLENGES_KPIS') ORDER BY created_at DESC LIMIT 1`,
            [projectId]
        );

        const baseUrl = jiraService.baseUrl();
        const tasksBoardUrl = jiraInfo?.tasksBoard?.url || (projectKey && boardUrl ? boardUrl : `${baseUrl}/jira/software/projects/${projectKey}/boards`);
        const combinedBoardId = chBoardLinks[0]?.jira_issue_id || kpBoardLinks[0]?.jira_issue_id;
        const challengesAndKpisBoardUrl = jiraInfo?.challengesAndKpisBoard?.url || jiraInfo?.challengesBoard?.url || (combinedBoardId ? `${baseUrl}/jira/software/projects/${projectKey}/boards/${combinedBoardId}` : `${baseUrl}/jira/software/projects/${projectKey}/boards`);

        res.json({
            tasks,
            challenges,
            kpis,
            jiraLink: {
                key: projectKey,
                url: tasksBoardUrl,
                link_type: 'JIRA_PROJECT',
            },
            challengesJiraLink: {
                key: projectKey,
                url: challengesAndKpisBoardUrl,
                link_type: 'JIRA_BOARD_CHALLENGES',
            },
            kpisJiraLink: {
                key: projectKey,
                url: challengesAndKpisBoardUrl,
                link_type: 'JIRA_BOARD_KPIS',
            },
            challengesAndKpisJiraLink: {
                key: projectKey,
                url: challengesAndKpisBoardUrl,
                link_type: 'JIRA_BOARD_CHALLENGES_KPIS',
            },
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
    const isGov = roles.some((r) =>
        ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'].includes(r)
    );
    if (isGov) return true;

    const isGuide = roles.includes('FACULTY_MENTOR') && (
        (project.mentor_user_id && project.mentor_user_id === user.id) ||
        (user.fullName && project.mentor_name &&
         project.mentor_name.trim().toLowerCase() === user.fullName.trim().toLowerCase()) ||
        (user.fullName && project.faculty_mentor_name &&
         project.faculty_mentor_name.trim().toLowerCase() === user.fullName.trim().toLowerCase()) ||
        (user.projectIds || []).includes(project.id)
    );
    const isStudent = roles.includes('STUDENT') && (user.projectIds || []).includes(project.id);
    return isGuide || isStudent;
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

// PUT /api/projects/:projectId/workspace-challenges/:id
async function updateWorkspaceChallenge(req, res, next) {
    try {
        const { id, projectId } = req.params;
        const { status } = req.body || {};

        let dbStatus = 'OPEN';
        if (status === 'IN_PROGRESS') dbStatus = 'IN_PROGRESS';
        else if (status === 'COMPLETED' || status === 'RESOLVED') dbStatus = 'RESOLVED';
        else if (status === 'TODO' || status === 'OPEN') dbStatus = 'OPEN';

        const { rows } = await pool.query(
            `UPDATE issues SET status = $1, updated_at = now() WHERE id = $2 AND project_id = $3 RETURNING *`,
            [dbStatus, id, projectId]
        );
        const issue = rows[0];
        if (!issue) return res.status(404).json({ error: 'Challenge not found.' });

        if (issue.jira_issue_key && jiraService.isConfigured()) {
            try {
                await jiraService.updateJiraIssueStatus(issue.jira_issue_key, status);
            } catch (e) {
                console.warn('Jira challenge status transition warning:', e.message);
            }
        }
        res.json({ challenge: issue });
    } catch (err) {
        next(err);
    }
}

// PUT /api/projects/:projectId/workspace-kpis/:id
async function updateWorkspaceKpi(req, res, next) {
    try {
        const { id, projectId } = req.params;
        const { status, measuredValue, evidence } = req.body || {};

        const { rows: kRows } = await pool.query(
            `SELECT * FROM kpis WHERE id = $1 AND project_id = $2`,
            [id, projectId]
        );
        const kpi = kRows[0];
        if (!kpi) return res.status(404).json({ error: 'KPI not found.' });

        if (measuredValue !== undefined && measuredValue !== null && String(measuredValue).trim() !== '') {
            await pool.query(
                `INSERT INTO kpi_measurements (kpi_id, measured_value, evidence, recorded_by)
                 VALUES ($1, $2, $3, $4)`,
                [id, measuredValue, evidence || null, req.user.id]
            );
        }

        if (kpi.jira_issue_key && jiraService.isConfigured()) {
            try {
                await jiraService.updateJiraIssueStatus(kpi.jira_issue_key, status);
            } catch (e) {
                console.warn('Jira KPI status transition warning:', e.message);
            }
        }
        res.json({ success: true, kpi });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listWorkspaceTasks,
    createWorkspaceTask,
    updateWorkspaceTask,
    deleteWorkspaceTask,
    updateWorkspaceChallenge,
    updateWorkspaceKpi,
};