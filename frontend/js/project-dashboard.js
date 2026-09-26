const APPROVER_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'];
const MENTOR_UP_ROLES = ['PLATFORM_ADMIN', 'FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];
const REVIEWER_UP_ROLES = ['PLATFORM_ADMIN', 'REVIEWER', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];
const ALLOWED_TRANSITIONS = { GREEN: ['YELLOW'], YELLOW: ['GREEN', 'RED'], RED: ['YELLOW', 'GREEN'] };

let projectId;
let currentProject;
let currentUser;
let statusModal, issueModal, actionModal, reviewModal, milestoneModal, kpiModal, measurementModal, completeActionModal, linkModal, teamModal, detailsModal;

function getProjectId() {
  return new URLSearchParams(window.location.search).get('id');
}

function formatDate(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  // A date without a time (2026-10-05) is shown as that calendar day in any time zone.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  return new Date(iso).toLocaleString();
}

function isAuthorizedApprover() {
  return (currentUser?.roles || []).some((r) => APPROVER_ROLES.includes(r));
}
function isMentorUp() {
  return (currentUser?.roles || []).some((r) => MENTOR_UP_ROLES.includes(r));
}
function isReviewerUp() {
  return (currentUser?.roles || []).some((r) => REVIEWER_UP_ROLES.includes(r));
}
// A Read-only Stakeholder must not modify any record (section 4), including
// raising an issue - the one write everyone else (even Students) may do.
function isReadOnlyOnly() {
  const roles = currentUser?.roles || [];
  // Students are NOT read-only: they can log their own challenges and add KPI measurements.
  return roles.length > 0 && roles.every((r) => r === 'READ_ONLY_STAKEHOLDER');
}
function isCurrentUserStudent() {
  return (currentUser?.roles || []).some((r) => r === 'STUDENT');
}

// Client-side hiding is a UX convenience only - the backend re-checks role
// on every write, so this never substitutes for the real boundary.
function applyRoleVisibility() {
  const mentorUp = isMentorUp();
  const reviewerUp = isReviewerUp();
  const isStudent = Student.isStudent();

  // Top header button "Challenges" is always visible
  const btnNavChallenges = document.getElementById('btnNavChallenges');
  if (btnNavChallenges) btnNavChallenges.classList.remove('d-none');

  // Role-based button on Challenges & Actions section:
  // Student can ONLY add a challenge
  // Mentor/Admin/non-student roles can add action (not challenge)
  const btnAddChallengeBtn = document.getElementById('btnAddChallengeBtn');
  if (btnAddChallengeBtn) btnAddChallengeBtn.classList.toggle('d-none', !isStudent);

  const btnAddActionBtn = document.getElementById('btnAddActionBtn');
  if (btnAddActionBtn) btnAddActionBtn.classList.toggle('d-none', !mentorUp || isStudent);

  const roles = currentUser?.roles || [];
  const isHod = roles.includes('DEPARTMENT_HEAD');
  const isAdmin = roles.includes('PLATFORM_ADMIN');
  const isGuide = roles.includes('FACULTY_MENTOR') &&
    (!currentProject ||
      currentProject.mentor_user_id === currentUser?.id ||
      (currentProject.faculty_mentor_name && currentUser?.fullName &&
        currentProject.faculty_mentor_name.trim().toLowerCase() === currentUser.fullName.trim().toLowerCase()) ||
      (currentUser?.projectIds || []).includes(currentProject.id));
  const canEditStatus = isGuide || isHod || isAdmin;

  const btnUpdateStatus = document.getElementById('btnUpdateStatus');
  if (btnUpdateStatus) btnUpdateStatus.classList.toggle('d-none', !canEditStatus);

  const btnAddReview = document.getElementById('btnAddReview');
  if (btnAddReview) btnAddReview.classList.toggle('d-none', !reviewerUp);
  const btnAddReview2 = document.getElementById('btnAddReview2');
  if (btnAddReview2) btnAddReview2.classList.toggle('d-none', !reviewerUp);

  const btnAddMilestone = document.getElementById('btnAddMilestone');
  if (btnAddMilestone) btnAddMilestone.classList.toggle('d-none', !mentorUp);

  const btnAddKpi = document.getElementById('btnAddKpi');
  if (btnAddKpi) btnAddKpi.classList.toggle('d-none', !mentorUp);

  // Project Tracking edit button: ONLY for Guide and Students
  const canEditTracking = isGuide || isStudent || isAdmin;
  const btnEditDefinition = document.getElementById('btnEditDefinition');
  if (btnEditDefinition) btnEditDefinition.classList.toggle('d-none', !canEditTracking);

  const btnAddLink = document.getElementById('btnAddLink');
  if (btnAddLink) btnAddLink.classList.toggle('d-none', !mentorUp);
  const btnAddLink2 = document.getElementById('btnAddLink2');
  if (btnAddLink2) btnAddLink2.classList.toggle('d-none', !mentorUp);

  // Edit project details and team details: ONLY for Faculty Guide, Students, HOD, Platform Administrator
  const canEditDetailsAndTeam = isGuide || isStudent || isHod || isAdmin;

  const btnEditTeam = document.getElementById('btnEditTeam');
  if (btnEditTeam) btnEditTeam.classList.toggle('d-none', !canEditDetailsAndTeam);

  const btnEditDetails = document.getElementById('btnEditDetails');
  if (btnEditDetails) btnEditDetails.classList.toggle('d-none', !canEditDetailsAndTeam);
}

// Overview | Assessment | Project Tracking. Project Tracking holds seven sections
// (Definition, Milestones, KPIs, Challenges, Actions, Reviews, Documentation)
// as a second row of tabs on the same page.
const TRACKING_SECTIONS = ['definition', 'milestones', 'kpis', 'challenges', 'actions', 'reviews', 'documentation'];
let currentSection = 'definition';

function switchSection(name) {
  if (!TRACKING_SECTIONS.includes(name)) name = 'definition';
  currentSection = name;
  document.querySelectorAll('#trackingTabs .nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sub === name);
  });
  document.querySelectorAll('.sub-pane').forEach((pane) => {
    pane.classList.toggle('d-none', pane.id !== `tab-${name}`);
  });
  if (name === 'kpis') loadKpis();
  if (name === 'challenges') loadChallengesAndActions();
  if (name === 'milestones') loadMilestones();
  if (name === 'reviews') loadReviews();
  if (name === 'documentation') loadLinks();
}

function switchTab(tabName) {
  // A section name opens Project Tracking on that section.
  if (TRACKING_SECTIONS.includes(tabName)) {
    switchSection(tabName);
    tabName = 'tracking';
  }
  document.querySelectorAll('#projectTabs .nav-link').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('d-none', pane.id !== `tab-${tabName}`);
  });
}

function showFormError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.style.display = 'block';
}
function clearFormError(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.style.display = 'none';
}

// ---------- Header / Overview ----------

function renderHeader() {
  const storedUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  const roles = storedUser?.roles || [];
  const isFacultyOnly = roles.includes('FACULTY_MENTOR') &&
    !roles.some((r) => ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'].includes(r));
  const isDean = roles.includes('DEAN_PRINCIPAL') || roles.includes('READ_ONLY_STAKEHOLDER') || roles.includes('REVIEWER');
  const hideStatus = roles.includes('READ_ONLY_STAKEHOLDER') || roles.includes('REVIEWER');

  if (Student.isStudent()) {
    document.getElementById('breadcrumb').textContent =
      [currentProject.institute_name, currentProject.department_name, currentProject.title].filter(Boolean).join(' / ');
  } else if (isFacultyOnly) {
    document.getElementById('breadcrumb').innerHTML =
      `<a href="dashboard.html">My Projects</a> / ${esc(currentProject.title)}`;
  } else if (isDean) {
    let bc = `<a href="dashboard.html">Departments</a> / ` +
      `<a href="department-dashboard.html?id=${esc(currentProject.department_id)}">${esc(currentProject.department_name)}</a> / `;
    if (currentProject.theme_id && currentProject.theme_name) {
      bc += `<a href="theme-dashboard.html?id=${esc(currentProject.theme_id)}">${esc(currentProject.theme_name)}</a> / `;
    } else if (currentProject.theme_name) {
      bc += `<span>${esc(currentProject.theme_name)}</span> / `;
    }
    bc += esc(currentProject.title);
    document.getElementById('breadcrumb').innerHTML = bc;
  } else if (roles.includes('DEPARTMENT_HEAD')) {
    let bc = `<a href="dashboard.html">Themes</a> / `;
    if (currentProject.theme_id && currentProject.theme_name) {
      bc += `<a href="theme-dashboard.html?id=${esc(currentProject.theme_id)}">${esc(currentProject.theme_name)}</a> / `;
    } else if (currentProject.theme_name) {
      bc += `<span>${esc(currentProject.theme_name)}</span> / `;
    }
    bc += esc(currentProject.title);
    document.getElementById('breadcrumb').innerHTML = bc;
  } else {
    let breadcrumbHtml = `<a href="dashboard.html">Dashboard</a> / ` +
      `<a href="institute-dashboard.html?id=${esc(currentProject.institute_id)}">${esc(currentProject.institute_name)}</a> / ` +
      `<a href="department-dashboard.html?id=${esc(currentProject.department_id)}">${esc(currentProject.department_name)}</a> / `;
    if (currentProject.theme_id && currentProject.theme_name) {
      breadcrumbHtml += `<a href="theme-dashboard.html?id=${esc(currentProject.theme_id)}">${esc(currentProject.theme_name)}</a> / `;
    } else if (currentProject.theme_name) {
      breadcrumbHtml += `<span>${esc(currentProject.theme_name)}</span> / `;
    }
    breadcrumbHtml += esc(currentProject.title);
    document.getElementById('breadcrumb').innerHTML = breadcrumbHtml;
  }

  document.getElementById('projectTitle').textContent = currentProject.title;
  document.getElementById('projectMeta').innerHTML = `
    <span class="badge bg-secondary-subtle text-secondary-emphasis border">${esc(currentProject.project_code)}</span>
    <span class="text-muted">Team ID: <strong>${esc(currentProject.team_id)}</strong></span>
    <span class="text-muted">Artefact ID: <strong>${esc(currentProject.artefact_id)}</strong></span>
    <span class="text-muted">Faculty Mentor: ${esc(currentProject.mentor_name) || 'Unassigned'}</span>
    <span class="text-muted">Next review: ${formatDate(currentProject.next_review_at)}</span>
  `;
  const ragWrap = document.getElementById('ragBadgeWrap');
  if (ragWrap) {
    if (hideStatus) {
      ragWrap.classList.add('d-none');
    } else {
      ragWrap.classList.remove('d-none');
      ragWrap.innerHTML = ragDot(currentProject.rag_status, 'lg');
    }
  }
  const statusHistoryCard = document.getElementById('statusHistoryCard');
  if (statusHistoryCard) {
    statusHistoryCard.classList.toggle('d-none', hideStatus);
  }
  document.getElementById('completionLabel').textContent = `${currentProject.completion_pct}%`;
  document.getElementById('completionBar').style.width = `${esc(currentProject.completion_pct)}%`;

  const workspaceHref = `project-workspace.html?id=${encodeURIComponent(projectId)}`;
  const btnProjectWorkspace = document.getElementById('btnProjectWorkspace');
  if (btnProjectWorkspace) btnProjectWorkspace.href = workspaceHref;
  const btnTeamWorkspace = document.getElementById('btnTeamProjectWorkspace');
  if (btnTeamWorkspace) btnTeamWorkspace.href = workspaceHref;

  document.getElementById('overviewExecutionTable').innerHTML = `
    <tr><th>Team ID</th><td>${esc(currentProject.team_id)}</td></tr>
    <tr><th>Artefact ID</th><td>${esc(currentProject.artefact_id)}</td></tr>
    <tr><th>Theme Name</th><td>${esc(currentProject.theme_name) || 'Not set'}</td></tr>
    <tr><th>Artefact Title</th><td>${esc(currentProject.artefact_title) || 'Not set'}</td></tr>
    <tr><th>Institute</th><td>${esc(currentProject.institute_name)}</td></tr>
    <tr><th>Department</th><td>${esc(currentProject.department_name)}</td></tr>
    <tr><th>Faculty Mentor</th><td>${esc(currentProject.mentor_name) || 'Unassigned'}</td></tr>
    <tr><th>Project Coordinator</th><td>${esc(currentProject.coordinator_name) || 'Unassigned'}</td></tr>
    <tr><th>Reviewer</th><td>${esc(currentProject.reviewer_name) || 'Unassigned'}</td></tr>
    <tr><th>Academic Year</th><td>${esc(currentProject.academic_year) || 'Not set'}</td></tr>
    <tr><th>Semester</th><td>${esc(currentProject.semester) || 'Not set'}</td></tr>
    <tr><th>Phase</th><td>${esc(currentProject.project_phase)}</td></tr>
  `;
}

// ---------- Definition tab ----------

const DEFINITION_FIELDS = [
  ['need_statement', 'Need Statement'],
  ['problem_statement', 'Problem Statement'],
  ['objective', 'Objective'],
  ['learning_outcomes', 'Learning Outcomes'],
  ['foundation_courses', 'Foundation Courses Anchored'],
  ['functional_blocks', 'Functional Blocks'],
  ['interfaces', 'Interfaces'],
  ['dependencies', 'Dependencies'],
  ['expected_deliverables', 'Expected Deliverables'],
];

function renderDefinitionView() {
  const dl = document.createElement('dl');
  dl.className = 'al-definition-row mb-0';
  dl.innerHTML = DEFINITION_FIELDS.map(([field, label]) => `
    <dt>${label}</dt>
    <dd>${esc(currentProject[field]) || '<span class="text-muted">Not documented</span>'}</dd>
  `).join('');
  const view = document.getElementById('definitionView');
  view.innerHTML = '';
  view.appendChild(dl);
}

function renderDefinitionForm() {
  const form = document.getElementById('definitionForm');
  form.innerHTML = DEFINITION_FIELDS.map(([field, label]) => `
    <div class="mb-2">
      <label class="form-label">${label}</label>
      <textarea class="form-control" data-field="${field}" rows="2">${esc(currentProject[field]) || ''}</textarea>
    </div>
  `).join('') + `
    <div class="al-login-error" id="definitionError"></div>
    <div class="d-flex gap-2 mt-2">
      <button type="button" class="btn btn-al-primary btn-sm" id="btnSaveDefinition">Save</button>
      <button type="button" class="btn btn-outline-secondary btn-sm" id="btnCancelDefinition">Cancel</button>
    </div>
  `;

  document.getElementById('btnSaveDefinition').addEventListener('click', async () => {
    const payload = {};
    form.querySelectorAll('[data-field]').forEach((el) => { payload[el.dataset.field] = el.value; });
    try {
      const { project } = await Api.put(`/projects/${projectId}`, payload);
      currentProject = Object.assign(currentProject, project);
      renderDefinitionView();
      form.classList.add('d-none');
      document.getElementById('definitionView').classList.remove('d-none');
    } catch (err) {
      showFormError('definitionError', err.message);
    }
  });
  document.getElementById('btnCancelDefinition').addEventListener('click', () => {
    form.classList.add('d-none');
    document.getElementById('definitionView').classList.remove('d-none');
  });
}

// ---------- Milestones ----------

async function loadMilestones() {
  const tbody = document.getElementById('milestonesBody');
  try {
    const { milestones } = await Api.get(`/projects/${projectId}/milestones`);
    if (!milestones.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No milestones recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = milestones.map((m) => `
      <tr>
        <td><strong>${esc(m.title)}</strong>${m.description ? `<br><span class="text-muted" style="font-size:13px">${esc(m.description)}</span>` : ''}</td>
        <td>${formatDate(m.due_date)}</td>
        <td>${esc(m.status.replace('_', ' '))}</td>
        <td>${m.status !== 'COMPLETED' ? `<button class="btn btn-sm btn-outline-secondary" data-complete-milestone="${esc(m.id)}">Mark Complete</button>` : ''}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-complete-milestone]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await Api.put(`/milestones/${btn.dataset.completeMilestone}`, { status: 'COMPLETED' });
        loadMilestones();
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- KPIs ----------

async function loadKpis() {
  const tbody = document.getElementById('kpisBody');
  try {
    const { kpis } = await Api.get(`/projects/${projectId}/kpis`);
    if (!kpis.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No KPIs recorded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = kpis.map((k) => {
      // Students and Faculty Mentors can add measurements; HOD/Dean/Admin view only
      const canAddMeasurement = isCurrentUserStudent() || isMentorUp();
      const measureBtn = canAddMeasurement
        ? `<button class="btn btn-sm btn-outline-secondary" data-add-measurement="${esc(k.id)}">📊 Add Update</button>`
        : '<span class="text-muted" style="font-size:12px">View only</span>';
      return `
      <tr>
        <td>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <strong>${esc(k.name)}</strong>
            ${k.jira_issue_key ? `<a href="${esc(k.jira_url || '#')}" target="_blank" rel="noopener noreferrer" class="jira-tag" style="text-decoration:none;font-size:11px" title="View KPI in Jira">🏷️ ${esc(k.jira_issue_key)} ↗</a>` : ''}
          </div>
        </td>
        <td>${esc(k.target_value) || '<span class="text-muted">&ndash;</span>'} ${esc(k.unit) || ''}</td>
        <td>${k.latest_measurement ? `${esc(k.latest_measurement.measured_value)} <span class="text-muted" style="font-size:12.5px">(${formatDate(k.latest_measurement.measured_at)})</span><br><span class="text-muted" style="font-size:11.5px">by ${esc(k.latest_measurement.recorded_by_name) || 'Unknown'}</span>` : '<span class="text-muted">No updates yet</span>'}</td>
        <td>${esc(k.owner_name) || '<span class="text-muted">&ndash;</span>'}</td>
        <td>${measureBtn}</td>
      </tr>
    `;
    }).join('');
    tbody.querySelectorAll('[data-add-measurement]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('measurementKpiId').value = btn.dataset.addMeasurement;
        document.getElementById('measurementForm').reset();
        document.getElementById('measurementKpiId').value = btn.dataset.addMeasurement;
        clearFormError('measurementError');
        measurementModal.show();
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Challenges & Actions ----------

let loadedIssues = [];

function openAddActionModal(preselectedIssueId) {
  if (!loadedIssues.length) {
    alert('Please add a challenge before creating a corrective action.');
    return;
  }
  clearFormError('actionError');
  document.getElementById('actionForm').reset();
  const select = document.getElementById('actionIssueId');
  if (select) {
    select.innerHTML = '<option value="">Select challenge…</option>' +
      loadedIssues.map((i) => `<option value="${esc(i.id)}">${esc(i.title)}</option>`).join('');
    if (preselectedIssueId) {
      select.value = preselectedIssueId;
    }
  }
  actionModal.show();
}

// Student: open the issue modal pre-filled for editing their own challenge.
// Faculty/HOD can also use this to edit any issue's content.
function openEditIssueModal(issue) {
  clearFormError('issueError');
  const form = document.getElementById('issueForm');
  if (form) form.reset();
  // Pre-fill fields
  const titleEl = document.getElementById('issueTitle');
  const rcEl = document.getElementById('issueRootCause');
  const impactEl = document.getElementById('issueImpact');
  const supportEl = document.getElementById('issueSupportRequired');
  if (titleEl) titleEl.value = issue.title || '';
  if (rcEl) rcEl.value = issue.root_cause || '';
  if (impactEl) impactEl.value = issue.impact || '';
  if (supportEl) supportEl.value = issue.support_required || '';
  // Store the issue id so submit knows it's an edit
  const hiddenId = document.getElementById('issueEditId');
  if (hiddenId) hiddenId.value = issue.id;
  // Update modal title
  const modalTitle = document.querySelector('#issueModal .modal-title');
  if (modalTitle) modalTitle.textContent = 'Edit Challenge';
  issueModal.show();
}

async function loadChallengesAndActions() {
  const tbody = document.getElementById('challengesBody') || document.getElementById('issuesBody');
  if (!tbody) return;
  try {
    const [{ issues }, { actions }] = await Promise.all([
      Api.get(`/projects/${projectId}/issues`),
      Api.get(`/projects/${projectId}/actions`),
    ]);
    loadedIssues = issues || [];

    // Update actionIssueId options in actionModal if dropdown is present
    const issueSelect = document.getElementById('actionIssueId');
    if (issueSelect) {
      const cur = issueSelect.value;
      issueSelect.innerHTML = '<option value="">Select challenge…</option>' +
        loadedIssues.map((i) => `<option value="${esc(i.id)}">${esc(i.title)}</option>`).join('');
      if (cur) issueSelect.value = cur;
    }

    if (!loadedIssues.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No challenges recorded yet.</td></tr>';
      return;
    }

    // Group corrective actions by issue_id
    const actionsByIssue = {};
    (actions || []).forEach((a) => {
      if (a.issue_id) {
        if (!actionsByIssue[a.issue_id]) actionsByIssue[a.issue_id] = [];
        actionsByIssue[a.issue_id].push(a);
      }
    });

    const isStudent = Student.isStudent();
    const mentorUp = isMentorUp();

    tbody.innerHTML = loadedIssues.map((i) => {
      const issueActions = actionsByIssue[i.id] || [];

      // Column 1: Challenge / Issue
      const issueCol = `
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <strong>${esc(i.title)}</strong>
          ${i.jira_issue_key ? `<a href="${esc(i.jira_url || '#')}" target="_blank" rel="noopener noreferrer" class="jira-tag" style="text-decoration:none;font-size:11px" title="View in Jira">🏷️ ${esc(i.jira_issue_key)} ↗</a>` : ''}
        </div>
        <div class="text-muted" style="font-size:12.5px;margin-top:2px">
          Raised by ${esc(i.raised_by_name) || 'Unknown'} on ${formatDate(i.created_at)}
        </div>
        ${i.root_cause ? `<div class="text-muted" style="font-size:12px;margin-top:2px"><strong>Root Cause:</strong> ${esc(i.root_cause)}</div>` : ''}
        ${i.impact ? `<div class="text-muted" style="font-size:12px;margin-top:2px"><strong>Impact:</strong> ${esc(i.impact)}</div>` : ''}
        ${i.support_required ? `<div class="text-muted" style="font-size:12px;margin-top:2px"><strong>Support:</strong> ${esc(i.support_required)}</div>` : ''}
      `;

      // Column 2: Status / Escalation
      const statusCol = `
        <span class="badge bg-secondary">${esc((i.status || 'OPEN').replace('_', ' '))}</span>
        <div class="mt-1" style="font-size:12.5px">
          ${esc(i.escalation_level || 'LEVEL_1')}
          ${i.escalation_owner_name ? `<br><span class="text-muted">Owner: ${esc(i.escalation_owner_name)}</span>` : ''}
        </div>
      `;

      // Column 3: Corrective Action & Evidence
      let actionsCol = '';
      let dueDatesCol = '';

      if (issueActions.length === 0) {
        actionsCol = '<span class="text-muted">No corrective action</span>';
        dueDatesCol = '<span class="text-muted">&ndash;</span>';
      } else {
        actionsCol = issueActions.map((a) => `
          <div class="mb-2 pb-2 ${issueActions.length > 1 ? 'border-bottom' : ''}">
            <strong>${esc(a.description)}</strong>
            <span class="badge bg-light text-dark border ms-1" style="font-size:11px">${esc(a.status)}</span>
            <div class="text-muted" style="font-size:12px">Owner: ${esc(a.owner_name) || 'Unassigned'}</div>
            ${a.evidence ? `<div class="text-muted" style="font-size:12px">Evidence: ${esc(a.evidence)}</div>` : ''}
            ${a.verified_by_name ? `<div class="text-muted" style="font-size:12px">Verified by: ${esc(a.verified_by_name)}</div>` : ''}
          </div>
        `).join('');

        dueDatesCol = issueActions.map((a) => `
          <div class="mb-2 pb-2 ${issueActions.length > 1 ? 'border-bottom' : ''}">
            ${formatDate(a.due_date)}
          </div>
        `).join('');
      }

      // Column 5: Options
      let optionsCol = '';
      const isStudent = isCurrentUserStudent();
      if (isStudent) {
        // Students: can only edit their OWN challenge (the one they raised)
        const isOwnIssue = i.raised_by === currentUser?.id;
        if (isOwnIssue) {
          optionsCol = `<button class="btn btn-sm btn-outline-primary mb-1" data-edit-issue="${esc(i.id)}" title="Edit your challenge">✏️ Edit</button>`;
        } else {
          optionsCol = '<span class="text-muted" style="font-size:12px">Raised by teammate</span>';
        }
      } else if (mentorUp) {
        const addActionBtn = `<button class="btn btn-sm btn-outline-primary mb-1" data-add-action-for="${esc(i.id)}" data-challenge-title="${esc(i.title)}">+ Add Action</button>`;
        // Status change buttons for Faculty/HOD/Admin
        const statusBtns = [];
        if (i.status === 'OPEN' || i.status === 'IN_PROGRESS') {
          statusBtns.push(`<button class="btn btn-sm btn-outline-secondary mb-1" data-change-issue-status="${esc(i.id)}" data-new-status="IN_PROGRESS">Mark In Progress</button>`);
          statusBtns.push(`<button class="btn btn-sm btn-outline-success mb-1" data-change-issue-status="${esc(i.id)}" data-new-status="RESOLVED">Mark Resolved</button>`);
        }
        if (i.status === 'RESOLVED') {
          statusBtns.push(`<button class="btn btn-sm btn-outline-secondary mb-1" data-change-issue-status="${esc(i.id)}" data-new-status="CLOSED">Close</button>`);
        }
        const actionOptionBtns = issueActions.map((a) => {
          const canVerify = isAuthorizedApprover() && a.status === 'COMPLETED';
          const canComplete = a.status === 'OPEN' || a.status === 'IN_PROGRESS';
          const btns = [];
          if (canComplete) {
            btns.push(`<button class="btn btn-sm btn-outline-secondary mb-1" data-complete-action="${esc(a.id)}">Mark Completed</button>`);
          }
          if (canVerify) {
            btns.push(`<button class="btn btn-sm btn-outline-secondary mb-1" data-verify-action="${esc(a.id)}">Verify</button>`);
          }
          return btns.join(' ');
        }).filter(Boolean).join('<br>');

        optionsCol = `<div class="d-flex flex-column">${addActionBtn}${statusBtns.length ? `<div class="mt-1">${statusBtns.join('')}</div>` : ''}${actionOptionBtns ? `<div class="mt-1">${actionOptionBtns}</div>` : ''}</div>`;
      } else {
        optionsCol = '<span class="text-muted">&ndash;</span>';
      }

      return `
        <tr>
          <td>${issueCol}</td>
          <td>${statusCol}</td>
          <td>${actionsCol}</td>
          <td>${dueDatesCol}</td>
          <td>${optionsCol}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-add-action-for]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openAddActionModal(btn.dataset.addActionFor);
      });
    });

    tbody.querySelectorAll('[data-complete-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('completeActionId').value = btn.dataset.completeAction;
        document.getElementById('completeActionForm').reset();
        document.getElementById('completeActionId').value = btn.dataset.completeAction;
        clearFormError('completeActionError');
        completeActionModal.show();
      });
    });

    tbody.querySelectorAll('[data-verify-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.post(`/actions/${btn.dataset.verifyAction}/verify`, {});
          loadChallengesAndActions();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    // Student: Edit own challenge inline
    tbody.querySelectorAll('[data-edit-issue]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const issueId = btn.dataset.editIssue;
        const issue = loadedIssues.find((i) => String(i.id) === String(issueId));
        if (!issue) return;
        openEditIssueModal(issue);
      });
    });

    // Faculty/HOD: Change challenge status
    tbody.querySelectorAll('[data-change-issue-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.put(`/issues/${btn.dataset.changeIssueStatus}`, { status: btn.dataset.newStatus });
          loadChallengesAndActions();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// Backward compatibility stubs
const loadIssues = loadChallengesAndActions;
const loadActions = loadChallengesAndActions;

// ---------- Reviews + status history ----------

async function loadReviews() {
  const tbody = document.getElementById('reviewsBody');
  try {
    const { reviews } = await Api.get(`/projects/${projectId}/reviews`);
    tbody.innerHTML = reviews.length
      ? reviews.map((r) => `
        <tr>
          <td>${formatDate(r.review_date)}</td>
          <td>${esc(r.reviewer_name) || 'Unknown'}</td>
          <td>${esc(r.comments)}</td>
          <td>${esc(r.decision) || '<span class="text-muted">&ndash;</span>'}</td>
          <td>${r.recommended_status ? ragBadge(r.recommended_status) : '<span class="text-muted">&ndash;</span>'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="text-muted">No reviews recorded yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

async function loadHistory() {
  const tbody = document.getElementById('historyBody');
  try {
    const { statusHistory } = await Api.get(`/projects/${projectId}/history`);
    tbody.innerHTML = statusHistory.length
      ? statusHistory.map((h) => `
        <tr>
          <td>${formatDateTime(h.created_at)}</td>
          <td>${h.previous_status ? ragBadge(h.previous_status) : '<span class="text-muted">New</span>'} &rarr; ${ragBadge(h.new_status)}</td>
          <td>${esc(h.reason) || ''}</td>
          <td>${esc(h.changed_by_name) || 'Unknown'}</td>
          <td>${esc(h.approved_by_name) || '<span class="text-muted">&ndash;</span>'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="text-muted">No status changes recorded yet.</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Team (four students) ----------

let currentTeam = [];

async function loadTeam() {
  const tbody = document.getElementById('teamBody');
  const note = document.getElementById('teamNote');
  try {
    const { students } = await Api.get(`/projects/${projectId}/students`);
    currentTeam = students;
    if (students.length < 4) {
      const msg = `This project's team is incomplete (${students.length} of 4 students). ${isMentorUp() ? 'Use Edit Team to enter at least four.' : ''}`;
      tbody.innerHTML = `<tr><td colspan="3" class="text-muted">${esc(msg)}</td></tr>`;
    } else {
      tbody.innerHTML = students.map((s) => `
        <tr>
          <td>${esc(s.slot)}</td>
          <td><strong>${esc(s.name)}</strong></td>
          <td>${esc(s.srn)}</td>
        </tr>`).join('');
    }
    note.textContent = '';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

function openTeamModal() {
  clearFormError('teamError');
  TeamForm.render(document.getElementById('teamFormBody'), currentTeam);
  teamModal.show();
}

async function submitTeam() {
  clearFormError('teamError');
  try {
    await Api.put(`/projects/${projectId}/students`, { students: TeamForm.read(document.getElementById('teamFormBody')) });
    teamModal.hide();
    loadTeam();
  } catch (err) {
    showFormError('teamError', err.message);
  }
}

// ---------- Project details (mentor, coordinator, reviewer, term) ----------

async function openDetailsModal() {
  clearFormError('detailsError');
  document.getElementById('detailsTeamId').value = currentProject.team_id || '';
  document.getElementById('detailsArtefactId').value = currentProject.artefact_id || '';
  document.getElementById('detailsTheme').value = currentProject.theme_name || '';
  document.getElementById('detailsArtefactTitle').value = currentProject.artefact_title || '';
  document.getElementById('detailsMentor').value = currentProject.mentor_name || '';
  document.getElementById('detailsCoordinator').value = currentProject.coordinator_name || '';
  document.getElementById('detailsReviewer').value = currentProject.reviewer_name || '';
  document.getElementById('detailsYear').innerHTML = Academic.yearOptions(currentProject.academic_year);
  document.getElementById('detailsSemester').innerHTML = Academic.semesterOptions(currentProject.semester);
  try {
    const { staff } = await Api.get(`/institutes/${currentProject.institute_id}/staff`);
    Academic.fillNameList('detailsStaffNames', staff.map((s) => s.full_name));
  } catch (e) { /* names can still be typed */ }
  detailsModal.show();
}

async function submitDetails() {
  clearFormError('detailsError');
  try {
    await Api.put(`/projects/${projectId}`, {
      theme_name: document.getElementById('detailsTheme').value,
      artefact_title: document.getElementById('detailsArtefactTitle').value,
      faculty_mentor_name: document.getElementById('detailsMentor').value,
      coordinator_name: document.getElementById('detailsCoordinator').value,
      reviewer_name: document.getElementById('detailsReviewer').value,
      academic_year: document.getElementById('detailsYear').value,
      semester: document.getElementById('detailsSemester').value,
    });
    detailsModal.hide();
    await reloadProject();
  } catch (err) {
    showFormError('detailsError', err.message);
  }
}

// ---------- Links (Documentation tab + Overview) ----------

const LINK_TYPE_LABELS = { GITHUB: 'GitHub', CONFLUENCE: 'Confluence', JIRA: 'Jira', REPORT: 'Report', DEMO: 'Demo', OTHER: 'Other' };

async function loadLinks() {
  const overviewList = document.getElementById('linksList');
  const docBody = document.getElementById('documentationLinksBody');
  try {
    const { links } = await Api.get(`/projects/${projectId}/links`);
    if (!links.length) {
      overviewList.innerHTML = '<span class="text-muted">No linked artefacts yet.</span>';
      docBody.innerHTML = '<tr><td colspan="4" class="text-muted">No links recorded yet.</td></tr>';
      return;
    }
    overviewList.innerHTML = links.map((l) => `
      <div class="mb-1"><span class="text-muted" style="font-size:12px">${esc(LINK_TYPE_LABELS[l.link_type] || l.link_type)}</span><br>
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></div>
    `).join('');
    docBody.innerHTML = links.map((l) => `
      <tr>
        <td>${esc(LINK_TYPE_LABELS[l.link_type] || l.link_type)}</td>
        <td>${esc(l.label)}</td>
        <td><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.url)}</a></td>
        <td>${formatDate(l.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    overviewList.innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    docBody.innerHTML = `<tr><td colspan="4" class="text-danger">${esc(err.message)}</td></tr>`;
  }
}

// ---------- Status update modal (RAG workflow + Red intervention) ----------

function openStatusModal() {
  clearFormError('statusError');
  document.getElementById('statusForm').reset();
  document.getElementById('redIntervention').classList.add('d-none');
  document.getElementById('redToGreen').classList.add('d-none');

  const select = document.getElementById('statusNewStatus');
  const options = ALLOWED_TRANSITIONS[currentProject.rag_status] || [];
  // The last choice updates only the completion percentage.
  select.innerHTML = options.map((s) => `<option value="${s}">${s}</option>`).join('') +
    '<option value="">No status change (update completion only)</option>';
  select.value = options[0] || '';
  document.getElementById('statusCompletion').value = currentProject.completion_pct;
  toggleStatusSections();
  statusModal.show();
}

function toggleStatusSections() {
  const newStatus = document.getElementById('statusNewStatus').value;
  const isRedToGreen = currentProject.rag_status === 'RED' && newStatus === 'GREEN';
  document.getElementById('redIntervention').classList.toggle('d-none', newStatus !== 'RED');
  document.getElementById('redToGreen').classList.toggle('d-none', !isRedToGreen);
  document.getElementById('statusReasonHint').textContent = newStatus ? '(required for a status change)' : '(optional)';
}

async function submitStatus() {
  clearFormError('statusError');
  const newStatus = document.getElementById('statusNewStatus').value;
  const reason = document.getElementById('statusReason').value.trim();
  const completion = document.getElementById('statusCompletion').value.trim();
  const pct = Number(completion);
  if (completion === '' || !Number.isInteger(pct) || pct < 0 || pct > 100) {
    showFormError('statusError', 'Completion must be a whole number from 0 to 100.');
    return;
  }
  if (newStatus && !reason) {
    showFormError('statusError', 'A reason is required for a status change.');
    return;
  }
  if (!newStatus && pct === Number(currentProject.completion_pct)) {
    showFormError('statusError', 'Nothing to update: pick a new status or change the completion percentage.');
    return;
  }

  const payload = { newStatus, reason, completionPct: pct };
  if (newStatus === 'RED') {
    payload.blocker = document.getElementById('statusBlocker').value;
    payload.rootCause = document.getElementById('statusRootCause').value;
    payload.impact = document.getElementById('statusImpact').value;
    payload.supportRequired = document.getElementById('statusSupportRequired').value;
    payload.correctiveActionTaken = document.getElementById('statusCorrectiveAction').value;
    payload.actionOwnerName = document.getElementById('statusActionOwner').value.trim();
    payload.dueDate = document.getElementById('statusDueDate').value || null;
    payload.escalationOwnerName = document.getElementById('statusEscalationOwner').value.trim();
    payload.nextReviewAt = document.getElementById('statusNextReview').value || null;
  }
  if (currentProject.rag_status === 'RED' && newStatus === 'GREEN') {
    payload.evidence = document.getElementById('statusEvidence').value;
    payload.reviewerApproval = document.getElementById('statusReviewerApproval').checked;
  }

  try {
    await Api.post(`/projects/${projectId}/status`, payload);
    statusModal.hide();
    await reloadProject();
    loadHistory();
    loadActions();
    loadIssues();
  } catch (err) {
    showFormError('statusError', err.message);
  }
}

// ---------- Simple create modals ----------

function wireSimpleModal({ modal, formId, errorId, submitId, fields, endpoint, onSuccess }) {
  document.getElementById(submitId).addEventListener('click', async () => {
    clearFormError(errorId);
    const payload = {};
    let missingRequired = false;
    fields.forEach(({ id, key, required }) => {
      const val = document.getElementById(id).value.trim();
      if (required && !val) missingRequired = true;
      payload[key] = val || null;
    });
    if (missingRequired) {
      showFormError(errorId, 'Please fill in the required fields.');
      return;
    }
    try {
      await Api.post(endpoint(), payload);
      modal.hide();
      document.getElementById(formId).reset();
      onSuccess();
    } catch (err) {
      showFormError(errorId, err.message);
    }
  });
}

// ---------- Init ----------

async function reloadProject() {
  const { project, jiraLink, challengesJiraLink, kpisJiraLink, confluenceLink } = await Api.get(`/projects/${projectId}`);
  currentProject = project;
  currentJiraLink = jiraLink;
  currentChallengesJiraLink = challengesJiraLink;
  currentKpisJiraLink = kpisJiraLink;
  currentConfluenceLink = confluenceLink;
  renderHeader();
  renderDefinitionView();
  renderIntegrationStatus();
  applyRoleVisibility();
}

let currentJiraLink = null;
let currentChallengesJiraLink = null;
let currentKpisJiraLink = null;
let currentConfluenceLink = null;

function renderIntegrationStatus() {
  const el = document.getElementById('integrationStatus');
  const syncBtn = document.getElementById('btnSyncIntegrations');
  const mentorUp = isMentorUp();

  const btnHeaderJiraBoard = document.getElementById('btnHeaderJiraBoard');
  if (btnHeaderJiraBoard) {
    if (currentJiraLink?.url) {
      btnHeaderJiraBoard.href = currentJiraLink.url;
      btnHeaderJiraBoard.classList.remove('d-none');
    } else {
      btnHeaderJiraBoard.classList.add('d-none');
    }
  }

  const btnJiraChallengesBoard = document.getElementById('btnJiraChallengesBoard');
  if (btnJiraChallengesBoard) {
    const chUrl = currentChallengesJiraLink?.url || currentJiraLink?.url;
    if (chUrl) {
      btnJiraChallengesBoard.href = chUrl;
      btnJiraChallengesBoard.classList.remove('d-none');
    } else {
      btnJiraChallengesBoard.classList.add('d-none');
    }
  }

  const btnJiraKpisBoard = document.getElementById('btnJiraKpisBoard');
  if (btnJiraKpisBoard) {
    const kpUrl = currentKpisJiraLink?.url || currentJiraLink?.url;
    if (kpUrl) {
      btnJiraKpisBoard.href = kpUrl;
      btnJiraKpisBoard.classList.remove('d-none');
    } else {
      btnJiraKpisBoard.classList.add('d-none');
    }
  }

  const parts = [];
  const isBoard = currentJiraLink?.link_type === 'JIRA_PROJECT' || currentJiraLink?.url?.includes('/boards');
  const jiraLabel = isBoard
    ? `Jira Tasks Board: <a href="${esc(currentJiraLink.url)}" target="_blank" rel="noopener noreferrer" class="fw-bold">Open Tasks Board (${esc(currentJiraLink.key)}) ↗</a>`
    : `Jira: <a href="${esc(currentJiraLink.url)}" target="_blank" rel="noopener noreferrer">${esc(currentJiraLink.key)}</a>`;

  parts.push(currentJiraLink
    ? `<div class="mb-1">${jiraLabel}</div>`
    : `<div class="mb-1">Jira: <span class="text-muted">Not linked</span>${mentorUp ? ' <button class="btn btn-link btn-sm p-0" id="btnCreateJira">Create Board</button>' : ''}</div>`);

  if (currentChallengesJiraLink?.url) {
    parts.push(`<div class="mb-1">Jira Challenges Board: <a href="${esc(currentChallengesJiraLink.url)}" target="_blank" rel="noopener noreferrer" class="fw-bold">Open Challenges Board ↗</a></div>`);
  }
  if (currentKpisJiraLink?.url) {
    parts.push(`<div class="mb-1">Jira KPIs Board: <a href="${esc(currentKpisJiraLink.url)}" target="_blank" rel="noopener noreferrer" class="fw-bold">Open KPIs Board ↗</a></div>`);
  }

  parts.push(currentConfluenceLink
    ? `<div>Confluence: <a href="${esc(currentConfluenceLink.url)}" target="_blank" rel="noopener noreferrer">View Page</a></div>`
    : `<div>Confluence: <span class="text-muted">Not linked</span>${mentorUp ? ' <button class="btn btn-link btn-sm p-0" id="btnCreateConfluence">Create Page</button>' : ''}</div>`);
  el.innerHTML = parts.join('');

  const docEl = document.getElementById('documentationIntegration');
  if (docEl) {
    const docParts = [];
    docParts.push(currentConfluenceLink
      ? `Confluence page: <a href="${esc(currentConfluenceLink.url)}" target="_blank" rel="noopener noreferrer">Open project documentation</a>`
      : 'Confluence page: not created yet (use the Overview tab to create one).');
    docParts.push(currentJiraLink
      ? `Jira Tasks Board: <a href="${esc(currentJiraLink.url)}" target="_blank" rel="noopener noreferrer">${esc(currentJiraLink.key)} Board ↗</a>`
      : 'Jira issue: not created yet.');
    const chUrl = currentChallengesJiraLink?.url;
    const kpUrl = currentKpisJiraLink?.url;
    if (chUrl && kpUrl && chUrl === kpUrl) {
      docParts.push(`Jira Challenges & KPIs Board: <a href="${esc(chUrl)}" target="_blank" rel="noopener noreferrer">Open Challenges & KPIs Board ↗</a>`);
    } else {
      if (chUrl) {
        docParts.push(`Jira Challenges Board: <a href="${esc(chUrl)}" target="_blank" rel="noopener noreferrer">Open Challenges Board ↗</a>`);
      }
      if (kpUrl) {
        docParts.push(`Jira KPIs Board: <a href="${esc(kpUrl)}" target="_blank" rel="noopener noreferrer">Open KPIs Board ↗</a>`);
      }
    }
    docEl.innerHTML = docParts.join('<br>');
  }

  syncBtn.classList.toggle('d-none', !mentorUp || (!currentJiraLink && !currentConfluenceLink));

  const jiraBtn = document.getElementById('btnCreateJira');
  if (jiraBtn) jiraBtn.addEventListener('click', async () => {
    jiraBtn.disabled = true;
    try {
      await Api.post(`/projects/${projectId}/jira`, {});
      await reloadProject();
    } catch (err) {
      alert(err.message);
      jiraBtn.disabled = false;
    }
  });
  const confluenceBtn = document.getElementById('btnCreateConfluence');
  if (confluenceBtn) confluenceBtn.addEventListener('click', async () => {
    confluenceBtn.disabled = true;
    try {
      await Api.post(`/projects/${projectId}/confluence`, {});
      await reloadProject();
    } catch (err) {
      alert(err.message);
      confluenceBtn.disabled = false;
    }
  });
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  projectId = getProjectId() || localStorage.getItem('al_active_project_id');
  if (!projectId) {
    window.location.href = 'dashboard.html';
    return;
  }
  localStorage.setItem('al_active_project_id', projectId);

  const initialWorkspaceHref = `project-workspace.html?id=${encodeURIComponent(projectId)}`;
  const initBtnPw = document.getElementById('btnProjectWorkspace');
  if (initBtnPw) initBtnPw.href = initialWorkspaceHref;
  const initBtnTw = document.getElementById('btnTeamProjectWorkspace');
  if (initBtnTw) initBtnTw.href = initialWorkspaceHref;

  currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  const userChip = document.getElementById('userChip');
  if (currentUser) {
    userChip.textContent = `${currentUser.fullName} · ${currentUser.roleNames?.[0] || currentUser.roles?.[0] || ''}`;
    if ((currentUser.roles || []).some((r) => ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN'].includes(r))) {
      document.getElementById('navAdmin').classList.remove('d-none');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  statusModal = new bootstrap.Modal(document.getElementById('statusModal'));
  issueModal = new bootstrap.Modal(document.getElementById('issueModal'));
  actionModal = new bootstrap.Modal(document.getElementById('actionModal'));
  reviewModal = new bootstrap.Modal(document.getElementById('reviewModal'));
  milestoneModal = new bootstrap.Modal(document.getElementById('milestoneModal'));
  kpiModal = new bootstrap.Modal(document.getElementById('kpiModal'));
  measurementModal = new bootstrap.Modal(document.getElementById('measurementModal'));
  completeActionModal = new bootstrap.Modal(document.getElementById('completeActionModal'));
  linkModal = new bootstrap.Modal(document.getElementById('linkModal'));
  teamModal = new bootstrap.Modal(document.getElementById('teamModal'));
  detailsModal = new bootstrap.Modal(document.getElementById('detailsModal'));

  applyRoleVisibility();

  try {
    await reloadProject();
  } catch (err) {
    document.getElementById('projectTitle').textContent = 'Failed to load project';
    document.getElementById('projectMeta').innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    return;
  }

  document.querySelectorAll('#projectTabs .nav-link').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('#trackingTabs .nav-link').forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.sub));
  });

  document.getElementById('btnEditDefinition').addEventListener('click', () => {
    renderDefinitionForm();
    document.getElementById('definitionView').classList.add('d-none');
    document.getElementById('definitionForm').classList.remove('d-none');
  });

  document.getElementById('btnUpdateStatus').addEventListener('click', openStatusModal);
  document.getElementById('statusNewStatus').addEventListener('change', toggleStatusSections);
  document.getElementById('statusSubmit').addEventListener('click', submitStatus);

  const btnNavChallenges = document.getElementById('btnNavChallenges');
  if (btnNavChallenges) {
    btnNavChallenges.addEventListener('click', () => {
      switchTab('challenges');
      const el = document.getElementById('tab-challenges');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  }

  const btnNavKpis = document.getElementById('btnNavKpis');
  if (btnNavKpis) {
    btnNavKpis.addEventListener('click', () => {
      switchTab('kpis');
      const el = document.getElementById('tab-kpis');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  }

  function goToWorkspace(e) {
    if (e) e.preventDefault();
    const pid = projectId || getProjectId() || localStorage.getItem('al_active_project_id');
    if (pid) {
      window.location.href = `project-workspace.html?id=${encodeURIComponent(pid)}`;
    } else {
      alert('Could not determine current project ID.');
    }
  }

  const btnProjectWorkspace = document.getElementById('btnProjectWorkspace');
  if (btnProjectWorkspace) btnProjectWorkspace.addEventListener('click', goToWorkspace);
  const btnTeamWorkspace = document.getElementById('btnTeamProjectWorkspace');
  if (btnTeamWorkspace) btnTeamWorkspace.addEventListener('click', goToWorkspace);

  const btnAddChallengeBtn = document.getElementById('btnAddChallengeBtn');
  if (btnAddChallengeBtn) {
    btnAddChallengeBtn.addEventListener('click', () => {
      clearFormError('issueError');
      document.getElementById('issueForm').reset();
      issueModal.show();
    });
  }

  const btnAddActionBtn = document.getElementById('btnAddActionBtn');
  if (btnAddActionBtn) {
    btnAddActionBtn.addEventListener('click', () => {
      openAddActionModal();
    });
  }

  [document.getElementById('btnAddIssue'), document.getElementById('btnAddIssue2')].filter(Boolean).forEach((btn) =>
    btn.addEventListener('click', () => { clearFormError('issueError'); document.getElementById('issueForm').reset(); issueModal.show(); })
  );
  [document.getElementById('btnAddAction'), document.getElementById('btnAddAction2')].filter(Boolean).forEach((btn) =>
    btn.addEventListener('click', () => { openAddActionModal(); })
  );
  [document.getElementById('btnAddReview'), document.getElementById('btnAddReview2')].filter(Boolean).forEach((btn) =>
    btn.addEventListener('click', () => { clearFormError('reviewError'); document.getElementById('reviewForm').reset(); reviewModal.show(); })
  );
  document.getElementById('btnAddMilestone').addEventListener('click', () => {
    clearFormError('milestoneError'); document.getElementById('milestoneForm').reset(); milestoneModal.show();
  });
  document.getElementById('btnAddKpi').addEventListener('click', () => {
    clearFormError('kpiError'); document.getElementById('kpiForm').reset(); kpiModal.show();
  });
  [document.getElementById('btnAddLink'), document.getElementById('btnAddLink2')].filter(Boolean).forEach((btn) =>
    btn.addEventListener('click', () => { clearFormError('linkError'); document.getElementById('linkForm').reset(); linkModal.show(); })
  );
  document.getElementById('btnSyncIntegrations').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Syncing…';
    try {
      await Api.post(`/projects/${projectId}/sync`, {});
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Sync Now';
    }
  });
  document.getElementById('linkSubmit').addEventListener('click', async () => {
    clearFormError('linkError');
    const linkType = document.getElementById('linkType').value;
    const label = document.getElementById('linkLabel').value.trim();
    const url = document.getElementById('linkUrl').value.trim();
    if (!label || !url) {
      showFormError('linkError', 'Label and URL are required.');
      return;
    }
    try {
      await Api.post(`/projects/${projectId}/links`, { linkType, label, url });
      linkModal.hide();
      loadLinks();
    } catch (err) {
      showFormError('linkError', err.message);
    }
  });

  // Issue modal: supports both CREATE (new challenge) and EDIT (student edits own challenge).
  // If the hidden field #issueEditId has a value, it's an edit (PUT /issues/:id).
  // Otherwise it's a new challenge (POST /projects/:id/issues).
  document.getElementById('issueSubmit').addEventListener('click', async () => {
    clearFormError('issueError');
    const editId = document.getElementById('issueEditId')?.value?.trim();
    const title = document.getElementById('issueTitle').value.trim();
    const rootCause = document.getElementById('issueRootCause').value.trim();
    const impact = document.getElementById('issueImpact').value.trim();
    const supportRequired = document.getElementById('issueSupportRequired').value.trim();
    if (!title) { showFormError('issueError', 'Challenge title is required.'); return; }
    try {
      if (editId) {
        // Edit mode: student updating their own challenge
        await Api.put(`/issues/${editId}`, { title, rootCause: rootCause || null, impact: impact || null, supportRequired: supportRequired || null });
      } else {
        // Create mode: new challenge
        await Api.post(`/projects/${projectId}/issues`, { title, rootCause: rootCause || null, impact: impact || null, supportRequired: supportRequired || null });
      }
      issueModal.hide();
      document.getElementById('issueForm').reset();
      const hiddenId = document.getElementById('issueEditId');
      if (hiddenId) hiddenId.value = '';
      // Reset modal title
      const modalTitle = document.querySelector('#issueModal .modal-title');
      if (modalTitle) modalTitle.textContent = 'Log Challenge';
      loadChallengesAndActions();
    } catch (err) {
      showFormError('issueError', err.message);
    }
  });

  // Reset issueEditId when modal is dismissed without submitting
  document.getElementById('issueModal').addEventListener('hidden.bs.modal', () => {
    const hiddenId = document.getElementById('issueEditId');
    if (hiddenId) hiddenId.value = '';
    const modalTitle = document.querySelector('#issueModal .modal-title');
    if (modalTitle) modalTitle.textContent = 'Log Challenge';
  });

  wireSimpleModal({
    modal: actionModal, formId: 'actionForm', errorId: 'actionError', submitId: 'actionSubmit',
    fields: [
      { id: 'actionIssueId', key: 'issueId', required: true },
      { id: 'actionDescription', key: 'description', required: true },
      { id: 'actionOwner', key: 'ownerName' },
      { id: 'actionDueDate', key: 'dueDate' },
      { id: 'actionEvidence', key: 'evidence' },
    ],
    endpoint: () => `/projects/${projectId}/actions`,
    onSuccess: () => { loadChallengesAndActions(); },
  });

  wireSimpleModal({
    modal: reviewModal, formId: 'reviewForm', errorId: 'reviewError', submitId: 'reviewSubmit',
    fields: [
      { id: 'reviewComments', key: 'comments', required: true },
      { id: 'reviewDecision', key: 'decision' },
      { id: 'reviewRecommendedStatus', key: 'recommendedStatus' },
      { id: 'reviewNextDate', key: 'nextReviewAt' },
    ],
    endpoint: () => `/projects/${projectId}/reviews`,
    onSuccess: () => { loadReviews(); reloadProject(); },
  });

  wireSimpleModal({
    modal: milestoneModal, formId: 'milestoneForm', errorId: 'milestoneError', submitId: 'milestoneSubmit',
    fields: [
      { id: 'milestoneTitle', key: 'title', required: true },
      { id: 'milestoneDescription', key: 'description' },
      { id: 'milestoneDueDate', key: 'dueDate' },
    ],
    endpoint: () => `/projects/${projectId}/milestones`,
    onSuccess: () => { loadMilestones(); },
  });

  wireSimpleModal({
    modal: kpiModal, formId: 'kpiForm', errorId: 'kpiError', submitId: 'kpiSubmit',
    fields: [
      { id: 'kpiName', key: 'name', required: true },
      { id: 'kpiTarget', key: 'targetValue' },
      { id: 'kpiUnit', key: 'unit' },
    ],
    endpoint: () => `/projects/${projectId}/kpis`,
    onSuccess: () => { loadKpis(); },
  });

  document.getElementById('measurementSubmit').addEventListener('click', async () => {
    clearFormError('measurementError');
    const kpiId = document.getElementById('measurementKpiId').value;
    const measuredValue = document.getElementById('measurementValue').value.trim();
    const evidence = document.getElementById('measurementEvidence').value.trim();
    if (!measuredValue) {
      showFormError('measurementError', 'Measured value is required.');
      return;
    }
    try {
      await Api.post(`/kpis/${kpiId}/measurements`, { measuredValue, evidence: evidence || null });
      measurementModal.hide();
      loadKpis();
    } catch (err) {
      showFormError('measurementError', err.message);
    }
  });

  document.getElementById('btnEditTeam').addEventListener('click', openTeamModal);
  document.getElementById('teamSubmit').addEventListener('click', submitTeam);
  document.getElementById('btnEditDetails').addEventListener('click', openDetailsModal);
  document.getElementById('detailsSubmit').addEventListener('click', submitDetails);

  document.getElementById('completeActionSubmit').addEventListener('click', async () => {
    clearFormError('completeActionError');
    const actionId = document.getElementById('completeActionId').value;
    const evidence = document.getElementById('completeActionEvidence').value.trim();
    if (!evidence) {
      showFormError('completeActionError', 'Evidence is required to mark a corrective action completed.');
      return;
    }
    try {
      await Api.put(`/actions/${actionId}`, { status: 'COMPLETED', evidence });
      completeActionModal.hide();
      loadActions();
    } catch (err) {
      showFormError('completeActionError', err.message);
    }
  });

  async function refreshAllDashboardData() {
    await Promise.all([
      reloadProject(),
      loadMilestones(),
      loadKpis(),
      loadChallengesAndActions(),
      loadReviews(),
      loadHistory(),
      loadLinks(),
      loadTeam()
    ]);
  }

  window.ApniLeap = window.ApniLeap || {};
  window.ApniLeap.onRefresh = refreshAllDashboardData;

  const btnRefreshDashboard = document.getElementById('btnRefreshDashboard');
  if (btnRefreshDashboard) {
    btnRefreshDashboard.addEventListener('click', (e) => {
      e.preventDefault();
      window.ApniLeap.triggerRefresh();
    });
  }

  await refreshAllDashboardData();
}

document.addEventListener('DOMContentLoaded', init);

