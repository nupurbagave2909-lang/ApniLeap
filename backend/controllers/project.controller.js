const { pool } = require('../config/db');
const { isAuthorizedApprover, canAccessProject, isStudentOnly } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');
const jiraService = require('../services/jira.service');
const confluenceService = require('../services/confluence.service');
const { validateTeam } = require('../validators/student.validator');
const { validateTerm, cleanName } = require('../validators/academic.validator');
const { srnConflictMessage, isSrnDuplicateError } = require('../services/team.service');
const { ensureStudentAccounts } = require('../services/student-account.service');

const RAG_VALUES = ['GREEN', 'YELLOW', 'RED'];

// Allowed direct transitions (section 20). RED -> GREEN is intentionally
// excluded here; it is handled as a special evidence-gated case below.
const ALLOWED_TRANSITIONS = {
    GREEN: ['YELLOW'],
    YELLOW: ['GREEN', 'RED'],
    RED: ['YELLOW', 'GREEN'], // GREEN only permitted with verified evidence, checked in code
};

// GET /api/projects/:projectId
async function getProject(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT p.*,
                    i.name AS institute_name, i.code AS institute_code,
                    d.name AS department_name, d.code AS department_code,
                    COALESCE(t.name, p.theme_name) AS theme_name,
                    p.theme_id,
                    COALESCE(p.faculty_mentor_name, mu.full_name) AS mentor_name, mu.email AS mentor_email
             FROM projects p
             JOIN institutes i ON i.id = p.institute_id
             JOIN departments d ON d.id = p.department_id
             LEFT JOIN themes t ON t.id = p.theme_id
             LEFT JOIN users mu ON mu.id = p.mentor_user_id
             WHERE p.id = $1`,
            [req.params.projectId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Project not found.' });

        let { rows: jiraRows } = await pool.query(
            `SELECT jira_issue_key, jira_issue_id, link_type, created_at FROM jira_links WHERE project_id = $1 AND link_type = 'JIRA_PROJECT' ORDER BY created_at DESC LIMIT 1`,
            [req.params.projectId]
        );
        if (!jiraRows[0]) {
            const { rows: anyLinks } = await pool.query(
                `SELECT jira_issue_key, jira_issue_id, link_type, created_at FROM jira_links WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
                [req.params.projectId]
            );
            jiraRows = anyLinks;
        }

        // Auto-provision if missing
        if (!jiraRows[0] && jiraService.isConfigured() && rows[0]) {
            try {
                const ensured = await jiraService.ensureJiraProject(rows[0], pool);
                if (ensured) {
                    jiraRows = [{
                        jira_issue_key: ensured.key,
                        jira_issue_id: String(ensured.boardId || ensured.key),
                        link_type: 'JIRA_PROJECT',
                    }];
                }
            } catch (e) {
                console.warn('Auto-provision Jira in getProject warning:', e.message);
            }
        }

        const { rows: confluenceRows } = await pool.query(
            `SELECT confluence_page_id, page_url, created_at FROM confluence_links WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [req.params.projectId]
        );

        const baseUrl = jiraService.baseUrl();

        let jiraUrl = null;
        if (jiraRows[0]) {
            if (jiraRows[0].link_type === 'JIRA_PROJECT') {
                const bId = jiraRows[0].jira_issue_id && !isNaN(Number(jiraRows[0].jira_issue_id)) ? `/${jiraRows[0].jira_issue_id}` : '';
                jiraUrl = `${baseUrl}/jira/software/projects/${jiraRows[0].jira_issue_key}/boards${bId}`;
            } else {
                jiraUrl = `${baseUrl}/browse/${jiraRows[0].jira_issue_key}`;
            }
        }

        const { rows: chBoardLinks } = await pool.query(
            `SELECT * FROM jira_links WHERE project_id = $1 AND link_type = 'JIRA_BOARD_CHALLENGES' LIMIT 1`,
            [req.params.projectId]
        );
        const { rows: kpBoardLinks } = await pool.query(
            `SELECT * FROM jira_links WHERE project_id = $1 AND link_type = 'JIRA_BOARD_KPIS' LIMIT 1`,
            [req.params.projectId]
        );

        let challengesJiraUrl = null;
        if (chBoardLinks[0]) {
            const bId = chBoardLinks[0].jira_issue_id && !isNaN(Number(chBoardLinks[0].jira_issue_id)) ? `/${chBoardLinks[0].jira_issue_id}` : '';
            challengesJiraUrl = `${baseUrl}/jira/software/projects/${chBoardLinks[0].jira_issue_key}/boards${bId}`;
        }
        let kpisJiraUrl = null;
        if (kpBoardLinks[0]) {
            const bId = kpBoardLinks[0].jira_issue_id && !isNaN(Number(kpBoardLinks[0].jira_issue_id)) ? `/${kpBoardLinks[0].jira_issue_id}` : '';
            kpisJiraUrl = `${baseUrl}/jira/software/projects/${kpBoardLinks[0].jira_issue_key}/boards${bId}`;
        }

        res.json({
            project: rows[0],
            jiraLink: jiraRows[0] ? { key: jiraRows[0].jira_issue_key, url: jiraUrl, link_type: jiraRows[0].link_type } : null,
            challengesJiraLink: chBoardLinks[0] ? { key: chBoardLinks[0].jira_issue_key, url: challengesJiraUrl, link_type: 'JIRA_BOARD_CHALLENGES' } : null,
            kpisJiraLink: kpBoardLinks[0] ? { key: kpBoardLinks[0].jira_issue_key, url: kpisJiraUrl, link_type: 'JIRA_BOARD_KPIS' } : null,
            confluenceLink: confluenceRows[0] ? { pageId: confluenceRows[0].confluence_page_id, url: confluenceRows[0].page_url } : null,
        });
    } catch (err) {
        next(err);
    }
}

const DEFINITION_FIELDS = [
    'need_statement', 'problem_statement', 'objective', 'learning_outcomes',
    'foundation_courses', 'functional_blocks', 'interfaces', 'dependencies', 'expected_deliverables',
];

// PUT /api/projects/:projectId
async function updateProject(req, res, next) {
    try {
        const roles = req.user?.roles || [];
        const isPlatformAdmin = roles.includes('PLATFORM_ADMIN');
        const isHod = roles.includes('DEPARTMENT_HEAD') && (req.user.departmentIds || []).includes(req.project.department_id);
        const isGuide = roles.includes('FACULTY_MENTOR') && (
            (req.project.mentor_user_id && req.project.mentor_user_id === req.user.id) ||
            (req.user.fullName && req.project.faculty_mentor_name &&
             req.project.faculty_mentor_name.trim().toLowerCase() === req.user.fullName.trim().toLowerCase()) ||
            (req.user.projectIds || []).includes(req.project.id)
        );
        const isStudent = roles.includes('STUDENT') && (req.user.projectIds || []).includes(req.project.id);

        if (!isPlatformAdmin && !isHod && !isGuide && !isStudent) {
            return res.status(403).json({ error: 'Only the faculty guide, project team students, HOD, or Platform Administrator can update project details.' });
        }

        const updates = [];
        const params = [];

        for (const field of DEFINITION_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                params.push(req.body[field]);
                updates.push(`${field} = $${params.length}`);
            }
        }
        const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
        if (has('academic_year') || has('semester')) {
            const problem = validateTerm(req.body.academic_year, req.body.semester);
            if (problem) return res.status(400).json({ error: problem });
        }
        for (const field of ['academic_year', 'semester']) {
            if (has(field)) {
                params.push(req.body[field] || null);
                updates.push(`${field} = $${params.length}`);
            }
        }
        for (const field of ['theme_name', 'artefact_title']) {
            if (has(field)) {
                const value = cleanName(req.body[field]);
                if (!value) return res.status(400).json({ error: `${field === 'theme_name' ? 'Theme name' : 'Artefact title'} cannot be empty.` });
                params.push(field === 'artefact_title' ? value.slice(0, 300) : value);
                updates.push(`${field} = $${params.length}`);
            }
        }
        for (const field of ['faculty_mentor_name', 'coordinator_name', 'reviewer_name']) {
            if (has(field)) {
                params.push(cleanName(req.body[field]));
                updates.push(`${field} = $${params.length}`);
            }
        }
        if (has('faculty_mentor_name')) {
            params.push(await findInstituteUserByName(cleanName(req.body.faculty_mentor_name), req.project.institute_id));
            updates.push(`mentor_user_id = $${params.length}`);
        }

        if (!updates.length) {
            return res.status(400).json({ error: 'No updatable fields were provided.' });
        }

        params.push(req.params.projectId);
        const { rows } = await pool.query(
            `UPDATE projects SET ${updates.join(', ')}, last_update_at = now() WHERE id = $${params.length} RETURNING *`,
            params
        );

        await logAudit({
            userId: req.user.id,
            action: 'PROJECT_UPDATE',
            entityType: 'project',
            entityId: req.params.projectId,
            instituteId: req.project.institute_id,
            details: { fields: Object.keys(req.body) },
            ipAddress: req.ip,
        });

        res.json({ project: rows[0] });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/status
// Body: { newStatus, reason, evidence, blocker, rootCause, impact,
//         correctiveActionTaken, supportRequired, actionOwnerName, dueDate,
//         escalationOwnerName, nextReviewAt, reviewerApproval }
async function changeStatus(req, res, next) {
    const client = await pool.connect();
    try {
        const project = req.project;
        const {
            newStatus, reason, evidence, blocker, rootCause, impact,
            correctiveActionTaken, supportRequired, dueDate,
            nextReviewAt, reviewerApproval, completionPct,
        } = req.body || {};
        const actionOwnerName = cleanName(req.body && req.body.actionOwnerName);
        const escalationOwnerName = cleanName(req.body && req.body.escalationOwnerName);

        // Completion % is set here, together with (or without) a status change.
        const hasPct = completionPct !== undefined && completionPct !== null && String(completionPct).trim() !== '';
        const pct = hasPct ? Number(completionPct) : null;
        if (hasPct && (!Number.isInteger(pct) || pct < 0 || pct > 100)) {
            return res.status(400).json({ error: 'Completion must be a whole number from 0 to 100.' });
        }

        if (newStatus === undefined || newStatus === null || newStatus === '') {
            if (!hasPct) return res.status(400).json({ error: 'Choose a new status or enter a completion percentage.' });
            const { rows } = await client.query(
                `UPDATE projects SET completion_pct = $1, last_update_at = now() WHERE id = $2 RETURNING *`,
                [pct, project.id]
            );
            await logAudit({
                userId: req.user.id, action: 'PROJECT_COMPLETION_UPDATE', entityType: 'project', entityId: project.id,
                instituteId: project.institute_id, details: { from: project.completion_pct, to: pct }, ipAddress: req.ip,
            });
            return res.json({ project: rows[0], statusChanged: false });
        }

        if (!RAG_VALUES.includes(newStatus)) {
            return res.status(400).json({ error: 'newStatus must be one of GREEN, YELLOW, RED.' });
        }
        if (newStatus === project.rag_status) {
            return res.status(400).json({ error: `Project is already ${newStatus}.` });
        }
        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: 'A reason is required for every status change.' });
        }

        const isRedToGreen = project.rag_status === 'RED' && newStatus === 'GREEN';

        if (!isRedToGreen && !ALLOWED_TRANSITIONS[project.rag_status].includes(newStatus)) {
            return res.status(400).json({ error: `Transition ${project.rag_status} -> ${newStatus} is not permitted.` });
        }

        // Section 20/21: RED cannot move to GREEN without a verified corrective
        // action, evidence, and approval by an authorized reviewer.
        if (isRedToGreen) {
            if (!isAuthorizedApprover(req.user)) {
                return res.status(403).json({ error: 'Only an authorized reviewer may approve a Red-to-Green recovery.' });
            }
            if (!reviewerApproval) {
                return res.status(400).json({ error: 'Reviewer approval confirmation is required to move from Red to Green.' });
            }
            if (!evidence || !evidence.trim()) {
                return res.status(400).json({ error: 'Evidence of resolution is required to move from Red to Green.' });
            }
            const { rows: verifiedActions } = await client.query(
                `SELECT id FROM corrective_actions WHERE project_id = $1 AND status = 'VERIFIED' LIMIT 1`,
                [project.id]
            );
            if (!verifiedActions.length) {
                return res.status(400).json({
                    error: 'At least one corrective action must be completed and verified before this project can return to Green.',
                });
            }
        }

        await client.query('BEGIN');

        await client.query(
            `UPDATE projects
             SET rag_status = $1, rag_since = now(), last_update_at = now(),
                 next_review_at = COALESCE($2, next_review_at),
                 completion_pct = COALESCE($4, completion_pct)
             WHERE id = $3`,
            [newStatus, nextReviewAt || null, project.id, pct]
        );

        const { rows: historyRows } = await client.query(
            `INSERT INTO status_history (project_id, previous_status, new_status, reason, evidence, changed_by, approved_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [project.id, project.rag_status, newStatus, reason, evidence || null, req.user.id, isRedToGreen ? req.user.id : null]
        );

        // Red-intervention capture (section 21): when moving INTO Red, record
        // the full intervention record as an issue + corrective action pair.
        if (newStatus === 'RED') {
            const { rows: issueRows } = await client.query(
                `INSERT INTO issues (project_id, title, root_cause, impact, support_required, escalation_level, status, raised_by, escalation_owner_name)
                 VALUES ($1,$2,$3,$4,$5,'INSTITUTE','OPEN',$6,$7) RETURNING id`,
                [project.id, reason.slice(0, 300), rootCause || blocker || null, impact || null, supportRequired || null, req.user.id, escalationOwnerName]
            );

            if (correctiveActionTaken && correctiveActionTaken.trim()) {
                await client.query(
                    `INSERT INTO corrective_actions (project_id, issue_id, description, owner_name, due_date, evidence, status)
                     VALUES ($1,$2,$3,$4,$5,$6,'OPEN')`,
                    [project.id, issueRows[0].id, correctiveActionTaken, actionOwnerName, dueDate || null, evidence || null]
                );
            }
        }

        await client.query('COMMIT');

        await logAudit({
            userId: req.user.id,
            action: 'PROJECT_STATUS_CHANGE',
            entityType: 'project',
            entityId: project.id,
            instituteId: project.institute_id,
            details: { from: project.rag_status, to: newStatus, reason },
            ipAddress: req.ip,
        });

        // Best-effort: record the RAG transition as a Jira comment so the
        // work-tracking side of the portfolio stays in sync (section 24).
        if (jiraService.isConfigured()) {
            try {
                const { rows: linkRows } = await pool.query(`SELECT jira_issue_key FROM jira_links WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`, [project.id]);
                if (linkRows[0]) {
                    await jiraService.addJiraComment(
                        linkRows[0].jira_issue_key,
                        `RAG status changed: ${project.rag_status} -> ${newStatus}\nReason: ${reason}\nChanged by: ${req.user.fullName || req.user.email}`
                    );
                }
            } catch (err) {
                console.error(`Jira comment failed for project ${project.id} (non-fatal):`, err.message);
            }
        }

        res.json({ statusHistory: historyRows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
}

// GET /api/projects/:projectId/history
async function getHistory(req, res, next) {
    try {
        const { rows: statusHistory } = await pool.query(
            `SELECT sh.*, u.full_name AS changed_by_name, au.full_name AS approved_by_name
             FROM status_history sh
             LEFT JOIN users u ON u.id = sh.changed_by
             LEFT JOIN users au ON au.id = sh.approved_by
             WHERE sh.project_id = $1
             ORDER BY sh.created_at DESC`,
            [req.params.projectId]
        );
        res.json({ statusHistory });
    } catch (err) {
        next(err);
    }
}

// Best-effort Jira issue + Confluence page provisioning for a project
// (section 25: PostgreSQL record -> Jira issue -> Confluence page -> store
// both ids). Each half is independent and never throws - a Jira/Confluence
// outage must not block project creation or break the request it's called
// from; failures are logged and can be retried via the manual endpoints
// below.
async function provisionIntegrations(project, userId) {
    let jiraKey = null;

    if (jiraService.isConfigured()) {
        try {
            // 1. Auto-provision dedicated Jira software project & Kanban board
            const ensured = await jiraService.ensureJiraProject(project, pool);
            jiraKey = ensured?.key;
            if (jiraKey) {
                await logAudit({ userId, action: 'JIRA_PROJECT_CREATE', entityType: 'project', entityId: project.id, instituteId: project.institute_id, details: { jiraKey } });
            }

            // 2. Populate starter Kanban tasks on the new project's board
            const pCode = project.project_code || jiraKey;
            const starterTasks = [
                {
                    title: 'System Architecture & Requirements Specification',
                    description: 'Define technical stack, architecture diagrams, interfaces, and deliverables.',
                    status: 'COMPLETED',
                    priority: 'HIGH',
                },
                {
                    title: 'Core Module Implementation & Integration',
                    description: 'Develop foundational module logic, algorithms, and service interfaces.',
                    status: 'IN_PROGRESS',
                    priority: 'HIGH',
                },
                {
                    title: 'Validation, Testing & Project Demonstration',
                    description: 'Execute unit/integration tests, benchmark performance, and prepare evaluation demo.',
                    status: 'TODO',
                    priority: 'MEDIUM',
                },
            ];

            const { rows: studentRows } = await pool.query(
                `SELECT name FROM project_students WHERE project_id = $1 ORDER BY slot ASC`,
                [project.id]
            );

            for (let idx = 0; idx < starterTasks.length; idx++) {
                const item = starterTasks[idx];
                const assignee = studentRows[idx]?.name || project.mentor_name || null;
                let taskJiraKey = null;
                if (jiraKey) {
                    try {
                        const issue = await jiraService.createWorkspaceTaskIssue(jiraKey, item.title, item.description);
                        taskJiraKey = issue.key;
                        if (item.status !== 'TODO') {
                            await jiraService.updateJiraIssueStatus(taskJiraKey, item.status);
                        }
                    } catch (e) {
                        console.warn(`Could not push starter task to Jira for ${jiraKey}:`, e.message);
                    }
                }
                if (!taskJiraKey) {
                    taskJiraKey = `${pCode}-${101 + idx}`;
                }
                await pool.query(
                    `INSERT INTO workspace_tasks (project_id, title, description, status, priority, assignee_name, jira_issue_key)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [project.id, item.title, item.description, item.status, item.priority, assignee, taskJiraKey]
                );
            }

            // 3. Populate starter KPIs with Jira issues
            const starterKpis = [
                { name: 'Model Inference & System Latency', target: '50', unit: 'ms' },
                { name: 'Pipeline Throughput & Reliability', target: '99', unit: '%' },
                { name: 'Test Coverage & Validation Accuracy', target: '85', unit: '%' },
            ];
            for (const s of starterKpis) {
                let kpiJiraKey = null;
                if (jiraKey) {
                    try {
                        const kpiIssue = await jiraService.createJiraKpi(project, { name: s.name, targetValue: s.target, unit: s.unit }, { fullName: project.mentor_name || 'Faculty Mentor' });
                        kpiJiraKey = kpiIssue?.key;
                    } catch (e) {
                        console.warn(`Could not push starter KPI to Jira for ${jiraKey}:`, e.message);
                    }
                }
                await pool.query(
                    `INSERT INTO kpis (project_id, name, target_value, unit, jira_issue_key, owner_user_id)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [project.id, s.name, s.target, s.unit, kpiJiraKey, project.mentor_user_id || null]
                );
            }
        } catch (err) {
            console.error(`Jira provisioning failed for project ${project.id} (non-fatal):`, err.message);
        }
    }

    if (confluenceService.isConfigured()) {
        try {
            const page = await confluenceService.createConfluencePage(project, jiraKey);
            await pool.query(
                `INSERT INTO confluence_links (project_id, confluence_page_id, page_url, link_type) VALUES ($1,$2,$3,'PROJECT_DOCS')`,
                [project.id, page.id, page.url]
            );
            await logAudit({ userId, action: 'CONFLUENCE_PAGE_CREATE', entityType: 'project', entityId: project.id, instituteId: project.institute_id, details: { pageId: page.id } });
        } catch (err) {
            console.error(`Confluence page creation failed for project ${project.id} (non-fatal):`, err.message);
        }
    }

    return { jiraKey };
}

// A typed mentor name that exactly matches a user of the institute is also
// linked to that account (used for display only; it grants no access).
async function findInstituteUserByName(name, instituteId) {
    if (!name) return null;
    const { rows } = await pool.query(
        `SELECT u.id FROM users u
         JOIN user_institute_access uia ON uia.user_id = u.id AND uia.institute_id = $2
         WHERE lower(u.full_name) = lower($1) AND u.is_active = TRUE LIMIT 2`,
        [name, instituteId]
    );
    return rows.length === 1 ? rows[0].id : null;
}

// GET /api/projects/next-ids - the Team ID and Artefact ID the next project will
// get. Only a preview: the real numbers are assigned by the database on save.
async function nextIds(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT format_seq_id('Team', CASE WHEN t.is_called THEN t.last_value + 1 ELSE t.last_value END) AS team_id,
                    format_seq_id('Art',  CASE WHEN a.is_called THEN a.last_value + 1 ELSE a.last_value END) AS artefact_id
             FROM team_id_seq t, artefact_id_seq a`
        );
        res.json(rows[0]);
    } catch (err) {
        next(err);
    }
}

// POST /api/projects - create a new mini-project (section 27: POST/PATCH /projects)
async function createProject(req, res, next) {
    try {
        const { departmentId, title, academicYear, semester, students } = req.body || {};
        const facultyMentorName = cleanName(req.body.facultyMentorName);
        const coordinatorName = cleanName(req.body.coordinatorName);
        const reviewerName = cleanName(req.body.reviewerName);
        let themeName = cleanName(req.body.themeName);
        let themeId = req.body.themeId;
        const artefactTitle = String(req.body.artefactTitle ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);

        if (!departmentId || !title || !title.trim()) {
            return res.status(400).json({ error: 'departmentId and title are required.' });
        }

        if (themeId && !themeName) {
            const { rows: tRows } = await pool.query(`SELECT name FROM themes WHERE id = $1`, [themeId]);
            if (tRows[0]) themeName = tRows[0].name;
        } else if (!themeId && themeName) {
            const { rows: tRows } = await pool.query(
                `INSERT INTO themes (department_id, name) VALUES ($1, $2)
                 ON CONFLICT (department_id, name) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [departmentId, themeName]
            );
            themeId = tRows[0]?.id;
        }

        if (!themeName) return res.status(400).json({ error: 'Theme name is required.' });
        if (!artefactTitle) return res.status(400).json({ error: 'Artefact title is required.' });

        const termProblem = validateTerm(academicYear, semester);
        if (termProblem) return res.status(400).json({ error: termProblem });

        // Every project has a fixed team of exactly four students.
        const team = validateTeam(students);
        if (team.error) {
            return res.status(400).json({ error: team.error });
        }

        const srnProblem = await srnConflictMessage(pool, team.students.map((s) => s.srn), null);
        if (srnProblem) return res.status(409).json({ error: srnProblem });

        const { rows: deptRows } = await pool.query(
            `SELECT id, institute_id FROM departments WHERE id = $1`,
            [departmentId]
        );
        const department = deptRows[0];
        if (!department) {
            return res.status(404).json({ error: 'Department not found.' });
        }

        // Reuse the project-access rule with a synthetic "project" shaped from
        // the target department, since the real project does not exist yet.
        const syntheticProject = { institute_id: department.institute_id, department_id: department.id, mentor_user_id: null };
        if (!canAccessProject(req.user, syntheticProject)) {
            return res.status(403).json({ error: 'You are not authorized to create a project in this department.' });
        }

        const mentorUserId = await findInstituteUserByName(facultyMentorName, department.institute_id);

        const { rows: instRows } = await pool.query(`SELECT code FROM institutes WHERE id = $1`, [department.institute_id]);
        const instituteCode = instRows[0]?.code || 'AL';
        // Project, its first status entry and its four students are created
        // together or not at all.
        let rows;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // One project is numbered at a time. Without this, two people saving at
            // once could pick the same project code, and the failed save would use
            // up a Team ID / Artefact ID, leaving a gap in the sequence.
            await client.query(`SELECT pg_advisory_xact_lock(hashtext('apnileap:new-project'))`);
            // Next number = highest existing suffix + 1 (not a row count, which
            // would collide with an existing code after any project is removed).
            const { rows: maxRows } = await client.query(
                `SELECT COALESCE(MAX(NULLIF(regexp_replace(project_code, '^.*-', ''), '')::int), 0) AS max_seq
                 FROM projects WHERE project_code LIKE $1`,
                [`AL-${instituteCode}-%`]
            );
            const projectCode = `AL-${instituteCode}-${String(Number(maxRows[0].max_seq) + 1).padStart(3, '0')}`;
            ({ rows } = await client.query(
                `INSERT INTO projects (project_code, title, institute_id, department_id, mentor_user_id, faculty_mentor_name, coordinator_name, reviewer_name,
                                      academic_year, semester, created_by, theme_name, artefact_title, theme_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
                [projectCode, title.trim(), department.institute_id, department.id, mentorUserId, facultyMentorName, coordinatorName, reviewerName,
                 academicYear || null, semester || null, req.user.id,
                 themeName, artefactTitle, themeId]
            ));
            await client.query(
                `INSERT INTO status_history (project_id, previous_status, new_status, reason, changed_by)
                 VALUES ($1, NULL, 'GREEN', 'Project created', $2)`,
                [rows[0].id, req.user.id]
            );
            for (const s of team.students) {
                await client.query(
                    `INSERT INTO project_students (project_id, slot, name, srn, semester, division)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [rows[0].id, s.slot, s.name, s.srn, s.semester, s.division]
                );
            }
            await ensureStudentAccounts(client, team.students);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            if (isSrnDuplicateError(err)) {
                return res.status(409).json({ error: 'One of these SRNs is already on another project team.' });
            }
            if (err.code === '23505' && String(err.constraint || '').includes('project_code')) {
                return res.status(409).json({ error: 'Another project was created at the same moment. Please try again.' });
            }
            throw err;
        } finally {
            client.release();
        }

        await logAudit({ userId: req.user.id, action: 'PROJECT_CREATE', entityType: 'project', entityId: rows[0].id, instituteId: department.institute_id, ipAddress: req.ip });

        // Section 25: PostgreSQL record -> Jira issue -> Confluence page.
        // Best-effort; a Jira/Confluence outage must not fail project creation.
        const { rows: fullRows } = await pool.query(
            `SELECT p.*, i.name AS institute_name, d.name AS department_name, COALESCE(p.faculty_mentor_name, mu.full_name) AS mentor_name
             FROM projects p
             JOIN institutes i ON i.id = p.institute_id
             JOIN departments d ON d.id = p.department_id
             LEFT JOIN users mu ON mu.id = p.mentor_user_id
             WHERE p.id = $1`,
            [rows[0].id]
        );
        await provisionIntegrations(fullRows[0], req.user.id);

        res.status(201).json({ project: rows[0] });
    } catch (err) {
        next(err);
    }
}

// GET /api/projects/:projectId/links
async function listLinks(req, res, next) {
    try {
        const { rows } = await pool.query(
            `SELECT l.*, u.full_name AS created_by_name FROM project_links l
             LEFT JOIN users u ON u.id = l.created_by
             WHERE l.project_id = $1 ORDER BY l.created_at DESC`,
            [req.params.projectId]
        );
        res.json({ links: rows });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/links
async function addLink(req, res, next) {
    try {
        const { linkType, label, url } = req.body || {};
        const allowedTypes = ['GITHUB', 'CONFLUENCE', 'JIRA', 'REPORT', 'DEMO', 'OTHER'];
        if (!label || !label.trim() || !url || !url.trim()) {
            return res.status(400).json({ error: 'label and url are required.' });
        }
        if (linkType && !allowedTypes.includes(linkType)) {
            return res.status(400).json({ error: `linkType must be one of ${allowedTypes.join(', ')}.` });
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('bad protocol');
        } catch (e) {
            return res.status(400).json({ error: 'url must be a valid http(s) URL.' });
        }

        const { rows } = await pool.query(
            `INSERT INTO project_links (project_id, link_type, label, url, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.params.projectId, linkType || 'OTHER', label, parsedUrl.toString(), req.user.id]
        );
        await logAudit({ userId: req.user.id, action: 'PROJECT_LINK_CREATE', entityType: 'project_link', entityId: rows[0].id, instituteId: req.project.institute_id, ipAddress: req.ip });
        res.status(201).json({ link: rows[0] });
    } catch (err) {
        next(err);
    }
}

async function loadFullProject(projectId) {
    const { rows } = await pool.query(
        `SELECT p.*, i.name AS institute_name, d.name AS department_name, COALESCE(p.faculty_mentor_name, mu.full_name) AS mentor_name
         FROM projects p
         JOIN institutes i ON i.id = p.institute_id
         JOIN departments d ON d.id = p.department_id
         LEFT JOIN users mu ON mu.id = p.mentor_user_id
         WHERE p.id = $1`,
        [projectId]
    );
    return rows[0];
}

// POST /api/projects/:projectId/jira - create a Jira issue for a project that
// does not have one yet (e.g. one created before this integration existed).
async function createJiraLink(req, res, next) {
    try {
        if (!jiraService.isConfigured()) {
            return res.status(503).json({ error: 'Jira integration is not configured on this server.' });
        }
        const { rows: existing } = await pool.query(`SELECT jira_issue_key FROM jira_links WHERE project_id = $1 LIMIT 1`, [req.params.projectId]);
        if (existing[0]) {
            return res.status(409).json({ error: `This project is already linked to Jira issue ${existing[0].jira_issue_key}.` });
        }

        const project = await loadFullProject(req.params.projectId);
        const jiraIssue = await jiraService.createJiraIssue(project);
        await pool.query(
            `INSERT INTO jira_links (project_id, jira_issue_key, jira_issue_id, link_type) VALUES ($1,$2,$3,'PROJECT')`,
            [project.id, jiraIssue.key, jiraIssue.id]
        );
        await logAudit({ userId: req.user.id, action: 'JIRA_ISSUE_CREATE', entityType: 'project', entityId: project.id, instituteId: project.institute_id, ipAddress: req.ip });

        res.status(201).json({ jiraLink: { key: jiraIssue.key, url: `${(process.env.JIRA_BASE_URL || '').replace(/\/$/, '')}/browse/${jiraIssue.key}` } });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/confluence - create a documentation page for
// a project that does not have one yet.
async function createConfluenceLink(req, res, next) {
    try {
        if (!confluenceService.isConfigured()) {
            return res.status(503).json({ error: 'Confluence integration is not configured on this server.' });
        }
        const { rows: existing } = await pool.query(`SELECT confluence_page_id FROM confluence_links WHERE project_id = $1 LIMIT 1`, [req.params.projectId]);
        if (existing[0]) {
            return res.status(409).json({ error: 'This project already has a Confluence page.' });
        }

        const project = await loadFullProject(req.params.projectId);
        const { rows: jiraRows } = await pool.query(`SELECT jira_issue_key FROM jira_links WHERE project_id = $1 LIMIT 1`, [req.params.projectId]);
        const page = await confluenceService.createConfluencePage(project, jiraRows[0]?.jira_issue_key || null);
        await pool.query(
            `INSERT INTO confluence_links (project_id, confluence_page_id, page_url, link_type) VALUES ($1,$2,$3,'PROJECT_DOCS')`,
            [project.id, page.id, page.url]
        );
        await logAudit({ userId: req.user.id, action: 'CONFLUENCE_PAGE_CREATE', entityType: 'project', entityId: project.id, instituteId: project.institute_id, ipAddress: req.ip });

        res.status(201).json({ confluenceLink: { pageId: page.id, url: page.url } });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/sync - push the project's current state to
// its existing Jira issue and Confluence page.
async function syncProject(req, res, next) {
    try {
        const project = await loadFullProject(req.params.projectId);
        const { rows: jiraRows } = await pool.query(`SELECT jira_issue_key FROM jira_links WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.params.projectId]);
        const { rows: confluenceRows } = await pool.query(`SELECT confluence_page_id FROM confluence_links WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.params.projectId]);

        if (!jiraRows[0] && !confluenceRows[0]) {
            return res.status(400).json({ error: 'This project has no Jira issue or Confluence page to sync. Create one first.' });
        }

        const results = { jira: null, confluence: null };

        if (jiraRows[0]) {
            try {
                await jiraService.updateJiraIssue(jiraRows[0].jira_issue_key, { summary: `[${project.project_code}] ${project.title}` });
                await jiraService.addJiraComment(jiraRows[0].jira_issue_key, `Synced from ApniLeap Portal. Current RAG status: ${project.rag_status}, Completion: ${project.completion_pct}%.`);
                results.jira = 'synced';
            } catch (err) {
                results.jira = `failed: ${err.message}`;
            }
        }

        if (confluenceRows[0]) {
            try {
                await confluenceService.updateConfluencePage(confluenceRows[0].confluence_page_id, project, jiraRows[0]?.jira_issue_key || null);
                results.confluence = 'synced';
            } catch (err) {
                results.confluence = `failed: ${err.message}`;
            }
        }

        await logAudit({ userId: req.user.id, action: 'PROJECT_SYNC', entityType: 'project', entityId: project.id, instituteId: project.institute_id, details: results, ipAddress: req.ip });
        res.json({ results });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getProject, updateProject, changeStatus, getHistory, createProject, listLinks, addLink,
    createJiraLink, createConfluenceLink, syncProject, nextIds,
    findInstituteUserByName, provisionIntegrations };
