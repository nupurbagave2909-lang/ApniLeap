// Jira Cloud REST API v3 integration. Credentials stay server-side only
// (section: "The browser must NEVER directly communicate with Jira or
// Confluence using credentials or API tokens").

function authHeader() {
    const pair = `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`;
    return `Basic ${Buffer.from(pair).toString('base64')}`;
}

function baseUrl() {
    return (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
}

function isConfigured() {
    return Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
}

async function jiraFetch(path, options = {}) {
    const res = await fetch(`${baseUrl()}${path}`, {
        ...options,
        headers: {
            Authorization: authHeader(),
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(options.headers || {}),
        },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
        const message = body?.errorMessages?.join('; ') || (body?.errors ? JSON.stringify(body.errors) : `Jira API error (${res.status})`);
        throw new Error(message);
    }
    return body;
}

// Plain text -> Atlassian Document Format paragraph
function toAdf(text) {
    return {
        type: 'doc',
        version: 1,
        content: String(text || '').split('\n').filter(Boolean).map((line) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: line }],
        })),
    };
}

// Extract plain text from Atlassian Document Format
function fromAdf(adf) {
    if (!adf) return '';
    if (typeof adf === 'string') return adf;
    try {
        let text = '';
        function walk(node) {
            if (node.text) text += node.text;
            if (node.content && Array.isArray(node.content)) {
                node.content.forEach(walk);
                if (node.type === 'paragraph') text += '\n';
            }
        }
        walk(adf);
        return text.trim();
    } catch (e) {
        return '';
    }
}

let cachedLeadAccountId = null;
async function getLeadAccountId() {
    if (cachedLeadAccountId) return cachedLeadAccountId;
    try {
        const myself = await jiraFetch('/rest/api/3/myself');
        if (myself?.accountId) {
            cachedLeadAccountId = myself.accountId;
            return cachedLeadAccountId;
        }
    } catch (e) {
        console.error('Failed to get Jira myself accountId:', e.message);
    }
    return '712020:04d20609-af5a-4bde-ae4f-a570e53ac943';
}

function deriveJiraKey(projectCode) {
    let key = (projectCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!key || !/^[A-Z]/.test(key)) {
        key = `AL${key}`.slice(0, 10);
    } else {
        key = key.slice(0, 10);
    }
    if (key.length < 2) key = `${key}PR`.slice(0, 10);
    return key;
}

// Ensures a dedicated Jira software project and Kanban board exist for this project
async function ensureJiraProject(project, poolClient = null) {
    if (!isConfigured() || !project) return null;
    const db = poolClient || require('../config/db').pool;

    // 1. Check if already linked in database
    const { rows: links } = await db.query(
        `SELECT * FROM jira_links WHERE project_id = $1 AND link_type = 'JIRA_PROJECT' ORDER BY created_at DESC LIMIT 1`,
        [project.id]
    );

    const key = links[0]?.jira_issue_key || deriveJiraKey(project.project_code);
    let boardId = links[0]?.jira_issue_id && !isNaN(Number(links[0].jira_issue_id)) ? links[0].jira_issue_id : null;

    try {
        // 2. Check if Jira project exists
        let jiraProject = null;
        try {
            jiraProject = await jiraFetch(`/rest/api/3/project/${key}`);
        } catch (e) {
            // Not found, need to create
        }

        if (!jiraProject || !jiraProject.id) {
            const leadAccountId = await getLeadAccountId();
            const projName = `${project.project_code || key} - ${project.title || key}`.slice(0, 80);
            try {
                jiraProject = await jiraFetch('/rest/api/3/project', {
                    method: 'POST',
                    body: JSON.stringify({
                        key,
                        name: projName,
                        projectTypeKey: 'software',
                        leadAccountId,
                    }),
                });
            } catch (createErr) {
                console.warn(`Could not create Jira project ${key} (might exist):`, createErr.message);
                try { jiraProject = await jiraFetch(`/rest/api/3/project/${key}`); } catch (e) {}
            }
        }

        // 3. Ensure Kanban board exists with proper project location
        try {
            const bRes = await jiraFetch(`/rest/agile/1.0/board?projectKeyOrId=${key}`);
            const validBoard = bRes?.values?.find((b) => b.location?.projectKey === key);
            if (validBoard) {
                boardId = String(validBoard.id);
            } else {
                let filterId = null;
                if (bRes?.values && bRes.values.length > 0) {
                    try {
                        const cfg = await jiraFetch(`/rest/agile/1.0/board/${bRes.values[0].id}/configuration`);
                        filterId = cfg?.filter?.id;
                        await jiraFetch(`/rest/agile/1.0/board/${bRes.values[0].id}`, { method: 'DELETE' });
                    } catch (e) {}
                }
                if (!filterId) {
                    const filter = await jiraFetch('/rest/api/3/filter', {
                        method: 'POST',
                        body: JSON.stringify({
                            name: `Filter for ${key} board`,
                            jql: `project = "${key}" ORDER BY Rank ASC`,
                        }),
                    });
                    filterId = filter?.id;
                    if (filterId) {
                        try {
                            await jiraFetch(`/rest/api/3/filter/${filterId}/permission`, {
                                method: 'POST',
                                body: JSON.stringify({ type: 'authenticated' })
                            });
                        } catch (e) {}
                    }
                }
                if (filterId) {
                    const newBoard = await jiraFetch('/rest/agile/1.0/board', {
                        method: 'POST',
                        body: JSON.stringify({
                            name: `${key} board`,
                            type: 'kanban',
                            filterId: Number(filterId),
                            location: {
                                type: 'project',
                                projectKeyOrId: key,
                            },
                        }),
                    });
                    if (newBoard?.id) boardId = String(newBoard.id);
                }
            }

            // Ensure Nupur and admins have Administrators role in this project
            try {
                const roles = await jiraFetch(`/rest/api/3/project/${key}/role`);
                if (roles?.Administrators) {
                    const adminUrl = roles.Administrators.replace(baseUrl(), '');
                    await jiraFetch(adminUrl, {
                        method: 'POST',
                        body: JSON.stringify({ user: ['712020:b45f0add-c266-4481-8388-fc6d4dac8035'] })
                    });
                }
            } catch (roleErr) {}
        } catch (boardErr) {
            console.warn(`Could not verify/create board for ${key}:`, boardErr.message);
        }

        // 4. Insert or update jira_links
        const boardUrl = boardId
            ? `${baseUrl()}/jira/software/projects/${key}/boards/${boardId}`
            : `${baseUrl()}/jira/software/projects/${key}/boards`;

        if (!links.length) {
            await db.query(
                `INSERT INTO jira_links (project_id, jira_issue_key, jira_issue_id, link_type)
                 VALUES ($1, $2, $3, 'JIRA_PROJECT')
                 ON CONFLICT DO NOTHING`,
                [project.id, key, boardId || key]
            );
        } else if (boardId && links[0].jira_issue_id !== boardId) {
            await db.query(
                `UPDATE jira_links SET jira_issue_id = $1 WHERE id = $2`,
                [boardId, links[0].id]
            );
        }

        return {
            key,
            boardId,
            url: boardUrl,
            link_type: 'JIRA_PROJECT',
        };
    } catch (err) {
        console.error(`ensureJiraProject failed for ${project.project_code}:`, err.message);
        return {
            key,
            url: `${baseUrl()}/jira/software/projects/${key}/boards`,
            link_type: 'JIRA_PROJECT',
        };
    }
}

// Dynamically resolves target Jira project key
async function resolveJiraProjectKey(project) {
    if (!project) return process.env.JIRA_PROJECT_KEY || 'KAN';
    const directKey = deriveJiraKey(project?.project_code);
    if (directKey) {
        try {
            const p = await jiraFetch(`/rest/api/3/project/${directKey}`);
            if (p && p.key) return p.key;
        } catch (e) { /* fallback */ }
    }
    const envKey = process.env.JIRA_PROJECT_KEY;
    if (envKey) {
        try {
            const p = await jiraFetch(`/rest/api/3/project/${envKey}`);
            if (p && p.key) return p.key;
        } catch (e) { /* fallback */ }
    }
    try {
        const ensured = await ensureJiraProject(project);
        if (ensured?.key) return ensured.key;
    } catch (e) { /* fallback */ }
    return envKey || 'KAN';
}


// Creates a Task issue in the configured Jira project for a mini-project
async function createJiraIssue(project, projectKeyOverride = null) {
    const projectKey = projectKeyOverride || await resolveJiraProjectKey(project);
    const summary = `[${project.project_code}] ${project.title}`;
    const description = toAdf(
        `ApniLeap Mini-Project: ${project.title}\n` +
        `Project ID: ${project.project_code}\n` +
        `Team ID: ${project.team_id || ''}\n` +
        `Artefact: ${project.artefact_id || ''} ${project.artefact_title || ''}\n` +
        `Theme: ${project.theme_name || ''}\n` +
        `Institute: ${project.institute_name}\n` +
        `Department: ${project.department_name}\n` +
        `Faculty Mentor: ${project.mentor_name || 'Unassigned'}\n` +
        `Project Coordinator: ${project.coordinator_name || 'Unassigned'}\n` +
        `Reviewer: ${project.reviewer_name || 'Unassigned'}\n` +
        `RAG Status: ${project.rag_status}\n` +
        `This issue is synced from the ApniLeap Portfolio Monitoring Portal.`
    );

    const body = await jiraFetch('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
            fields: {
                project: { key: projectKey },
                summary,
                description,
                issuetype: { name: 'Task' },
            },
        }),
    });

    return { key: body.key, id: body.id };
}

// Creates a Workspace Kanban Task in Jira
async function createWorkspaceTaskIssue(projectKey, taskTitle, taskDescription) {
    const body = await jiraFetch('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
            fields: {
                project: { key: projectKey },
                summary: taskTitle,
                description: taskDescription ? toAdf(taskDescription) : toAdf('No description provided.'),
                issuetype: { name: 'Task' },
            },
        }),
    });
    return { key: body.key, id: body.id };
}

// Transitions a Jira issue based on ApniLeap status (TODO, IN_PROGRESS, COMPLETED)
async function updateJiraIssueStatus(issueKey, apnileapStatus) {
    if (!issueKey) return;
    try {
        const { transitions } = await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`);
        let targetTransition = null;

        if (apnileapStatus === 'TODO') {
            // Must specifically target the board's to-do status (avoiding Backlog and Selected for development)
            targetTransition = transitions.find(t => t.to?.id === '10014' || t.to?.id === '10008' || /^to-do$/i.test(t.name) || /^to-do$/i.test(t.to?.name));
            if (!targetTransition) {
                targetTransition = transitions.find(t => /^to-do$/i.test(t.name) || /^to-do$/i.test(t.to?.name) || /^to do$/i.test(t.name) || /^todo$/i.test(t.name));
            }
        } else if (apnileapStatus === 'IN_PROGRESS') {
            targetTransition = transitions.find(t => t.to?.id === '3' || t.to?.id === '10009' || /^in progress$/i.test(t.name) || /^in progress$/i.test(t.to?.name));
            if (!targetTransition) {
                targetTransition = transitions.find(t => /in progress|in-progress|doing/i.test(t.name) || t.to?.statusCategory?.key === 'indeterminate');
            }
        } else if (apnileapStatus === 'COMPLETED' || apnileapStatus === 'DONE' || apnileapStatus === 'RESOLVED') {
            targetTransition = transitions.find(t => t.to?.id === '10013' || t.to?.id === '10010' || /^done$/i.test(t.name) || /^done$/i.test(t.to?.name));
            if (!targetTransition) {
                targetTransition = transitions.find(t => /done|completed|resolved/i.test(t.name) || t.to?.statusCategory?.key === 'done');
            }
        }

        if (targetTransition) {
            await jiraFetch(`/rest/api/3/issue/${issueKey}/transitions`, {
                method: 'POST',
                body: JSON.stringify({ transition: { id: targetTransition.id } }),
            });
        }
    } catch (err) {
        console.error(`Jira status transition failed for ${issueKey}:`, err.message);
    }
}

// Fetches all issues for a Jira Project Board using POST /rest/api/3/search/jql
async function fetchJiraProjectIssues(projectKey) {
    if (!projectKey) return [];
    try {
        const data = await jiraFetch('/rest/api/3/search/jql', {
            method: 'POST',
            body: JSON.stringify({
                jql: `project = "${projectKey}" ORDER BY created ASC`,
                fields: ['summary', 'status', 'priority', 'assignee', 'description', 'created', 'updated'],
            }),
        });
        return data.issues || [];
    } catch (err) {
        console.error(`Failed to fetch Jira issues for ${projectKey}:`, err.message);
        return [];
    }
}

// Creates a Challenge in Jira
async function createJiraChallenge(project, challenge, user) {
    const projectKey = await resolveJiraProjectKey(project);
    const summary = `[Challenge] ${challenge.title}`;
    const descText =
        `Challenge / Impediment logged from ApniLeap Portal\n\n` +
        `Project: [${project.project_code}] ${project.title}\n` +
        `Raised by: ${user?.fullName || 'Student'} (${user?.srn || user?.email || 'N/A'})\n` +
        `Challenge Title: ${challenge.title}\n\n` +
        `Root Cause: ${challenge.rootCause || challenge.root_cause || 'Not specified'}\n` +
        `Impact: ${challenge.impact || 'Not specified'}\n` +
        `Support Required: ${challenge.supportRequired || challenge.support_required || 'Not specified'}\n\n` +
        `Initial Status: OPEN`;

    const body = await jiraFetch('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
            fields: {
                project: { key: projectKey },
                summary,
                description: toAdf(descText),
                issuetype: { name: 'Task' },
            },
        }),
    });

    return {
        key: body.key,
        id: body.id,
        url: `${baseUrl()}/browse/${body.key}`,
    };
}

// Updates an existing challenge issue in Jira
async function updateJiraChallenge(issueKey, challenge) {
    if (!issueKey) return null;
    const descText =
        `Challenge / Impediment updated from ApniLeap Portal\n\n` +
        `Challenge Title: ${challenge.title}\n` +
        `Root Cause: ${challenge.rootCause || challenge.root_cause || 'Not specified'}\n` +
        `Impact: ${challenge.impact || 'Not specified'}\n` +
        `Support Required: ${challenge.supportRequired || challenge.support_required || 'Not specified'}\n`;

    const fields = {
        summary: `[Challenge] ${challenge.title}`,
        description: toAdf(descText),
    };

    return jiraFetch(`/rest/api/3/issue/${issueKey}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
    });
}

// Creates a KPI issue in Jira
async function createJiraKpi(project, kpi, user) {
    const projectKey = await resolveJiraProjectKey(project);
    const summary = `[KPI] ${kpi.name} (Target: ${kpi.targetValue || kpi.target_value || 'N/A'} ${kpi.unit || ''})`.trim();
    const descText =
        `Key Performance Indicator (KPI) tracked from ApniLeap Portal\n\n` +
        `Project: [${project.project_code}] ${project.title}\n` +
        `KPI Name: ${kpi.name}\n` +
        `Target Value: ${kpi.targetValue || kpi.target_value || 'Not specified'} ${kpi.unit || ''}\n` +
        `Defined by: ${user?.fullName || 'Faculty Mentor'}\n\n` +
        `Progress measurements will be posted here as students achieve project milestones.`;

    const body = await jiraFetch('/rest/api/3/issue', {
        method: 'POST',
        body: JSON.stringify({
            fields: {
                project: { key: projectKey },
                summary,
                description: toAdf(descText),
                issuetype: { name: 'Task' },
            },
        }),
    });

    return {
        key: body.key,
        id: body.id,
        url: `${baseUrl()}/browse/${body.key}`,
    };
}

// Records a KPI measurement as a comment on the KPI's Jira ticket
async function recordJiraKpiMeasurement(kpiJiraKey, kpi, measurement, user) {
    if (!kpiJiraKey) return null;
    const commentText =
        `📊 KPI Measurement Update recorded in ApniLeap Portal\n\n` +
        `KPI: ${kpi.name}\n` +
        `Target: ${kpi.target_value || 'N/A'} ${kpi.unit || ''}\n` +
        `Measured Value: ${measurement.measuredValue || measurement.measured_value} ${kpi.unit || ''}\n` +
        `Recorded by: ${user?.fullName || 'Student'} (${user?.srn || user?.email || 'Student'})\n` +
        `Evidence: ${measurement.evidence || 'None provided'}`;

    return addJiraComment(kpiJiraKey, commentText);
}

async function addJiraComment(issueKey, text) {
    return jiraFetch(`/rest/api/3/issue/${issueKey}/comment`, {
        method: 'POST',
        body: JSON.stringify({ body: toAdf(text) }),
    });
}

async function updateJiraIssue(issueKey, { summary, description }) {
    const fields = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = toAdf(description);
    return jiraFetch(`/rest/api/3/issue/${issueKey}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
    });
}

async function getJiraIssue(issueKey) {
    return jiraFetch(`/rest/api/3/issue/${issueKey}`);
}

module.exports = {
    isConfigured,
    baseUrl,
    createJiraIssue,
    createWorkspaceTaskIssue,
    updateJiraIssueStatus,
    fetchJiraProjectIssues,
    createJiraChallenge,
    updateJiraChallenge,
    createJiraKpi,
    recordJiraKpiMeasurement,
    addJiraComment,
    updateJiraIssue,
    getJiraIssue,
    resolveJiraProjectKey,
    ensureJiraProject,
    deriveJiraKey,
    getLeadAccountId,
    fromAdf,
    toAdf,
    jiraFetch,
};
