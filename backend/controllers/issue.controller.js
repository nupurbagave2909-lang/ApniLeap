const { pool } = require('../config/db');
const { canAccessProject, loadProject, isStudentOnly } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');
const jiraService = require('../services/jira.service');

// GET /api/projects/:projectId/issues
async function listIssues(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT i.*, u.full_name AS raised_by_name
             FROM issues i
             LEFT JOIN users u ON u.id = i.raised_by
             WHERE i.project_id = $1
             ORDER BY i.created_at DESC`,
            [req.params.projectId]
        );
        const issues = rows.map((i) => ({
            ...i,
            jira_url: i.jira_issue_key ? `${jiraService.baseUrl()}/browse/${i.jira_issue_key}` : null,
        }));
        res.json({ issues });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/issues
// Any authenticated user with project access may raise a challenge/issue,
// including students. Automatically syncs to Jira if configured.
async function createIssue(req, res, next) {
    try {
        const { title, rootCause, impact, supportRequired } = req.body || {};
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Issue title is required.' });
        }

        const project = req.project || await loadProject(req.params.projectId);

        let jiraKey = null;
        if (jiraService.isConfigured()) {
            try {
                const jiraRes = await jiraService.createJiraChallenge(
                    project,
                    { title: title.trim(), rootCause, impact, supportRequired },
                    req.user
                );
                if (jiraRes?.key) {
                    jiraKey = jiraRes.key;
                }
            } catch (err) {
                console.error(`Jira challenge creation error for project ${project.id} (non-fatal):`, err.message);
            }
        }

        const { rows } = await pool.query(
            `INSERT INTO issues (project_id, title, root_cause, impact, support_required, raised_by, jira_issue_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [req.params.projectId, title.trim(), rootCause || null, impact || null, supportRequired || null, req.user.id, jiraKey]
        );
        const issue = rows[0];

        await logAudit({
            userId: req.user.id,
            action: 'ISSUE_CREATE',
            entityType: 'issue',
            entityId: issue.id,
            instituteId: project.institute_id,
            details: { jiraKey },
            ipAddress: req.ip,
        });

        res.status(201).json({
            issue: {
                ...issue,
                jira_url: issue.jira_issue_key ? `${jiraService.baseUrl()}/browse/${issue.jira_issue_key}` : null,
            },
        });
    } catch (err) {
        next(err);
    }
}

// PUT /api/issues/:id
// Role-based access:
//   Student      -> can edit ONLY their own issue (content fields).
//                   Cannot change status or escalation level.
//   Faculty / HOD / Admin -> can update status, escalation, and content.
// Automatically syncs updates & transitions to Jira.
async function updateIssue(req, res, next) {
    try {
        const { rows: existingRows } = await pool.query(`SELECT * FROM issues WHERE id = $1`, [req.params.id]);
        const issue = existingRows[0];
        if (!issue) return res.status(404).json({ error: 'Issue not found.' });

        const project = await loadProject(issue.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to update this issue.' });
        }

        const isStudent = isStudentOnly(req.user);

        // Students can only edit their OWN challenges
        if (isStudent && issue.raised_by !== req.user.id) {
            await logAudit({
                userId: req.user.id,
                action: 'ACCESS_DENIED_ROLE',
                entityType: 'issue',
                entityId: req.params.id,
                details: { reason: "Student attempted to edit another student's challenge" },
                ipAddress: req.ip,
            });
            return res.status(403).json({ error: 'You can only edit challenges that you raised.' });
        }

        const { status, escalationLevel, rootCause, impact, supportRequired, title } = req.body || {};

        // Students cannot change status or escalation
        if (isStudent && (status || escalationLevel)) {
            return res.status(403).json({
                error: 'Students cannot change the status or escalation level of a challenge. Contact your Faculty Mentor.',
            });
        }

        const allowedStatus = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
        const allowedEscalation = ['NONE', 'DEPARTMENT', 'INSTITUTE', 'PROGRAMME'];
        if (status && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: `status must be one of ${allowedStatus.join(', ')}.` });
        }
        if (escalationLevel && !allowedEscalation.includes(escalationLevel)) {
            return res.status(400).json({ error: `escalationLevel must be one of ${allowedEscalation.join(', ')}.` });
        }

        const { rows } = await pool.query(
            `UPDATE issues
             SET title            = COALESCE($1, title),
                 status           = COALESCE($2, status),
                 escalation_level = COALESCE($3, escalation_level),
                 root_cause       = COALESCE($4, root_cause),
                 impact           = COALESCE($5, impact),
                 support_required = COALESCE($6, support_required)
             WHERE id = $7 RETURNING *`,
            [title || null, status || null, escalationLevel || null, rootCause || null, impact || null, supportRequired || null, req.params.id]
        );
        const updatedIssue = rows[0];

        // Jira Sync: updates & status transitions
        if (issue.jira_issue_key && jiraService.isConfigured()) {
            if (title || rootCause || impact || supportRequired) {
                jiraService.updateJiraChallenge(issue.jira_issue_key, updatedIssue)
                    .catch((e) => console.error('Jira issue update error (non-fatal):', e.message));
            }
            if (status && status !== issue.status) {
                jiraService.transitionJiraIssue(issue.jira_issue_key, status, `Changed by ${req.user.fullName || 'Mentor'}`)
                    .catch((e) => console.error('Jira issue transition error (non-fatal):', e.message));
            }
        }

        await logAudit({
            userId: req.user.id,
            action: 'ISSUE_UPDATE',
            entityType: 'issue',
            entityId: req.params.id,
            instituteId: project.institute_id,
            details: { isStudent, fieldsChanged: Object.keys(req.body || {}), jiraKey: issue.jira_issue_key },
            ipAddress: req.ip,
        });

        res.json({
            issue: {
                ...updatedIssue,
                jira_url: updatedIssue.jira_issue_key ? `${jiraService.baseUrl()}/browse/${updatedIssue.jira_issue_key}` : null,
            },
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { listIssues, createIssue, updateIssue };
