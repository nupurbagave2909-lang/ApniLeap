const { pool } = require('../config/db');
const { canAccessProject, loadProject, isStudentOnly } = require('../services/access.service');
const { logAudit } = require('../services/audit.service');
const jiraService = require('../services/jira.service');

// GET /api/projects/:projectId/kpis
// Visible to all roles with project access (Student sees own project only).
// Live syncs any Jira KPI tickets and ensures starter KPIs are visible.
async function listKpis(req, res, next) {
    try {
        const projectId = req.params.projectId;
        const project = req.project || await loadProject(projectId);

        // 1. Sync from Jira if linked
        if (project && jiraService.isConfigured()) {
            const projectKey = (project.project_code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (projectKey) {
                try {
                    const jiraIssues = await jiraService.fetchJiraProjectIssues(projectKey);
                    for (const ji of jiraIssues) {
                        const summary = ji.fields?.summary || '';
                        if (summary.startsWith('[KPI]')) {
                            const match = summary.match(/^\[KPI\]\s*(.*?)(?:\s*\(Target:\s*([^)]*)\))?$/i);
                            const kpiName = (match ? match[1] : summary.replace(/^\[KPI\]\s*/i, '')).trim();
                            const targetRaw = (match && match[2]) ? match[2].trim() : '';
                            const targetParts = targetRaw.split(/\s+/);
                            const targetVal = targetParts[0] || 'Target met';
                            const targetUnit = targetParts.slice(1).join(' ') || '';

                            const { rows: existing } = await pool.query(
                                `SELECT id FROM kpis WHERE project_id = $1 AND (jira_issue_key = $2 OR name = $3)`,
                                [projectId, ji.key, kpiName]
                            );
                            if (existing.length === 0) {
                                await pool.query(
                                    `INSERT INTO kpis (project_id, name, target_value, unit, jira_issue_key, owner_user_id)
                                     VALUES ($1, $2, $3, $4, $5, $6)`,
                                    [projectId, kpiName, targetVal, targetUnit, ji.key, project.mentor_user_id || null]
                                );
                            } else {
                                await pool.query(
                                    `UPDATE kpis SET jira_issue_key = $1 WHERE id = $2 AND (jira_issue_key IS NULL OR jira_issue_key != $1)`,
                                    [ji.key, existing[0].id]
                                );
                            }
                        }
                    }
                } catch (e) {
                    console.error('Jira KPI sync error (non-fatal):', e.message);
                }

                // Check for any existing KPIs on this project that lack Jira keys and link them
                try {
                    const { rows: unlinked } = await pool.query(
                        `SELECT id, name, target_value, unit FROM kpis WHERE project_id = $1 AND (jira_issue_key IS NULL OR jira_issue_key = '')`,
                        [projectId]
                    );
                    for (const u of unlinked) {
                        try {
                            const created = await jiraService.createJiraKpi(
                                project,
                                { name: u.name, targetValue: u.target_value, unit: u.unit },
                                { fullName: 'Faculty Mentor' }
                            );
                            if (created?.key) {
                                await pool.query(`UPDATE kpis SET jira_issue_key = $1 WHERE id = $2`, [created.key, u.id]);
                            }
                        } catch (e) {
                            console.warn(`Could not sync unlinked KPI ${u.id} to Jira:`, e.message);
                        }
                    }
                } catch (e) {
                    console.warn('Unlinked KPI check error:', e.message);
                }
            }
        }

        // 2. Auto-seed standard starter KPIs if project still has none
        const { rows: countRows } = await pool.query(`SELECT count(*)::int AS count FROM kpis WHERE project_id = $1`, [projectId]);
        if (countRows[0].count === 0) {
            const starterKpis = [
                { name: 'Model Inference & System Latency', target: '50', unit: 'ms' },
                { name: 'Pipeline Throughput & Reliability', target: '99', unit: '%' },
                { name: 'Test Coverage & Validation Accuracy', target: '85', unit: '%' },
            ];
            for (const s of starterKpis) {
                let jKey = null;
                if (project && jiraService.isConfigured()) {
                    try {
                        const created = await jiraService.createJiraKpi(project, { name: s.name, targetValue: s.target, unit: s.unit }, { fullName: 'Faculty Mentor' });
                        jKey = created?.key;
                    } catch (e) {
                        console.warn(`Could not push starter KPI to Jira:`, e.message);
                    }
                }
                await pool.query(
                    `INSERT INTO kpis (project_id, name, target_value, unit, jira_issue_key, owner_user_id)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [projectId, s.name, s.target, s.unit, jKey, project?.mentor_user_id || null]
                );
            }
        }

        // 3. Return all KPIs with latest measurement
        const { rows } = await pool.query(
            `SELECT k.*, u.full_name AS owner_name,
                    (SELECT row_to_json(m) FROM (
                        SELECT measured_value, evidence, measured_at, recorded_by,
                               (SELECT full_name FROM users WHERE id = km.recorded_by) AS recorded_by_name
                        FROM kpi_measurements km WHERE km.kpi_id = k.id
                        ORDER BY km.measured_at DESC LIMIT 1
                    ) m) AS latest_measurement
             FROM kpis k
             LEFT JOIN users u ON u.id = k.owner_user_id
             WHERE k.project_id = $1
             ORDER BY k.created_at`,
            [projectId]
        );
        const kpis = rows.map((k) => ({
            ...k,
            jira_url: k.jira_issue_key ? `${jiraService.baseUrl()}/browse/${k.jira_issue_key}` : null,
        }));
        res.json({ kpis });
    } catch (err) {
        next(err);
    }
}

// POST /api/projects/:projectId/kpis
// Defining a new KPI is a Faculty Mentor / HOD / Admin action only.
// Automatically syncs to Jira if configured.
async function createKpi(req, res, next) {
    try {
        const { name, targetValue, unit } = req.body || {};
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'KPI name is required.' });
        }

        const project = req.project || await loadProject(req.params.projectId);

        let jiraKey = null;
        if (jiraService.isConfigured()) {
            try {
                const jiraRes = await jiraService.createJiraKpi(
                    project,
                    { name: name.trim(), targetValue, unit },
                    req.user
                );
                if (jiraRes?.key) {
                    jiraKey = jiraRes.key;
                }
            } catch (err) {
                console.error(`Jira KPI creation error for project ${project.id} (non-fatal):`, err.message);
            }
        }

        const { rows } = await pool.query(
            `INSERT INTO kpis (project_id, name, target_value, unit, owner_user_id, jira_issue_key)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.params.projectId, name.trim(), targetValue || null, unit || null, req.user.id, jiraKey]
        );
        const kpi = rows[0];

        await logAudit({
            userId: req.user.id,
            action: 'KPI_CREATE',
            entityType: 'kpi',
            entityId: kpi.id,
            instituteId: project.institute_id,
            details: { jiraKey },
            ipAddress: req.ip,
        });

        res.status(201).json({
            kpi: {
                ...kpi,
                jira_url: kpi.jira_issue_key ? `${jiraService.baseUrl()}/browse/${kpi.jira_issue_key}` : null,
            },
        });
    } catch (err) {
        next(err);
    }
}

// POST /api/kpis/:id/measurements
// Role-based access:
//   Student -> can add measurement for KPIs on their own project.
//   Faculty / HOD / Admin -> can add measurements on assigned projects.
// Automatically records update to Jira ticket if linked.
async function addMeasurement(req, res, next) {
    try {
        const { rows: kpiRows } = await pool.query(`SELECT * FROM kpis WHERE id = $1`, [req.params.id]);
        const kpi = kpiRows[0];
        if (!kpi) return res.status(404).json({ error: 'KPI not found.' });

        const project = await loadProject(kpi.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to update this KPI.' });
        }

        const isStudent = isStudentOnly(req.user);
        if (isStudent && !(req.user.projectIds || []).includes(project.id)) {
            return res.status(403).json({ error: 'You can only add KPI measurements for your own project.' });
        }

        const { measuredValue, evidence } = req.body || {};
        if (measuredValue === undefined || measuredValue === null || String(measuredValue).trim() === '') {
            return res.status(400).json({ error: 'measuredValue is required.' });
        }

        const { rows } = await pool.query(
            `INSERT INTO kpi_measurements (kpi_id, measured_value, evidence, recorded_by)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [req.params.id, measuredValue, evidence || null, req.user.id]
        );
        const measurement = rows[0];

        // Jira Sync: post measurement update as comment on the KPI Jira ticket
        if (kpi.jira_issue_key && jiraService.isConfigured()) {
            jiraService.recordJiraKpiMeasurement(kpi.jira_issue_key, kpi, measurement, req.user)
                .catch((e) => console.error('Jira KPI measurement sync error (non-fatal):', e.message));
        }

        await logAudit({
            userId: req.user.id,
            action: 'KPI_MEASUREMENT_ADD',
            entityType: 'kpi',
            entityId: req.params.id,
            instituteId: project.institute_id,
            details: { isStudent, measuredValue, jiraKey: kpi.jira_issue_key },
            ipAddress: req.ip,
        });

        res.status(201).json({ measurement });
    } catch (err) {
        next(err);
    }
}

// GET /api/kpis/:id/measurements — full measurement history for a KPI
async function listMeasurements(req, res, next) {
    try {
        const { rows: kpiRows } = await pool.query(`SELECT * FROM kpis WHERE id = $1`, [req.params.id]);
        const kpi = kpiRows[0];
        if (!kpi) return res.status(404).json({ error: 'KPI not found.' });

        const project = await loadProject(kpi.project_id);
        if (!project || !canAccessProject(req.user, project)) {
            return res.status(403).json({ error: 'You are not authorized to view this KPI.' });
        }

        const { rows } = await pool.query(
            `SELECT m.*, u.full_name AS recorded_by_name
             FROM kpi_measurements m
             LEFT JOIN users u ON u.id = m.recorded_by
             WHERE m.kpi_id = $1
             ORDER BY m.measured_at DESC`,
            [req.params.id]
        );
        res.json({ measurements: rows });
    } catch (err) {
        next(err);
    }
}

module.exports = { listKpis, createKpi, addMeasurement, listMeasurements };
