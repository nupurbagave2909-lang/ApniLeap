const express = require('express');
const {
    getProject, updateProject, changeStatus, getHistory, createProject, nextIds, listLinks, addLink,
    createJiraLink, createConfluenceLink, syncProject,
} = require('../controllers/project.controller');
const { listMilestones, createMilestone } = require('../controllers/milestone.controller');
const { listKpis, createKpi, addMeasurement, listMeasurements } = require('../controllers/kpi.controller');
const { listIssues, createIssue, updateIssue } = require('../controllers/issue.controller');
const { listActions, createAction } = require('../controllers/action.controller');
const { listReviews, createReview } = require('../controllers/review.controller');
const { listStudents, replaceStudents } = require('../controllers/student.controller');
const {
    listWorkspaceTasks, createWorkspaceTask, updateWorkspaceTask, deleteWorkspaceTask,
} = require('../controllers/workspace.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireProjectScope } = require('../middleware/tenant.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

// Section 4 decision rights: a Student may view and raise issues/challenges
// on their project, but must not be able to change RAG status, edit the
// project definition, or create milestones/KPIs/corrective actions/reviews -
// those belong to mentors, reviewers and administrators. Read-only
// Stakeholders are excluded from every write below by the same logic.
const MENTOR_UP = ['FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];
const REVIEWER_UP = ['REVIEWER', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];

// Everyone except a Read-only Stakeholder may raise a challenge/issue on a
// project they can see - including Students (section 2.1). Read-only access
// must never allow modifying records (section 4), so it is the one role
// explicitly denied here rather than allow-listed like the gates above.
function blockReadOnly(req, res, next) {
    const roles = req.user.roles || [];
    const onlyReadOnly = roles.length > 0 && roles.every((r) => r === 'READ_ONLY_STAKEHOLDER');
    if (onlyReadOnly) {
        return res.status(403).json({ error: 'Read-only access does not permit modifying records.' });
    }
    next();
}

router.use(authenticate);

// Creating a project has no projectId yet, so it sits outside the
// requireProjectScope('projectId') gate below; createProject checks
// department-level access itself.
router.get('/next-ids', requireRole(...MENTOR_UP), nextIds);
router.post('/', requireRole(...MENTOR_UP), createProject);

const STATUS_EDIT_ROLES = ['FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'PLATFORM_ADMIN'];
const PROJECT_UPDATE_ROLES = ['FACULTY_MENTOR', 'STUDENT', 'DEPARTMENT_HEAD', 'PLATFORM_ADMIN'];

router.use('/:projectId', requireProjectScope('projectId'));

router.get('/:projectId', getProject);
router.put('/:projectId', requireRole(...PROJECT_UPDATE_ROLES), updateProject);
router.post('/:projectId/status', requireRole(...STATUS_EDIT_ROLES), changeStatus);
router.get('/:projectId/history', getHistory);

router.get('/:projectId/milestones', listMilestones);
router.post('/:projectId/milestones', requireRole(...MENTOR_UP), createMilestone);

router.get('/:projectId/kpis', listKpis);
router.post('/:projectId/kpis', requireRole(...MENTOR_UP), createKpi);

// Any authenticated user with project access may raise a challenge/issue,
// including students (section 2.1) - except a Read-only Stakeholder, who
// must not modify any record.
router.get('/:projectId/issues', listIssues);
router.post('/:projectId/issues', blockReadOnly, createIssue);

router.get('/:projectId/actions', listActions);
router.post('/:projectId/actions', requireRole(...MENTOR_UP), createAction);

router.get('/:projectId/reviews', listReviews);
router.post('/:projectId/reviews', requireRole(...REVIEWER_UP), createReview);

router.get('/:projectId/students', listStudents);
router.put('/:projectId/students', requireRole(...PROJECT_UPDATE_ROLES), replaceStudents);

router.get('/:projectId/links', listLinks);
router.post('/:projectId/links', requireRole(...MENTOR_UP), addLink);

router.get('/:projectId/workspace-tasks', listWorkspaceTasks);
router.post('/:projectId/workspace-tasks', blockReadOnly, createWorkspaceTask);
router.put('/:projectId/workspace-tasks/:taskId', blockReadOnly, updateWorkspaceTask);
router.delete('/:projectId/workspace-tasks/:taskId', blockReadOnly, deleteWorkspaceTask);

router.post('/:projectId/jira', requireRole(...MENTOR_UP), createJiraLink);
router.post('/:projectId/confluence', requireRole(...MENTOR_UP), createConfluenceLink);
router.post('/:projectId/sync', requireRole(...MENTOR_UP), syncProject);

module.exports = router;
