const express = require('express');
const { updateMilestone } = require('../controllers/milestone.controller');
const { addMeasurement, listMeasurements } = require('../controllers/kpi.controller');
const { updateIssue } = require('../controllers/issue.controller');
const { updateAction, verifyAction } = require('../controllers/action.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// These routes address individual entities directly (not nested under a known
// project id), so each controller loads the parent project itself and applies
// the same canAccessProject() tenant check before making any change.
// verifyAction has its own isAuthorizedApprover check inside the controller
// because that approver list differs from the general mentor-and-up gate.
const MENTOR_UP = ['FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];

// Roles that can update an issue's content or status.
// Students are included here because the controller itself enforces:
//   - students can only edit their OWN challenge (the one they raised)
//   - students cannot change status or escalation level
const ISSUE_UPDATE_ROLES = ['STUDENT', 'FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];

// Roles that can add a KPI measurement.
// Students are included here because the controller enforces that
// they can only add measurements to their own project's KPIs.
const KPI_MEASUREMENT_ROLES = ['STUDENT', 'FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];

const milestoneRouter = express.Router();
milestoneRouter.use(authenticate);
milestoneRouter.put('/:id', requireRole(...MENTOR_UP), updateMilestone);

const kpiRouter = express.Router();
kpiRouter.use(authenticate);
// GET /api/kpis/:id/measurements — full history, all roles with project access
kpiRouter.get('/:id/measurements', authenticate, listMeasurements);
// POST /api/kpis/:id/measurements — students + mentors can log measurements
kpiRouter.post('/:id/measurements', requireRole(...KPI_MEASUREMENT_ROLES), addMeasurement);

const issueRouter = express.Router();
issueRouter.use(authenticate);
// PUT /api/issues/:id — students (own issue, content only) + mentors/HOD (full edit incl. status)
issueRouter.put('/:id', requireRole(...ISSUE_UPDATE_ROLES), updateIssue);

const actionRouter = express.Router();
actionRouter.use(authenticate);
actionRouter.put('/:id', requireRole(...MENTOR_UP), updateAction);
actionRouter.post('/:id/verify', verifyAction);

module.exports = { milestoneRouter, kpiRouter, issueRouter, actionRouter };
