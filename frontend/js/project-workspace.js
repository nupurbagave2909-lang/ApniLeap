let projectId;
let currentProject;
let currentUser;
let taskModal;
let challengeModal;
let kpiModal;
let measurementModal;

let loadedTasks = [];
let loadedChallenges = [];
let loadedKpis = [];
let boardLinks = {
  tasks: null,
  challengesKpis: null,
};

let currentBoardType = 'tasks'; // 'tasks' | 'challenges-kpis'
let teamMembers = [];
let canCreateTask = false;
let canManageChallenges = true;
let canManageKpis = false;

function getProjectId() {
  const urlParam = new URLSearchParams(window.location.search).get('id');
  if (urlParam) {
    localStorage.setItem('al_active_project_id', urlParam);
    return urlParam;
  }
  const saved = localStorage.getItem('al_active_project_id');
  if (saved) return saved;
  try {
    const u = JSON.parse(localStorage.getItem('al_user') || '{}');
    if (u.projectIds && u.projectIds.length) return u.projectIds[0];
  } catch (e) {}
  return null;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function showFormError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

function clearFormError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

function renderBreadcrumb() {
  const storedUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  const roles = storedUser?.roles || [];
  const isFacultyOnly = roles.includes('FACULTY_MENTOR') &&
    !roles.some((r) => ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'].includes(r));
  const isDean = roles.includes('DEAN_PRINCIPAL') || roles.includes('READ_ONLY_STAKEHOLDER') || roles.includes('REVIEWER');

  if (Student.isStudent()) {
    document.getElementById('breadcrumb').textContent =
      [currentProject.institute_name, currentProject.department_name, currentProject.title, 'Project Workspace'].filter(Boolean).join(' / ');
  } else if (isFacultyOnly) {
    document.getElementById('breadcrumb').innerHTML =
      `<a href="dashboard.html">My Projects</a> / <a href="project-dashboard.html?id=${esc(projectId)}">${esc(currentProject.title)}</a> / Project Workspace`;
  } else if (isDean) {
    let bc = `<a href="dashboard.html">Departments</a> / ` +
      `<a href="department-dashboard.html?id=${esc(currentProject.department_id)}">${esc(currentProject.department_name)}</a> / `;
    if (currentProject.theme_id && currentProject.theme_name) {
      bc += `<a href="theme-dashboard.html?id=${esc(currentProject.theme_id)}">${esc(currentProject.theme_name)}</a> / `;
    } else if (currentProject.theme_name) {
      bc += `<span>${esc(currentProject.theme_name)}</span> / `;
    }
    bc += `<a href="project-dashboard.html?id=${esc(projectId)}">${esc(currentProject.title)}</a> / Project Workspace`;
    document.getElementById('breadcrumb').innerHTML = bc;
  } else if (roles.includes('DEPARTMENT_HEAD')) {
    let bc = `<a href="dashboard.html">Themes</a> / `;
    if (currentProject.theme_id && currentProject.theme_name) {
      bc += `<a href="theme-dashboard.html?id=${esc(currentProject.theme_id)}">${esc(currentProject.theme_name)}</a> / `;
    } else if (currentProject.theme_name) {
      bc += `<span>${esc(currentProject.theme_name)}</span> / `;
    }
    bc += `<a href="project-dashboard.html?id=${esc(projectId)}">${esc(currentProject.title)}</a> / Project Workspace`;
    document.getElementById('breadcrumb').innerHTML = bc;
  } else {
    let breadcrumbHtml = `<a href="dashboard.html">Dashboard</a> / ` +
      `<a href="institute-dashboard.html?id=${esc(currentProject.institute_id)}">${esc(currentProject.institute_name)}</a> / ` +
      `<a href="department-dashboard.html?id=${esc(currentProject.department_id)}">${esc(currentProject.department_name)}</a> / `;
    if (currentProject.theme_id && currentProject.theme_name) {
      breadcrumbHtml += `<a href="theme-dashboard.html?id=${esc(currentProject.theme_id)}">${esc(currentProject.theme_name)}</a> / `;
    }
    breadcrumbHtml += `<a href="project-dashboard.html?id=${esc(projectId)}">${esc(currentProject.title)}</a> / Project Workspace`;
    document.getElementById('breadcrumb').innerHTML = breadcrumbHtml;
  }
}

function renderHeader(jiraLink) {
  document.getElementById('projectTitle').textContent = `${currentProject.title} — Workspace`;
  const jiraBadge = jiraLink?.url
    ? `<a href="${esc(jiraLink.url)}" target="_blank" rel="noopener noreferrer" class="jira-tag ms-1" style="text-decoration:none;font-weight:600" title="Open Jira Board">🔷 Jira Board (${esc(jiraLink.key)}) ↗</a>`
    : '';
  document.getElementById('projectMeta').innerHTML = `
    <span><strong>${esc(currentProject.project_code)}</strong></span>
    ${jiraBadge}
    <span class="text-muted">Team ID: <strong>${esc(currentProject.team_id || 'Team')}</strong></span>
    <span class="text-muted">Artefact ID: <strong>${esc(currentProject.artefact_id || 'Art')}</strong></span>
    <span class="text-muted">Faculty Mentor: ${esc(currentProject.mentor_name) || 'Unassigned'}</span>
  `;
  document.getElementById('btnBackDashboard').href = `project-dashboard.html?id=${encodeURIComponent(projectId)}`;

  const btnBoard = document.getElementById('btnOpenJiraBoard');
  if (btnBoard) {
    if (jiraLink?.url) {
      btnBoard.href = jiraLink.url;
      btnBoard.classList.remove('d-none');
    } else {
      btnBoard.classList.add('d-none');
    }
  }
}

function updateJiraBoardLinks() {
  const activeBtn = document.getElementById('btnActiveBoardJira');
  const tasksLink = document.getElementById('linkJiraTasksBoard');
  const challengesKpisLink = document.getElementById('linkJiraChallengesKpisBoard');

  if (tasksLink && boardLinks.tasks?.url) {
    tasksLink.href = boardLinks.tasks.url;
  }
  if (challengesKpisLink && boardLinks.challengesKpis?.url) {
    challengesKpisLink.href = boardLinks.challengesKpis.url;
  }

  if (activeBtn) {
    if (currentBoardType === 'tasks') {
      activeBtn.href = boardLinks.tasks?.url || '#';
      activeBtn.innerHTML = '🔷 Open Tasks in Jira ↗';
    } else {
      activeBtn.href = boardLinks.challengesKpis?.url || '#';
      activeBtn.innerHTML = '⚠️🎯 Open Challenges &amp; KPIs in Jira ↗';
    }
    activeBtn.classList.toggle('d-none', !activeBtn.getAttribute('href') || activeBtn.getAttribute('href') === '#');
  }
}

function updateBoardUIState() {
  // Update Tab pills active state
  const tabTasks = document.getElementById('tabTasks');
  const tabChKp = document.getElementById('tabChallengesKpis');
  if (tabTasks) tabTasks.classList.toggle('active', currentBoardType === 'tasks');
  if (tabChKp) tabChKp.classList.toggle('active', currentBoardType === 'challenges-kpis');

  // Update Header Create buttons
  const btnCreateTask = document.getElementById('btnCreateTask');
  const wrapChKp = document.getElementById('wrapChallengesKpisButtons');
  const btnLogCh = document.getElementById('btnLogChallenge');
  const btnAddKp = document.getElementById('btnAddKpi');

  if (currentBoardType === 'tasks') {
    if (btnCreateTask) {
      btnCreateTask.classList.remove('d-none');
      btnCreateTask.classList.toggle('d-none', !canCreateTask);
    }
    if (wrapChKp) wrapChKp.classList.add('d-none');
  } else {
    if (btnCreateTask) btnCreateTask.classList.add('d-none');
    if (wrapChKp) {
      wrapChKp.classList.remove('d-none');
      if (btnLogCh) btnLogCh.classList.toggle('d-none', !canManageChallenges);
      if (btnAddKp) btnAddKp.classList.toggle('d-none', !canManageKpis);
    }
  }

  // Update Column Headers
  const colTodo = document.getElementById('colTitleTodo');
  const colInProgress = document.getElementById('colTitleInProgress');
  const colCompleted = document.getElementById('colTitleCompleted');

  if (currentBoardType === 'tasks') {
    if (colTodo) colTodo.textContent = 'To Do';
    if (colInProgress) colInProgress.textContent = 'In Progress';
    if (colCompleted) colCompleted.textContent = 'Completed';
  } else {
    if (colTodo) colTodo.textContent = 'Open / Defined';
    if (colInProgress) colInProgress.textContent = 'In Progress / Tracking';
    if (colCompleted) colCompleted.textContent = 'Resolved / Target Met';
  }

  updateJiraBoardLinks();
  renderActiveBoard();
}

function populateAssigneeSelect() {
  const select = document.getElementById('taskAssignee');
  if (!select) return;
  select.innerHTML = '<option value="">Unassigned</option>';
  teamMembers.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  });
}

async function loadWorkspace() {
  const btnSync = document.getElementById('btnSyncJira');
  if (btnSync) {
    btnSync.disabled = true;
    btnSync.innerHTML = '<span class="refresh-spinner-icon">🔄</span> Syncing…';
  }
  try {
    const data = await Api.get(`/projects/${projectId}/workspace-tasks`);
    loadedTasks = data.tasks || [];
    loadedChallenges = data.challenges || [];
    loadedKpis = data.kpis || [];

    boardLinks.tasks = data.jiraLink;
    boardLinks.challengesKpis = data.challengesAndKpisJiraLink || data.challengesJiraLink || data.kpisJiraLink;

    if (data.project) currentProject = Object.assign(currentProject || {}, data.project);
    if (data.jiraLink) renderHeader(data.jiraLink);

    // Update count badges
    const badgeTasks = document.getElementById('badgeTasksCount');
    if (badgeTasks) badgeTasks.textContent = loadedTasks.length;
    const badgeChKp = document.getElementById('badgeChallengesKpisCount');
    if (badgeChKp) badgeChKp.textContent = (loadedChallenges.length + loadedKpis.length);

    updateJiraBoardLinks();
    renderActiveBoard();
  } catch (err) {
    document.getElementById('listTodo').innerHTML = `<div class="text-danger p-3">${esc(err.message)}</div>`;
  } finally {
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.innerHTML = '<span class="refresh-spinner-icon">🔄</span> Refresh &amp; Sync';
    }
  }
}

function renderActiveBoard() {
  if (currentBoardType === 'tasks') {
    renderTasksBoard();
  } else {
    renderChallengesAndKpisBoard();
  }
}

// -------------------------------------------------------------
// 1. TASKS BOARD (Regular Tasks Only)
// -------------------------------------------------------------
function renderTasksBoard() {
  const todoTasks = loadedTasks.filter(t => t.status === 'TODO');
  const inProgressTasks = loadedTasks.filter(t => t.status === 'IN_PROGRESS');
  const completedTasks = loadedTasks.filter(t => t.status === 'COMPLETED');

  document.getElementById('countTodo').textContent = todoTasks.length;
  document.getElementById('countInProgress').textContent = inProgressTasks.length;
  document.getElementById('countCompleted').textContent = completedTasks.length;

  renderTaskColumn('listTodo', todoTasks, 'TODO');
  renderTaskColumn('listInProgress', inProgressTasks, 'IN_PROGRESS');
  renderTaskColumn('listCompleted', completedTasks, 'COMPLETED');
}

function renderTaskColumn(containerId, tasks, columnStatus) {
  const container = document.getElementById(containerId);
  if (!tasks.length) {
    container.innerHTML = `<div class="text-muted text-center py-4" style="font-size:13.5px">No tasks in this column.</div>`;
    return;
  }

  container.innerHTML = tasks.map(t => {
    const priorityClass = t.priority === 'HIGH' ? 'priority-high' : t.priority === 'LOW' ? 'priority-low' : 'priority-medium';

    let moveButtons = '';
    if (canCreateTask) {
      if (columnStatus === 'TODO') {
        moveButtons = `
          <button class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11.5px" data-move-task="IN_PROGRESS" data-id="${esc(t.id)}">
            In Progress →
          </button>
        `;
      } else if (columnStatus === 'IN_PROGRESS') {
        moveButtons = `
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-task="TODO" data-id="${esc(t.id)}">
            ← To Do
          </button>
          <button class="btn btn-sm btn-outline-success py-0 px-2" style="font-size:11.5px" data-move-task="COMPLETED" data-id="${esc(t.id)}">
            Completed ✓
          </button>
        `;
      } else if (columnStatus === 'COMPLETED') {
        moveButtons = `
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-task="IN_PROGRESS" data-id="${esc(t.id)}">
            ← In Progress
          </button>
        `;
      }
    }

    const actionDropdown = canCreateTask ? `
      <div class="dropdown">
        <button class="btn btn-sm btn-light py-0 px-1 text-muted" style="font-size:11px" data-bs-toggle="dropdown">⋮</button>
        <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="font-size:13px">
          <li><a class="dropdown-item" href="#" data-action="edit-task" data-id="${esc(t.id)}">Edit Task</a></li>
          <li><a class="dropdown-item text-danger" href="#" data-action="delete-task" data-id="${esc(t.id)}">Delete Task</a></li>
        </ul>
      </div>
    ` : '';

    const jiraUrl = t.jira_issue_key && !t.jira_issue_key.startsWith('PROJ')
      ? `https://apnileap-portfolio.atlassian.net/browse/${encodeURIComponent(t.jira_issue_key)}`
      : null;
    const jiraTag = jiraUrl
      ? `<a href="${jiraUrl}" target="_blank" rel="noopener noreferrer" class="jira-tag" style="text-decoration:none" title="Open in Jira">🔷 ${esc(t.jira_issue_key)} ↗</a>`
      : `<span class="jira-tag">🔷 ${esc(t.jira_issue_key || 'Task')}</span>`;

    return `
      <div class="kanban-card" data-card-id="${esc(t.id)}">
        <div class="d-flex justify-content-between align-items-center mb-1">
          ${jiraTag}
          <span class="${priorityClass}">${esc(t.priority || 'MEDIUM')}</span>
        </div>
        <div class="fw-semibold mb-1" style="font-size:14px">${esc(t.title)}</div>
        ${t.description ? `<div class="text-muted mb-2" style="font-size:12.5px">${esc(t.description)}</div>` : ''}
        <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
          <div class="assignee-chip">
            <span style="font-size:13px">👤</span>
            <span>${esc(t.assignee_name || 'Unassigned')}</span>
          </div>
          <div class="d-flex gap-1 align-items-center">
            ${moveButtons}
            ${actionDropdown}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Wire move buttons
  container.querySelectorAll('[data-move-task]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await updateTaskStatus(btn.dataset.id, btn.dataset.moveTask);
    });
  });

  // Wire dropdown actions
  container.querySelectorAll('[data-action="edit-task"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openEditTaskModal(link.dataset.id);
    });
  });

  container.querySelectorAll('[data-action="delete-task"]').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to delete this task?')) {
        await deleteTask(link.dataset.id);
      }
    });
  });
}

async function updateTaskStatus(taskId, newStatus) {
  try {
    await Api.put(`/projects/${projectId}/workspace-tasks/${taskId}`, { status: newStatus });
    await loadWorkspace();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteTask(taskId) {
  try {
    await Api.del(`/projects/${projectId}/workspace-tasks/${taskId}`);
    await loadWorkspace();
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// 2. COMBINED CHALLENGES & KPIS BOARD (One Board for Both)
// -------------------------------------------------------------
function renderChallengesAndKpisBoard() {
  const todoItems = [
    ...loadedChallenges.filter(c => c.status === 'TODO'),
    ...loadedKpis.filter(k => k.status === 'TODO')
  ];
  const inProgressItems = [
    ...loadedChallenges.filter(c => c.status === 'IN_PROGRESS'),
    ...loadedKpis.filter(k => k.status === 'IN_PROGRESS')
  ];
  const completedItems = [
    ...loadedChallenges.filter(c => c.status === 'COMPLETED'),
    ...loadedKpis.filter(k => k.status === 'COMPLETED')
  ];

  document.getElementById('countTodo').textContent = todoItems.length;
  document.getElementById('countInProgress').textContent = inProgressItems.length;
  document.getElementById('countCompleted').textContent = completedItems.length;

  renderCombinedColumn('listTodo', todoItems, 'TODO');
  renderCombinedColumn('listInProgress', inProgressItems, 'IN_PROGRESS');
  renderCombinedColumn('listCompleted', completedItems, 'COMPLETED');
}

function renderCombinedColumn(containerId, items, columnStatus) {
  const container = document.getElementById(containerId);
  if (!items.length) {
    container.innerHTML = `<div class="text-muted text-center py-4" style="font-size:13.5px">No challenges or KPIs in this column.</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    if (item.itemType === 'CHALLENGE') {
      return renderChallengeCard(item, columnStatus);
    } else {
      return renderKpiCard(item, columnStatus);
    }
  }).join('');

  // Wire challenge move buttons
  container.querySelectorAll('[data-move-ch]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await updateChallengeStatus(btn.dataset.id, btn.dataset.moveCh);
    });
  });

  // Wire KPI move buttons
  container.querySelectorAll('[data-move-kp]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await updateKpiStatus(btn.dataset.id, btn.dataset.moveKp);
    });
  });

  // Wire Record measurement button
  container.querySelectorAll('[data-record-kpi]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMeasurementModal(btn.dataset.recordKpi);
    });
  });
}

function renderChallengeCard(c, columnStatus) {
  let moveButtons = '';
  if (canManageChallenges) {
    if (columnStatus === 'TODO') {
      moveButtons = `
        <button class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11.5px" data-move-ch="IN_PROGRESS" data-id="${esc(c.id)}">
          In Progress →
        </button>
      `;
    } else if (columnStatus === 'IN_PROGRESS') {
      moveButtons = `
        <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-ch="TODO" data-id="${esc(c.id)}">
          ← Open
        </button>
        <button class="btn btn-sm btn-outline-success py-0 px-2" style="font-size:11.5px" data-move-ch="COMPLETED" data-id="${esc(c.id)}">
          Resolved ✓
        </button>
      `;
    } else if (columnStatus === 'COMPLETED') {
      moveButtons = `
        <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-ch="IN_PROGRESS" data-id="${esc(c.id)}">
          ← In Progress
        </button>
      `;
    }
  }

  const jiraUrl = c.jira_issue_key
    ? `https://apnileap-portfolio.atlassian.net/browse/${encodeURIComponent(c.jira_issue_key)}`
    : null;
  const jiraTag = jiraUrl
    ? `<a href="${jiraUrl}" target="_blank" rel="noopener noreferrer" class="jira-tag" style="text-decoration:none" title="Open Challenge in Jira">🔷 ${esc(c.jira_issue_key)} ↗</a>`
    : `<span class="jira-tag">⚠️ Challenge</span>`;

  return `
    <div class="kanban-card" data-card-id="${esc(c.id)}" style="border-left: 4px solid #ae2a19;">
      <div class="d-flex justify-content-between align-items-center mb-1">
        ${jiraTag}
        <span class="priority-high">⚠️ CHALLENGE</span>
      </div>
      <div class="fw-semibold mb-1" style="font-size:14px; color:#212529">${esc(c.title)}</div>
      ${c.root_cause ? `<div class="text-muted mb-1" style="font-size:12px"><strong>Cause:</strong> ${esc(c.root_cause)}</div>` : ''}
      ${c.impact ? `<div class="text-muted mb-1" style="font-size:12px"><strong>Impact:</strong> ${esc(c.impact)}</div>` : ''}
      ${c.support_required ? `<div class="text-primary mb-2" style="font-size:12px"><strong>Support:</strong> ${esc(c.support_required)}</div>` : ''}
      <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
        <div class="assignee-chip">
          <span style="font-size:13px">👤</span>
          <span>${esc(c.assignee_name || 'Student')}</span>
        </div>
        <div class="d-flex gap-1 align-items-center">
          ${moveButtons}
        </div>
      </div>
    </div>
  `;
}

function renderKpiCard(k, columnStatus) {
  let moveButtons = '';
  if (canCreateTask) {
    if (columnStatus === 'TODO') {
      moveButtons = `
        <button class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11.5px" data-move-kp="IN_PROGRESS" data-id="${esc(k.id)}">
          In Progress →
        </button>
      `;
    } else if (columnStatus === 'IN_PROGRESS') {
      moveButtons = `
        <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-kp="TODO" data-id="${esc(k.id)}">
          ← Defined
        </button>
        <button class="btn btn-sm btn-outline-success py-0 px-2" style="font-size:11.5px" data-move-kp="COMPLETED" data-id="${esc(k.id)}">
          Target Met ✓
        </button>
      `;
    } else if (columnStatus === 'COMPLETED') {
      moveButtons = `
        <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-kp="IN_PROGRESS" data-id="${esc(k.id)}">
          ← In Progress
        </button>
      `;
    }
  }

  const jiraUrl = k.jira_issue_key
    ? `https://apnileap-portfolio.atlassian.net/browse/${encodeURIComponent(k.jira_issue_key)}`
    : null;
  const jiraTag = jiraUrl
    ? `<a href="${jiraUrl}" target="_blank" rel="noopener noreferrer" class="jira-tag" style="text-decoration:none" title="Open KPI in Jira">🔷 ${esc(k.jira_issue_key)} ↗</a>`
    : `<span class="jira-tag">🎯 KPI</span>`;

  const meas = k.latest_measurement;
  const measurementBadge = meas
    ? `<div class="p-2 mb-2 rounded bg-light border" style="font-size:12px">
         <div class="fw-semibold text-success">Latest: ${esc(meas.measured_value)} ${esc(k.unit || '')}</div>
         ${meas.evidence ? `<div class="text-muted" style="font-size:11px">Log: ${esc(meas.evidence)}</div>` : ''}
       </div>`
    : `<div class="text-muted mb-2" style="font-size:12px">No measurement recorded yet.</div>`;

  return `
    <div class="kanban-card" data-card-id="${esc(k.id)}" style="border-left: 4px solid #198754;">
      <div class="d-flex justify-content-between align-items-center mb-1">
        ${jiraTag}
        <span class="priority-low">🎯 TARGET: ${esc(k.target_value || '-')} ${esc(k.unit || '')}</span>
      </div>
      <div class="fw-semibold mb-1" style="font-size:14px; color:#212529">${esc(k.title)}</div>
      ${measurementBadge}
      <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
        <button class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11.5px" data-record-kpi="${esc(k.id)}">
          + Record Value
        </button>
        <div class="d-flex gap-1 align-items-center">
          ${moveButtons}
        </div>
      </div>
    </div>
  `;
}

async function updateChallengeStatus(challengeId, newStatus) {
  try {
    await Api.put(`/projects/${projectId}/workspace-challenges/${challengeId}`, { status: newStatus });
    await loadWorkspace();
  } catch (err) {
    alert(err.message);
  }
}

async function updateKpiStatus(kpiId, newStatus) {
  try {
    await Api.put(`/projects/${projectId}/workspace-kpis/${kpiId}`, { status: newStatus });
    await loadWorkspace();
  } catch (err) {
    alert(err.message);
  }
}

// -------------------------------------------------------------
// MODALS LOGIC
// -------------------------------------------------------------
function openCreateModal(columnStatus = 'TODO') {
  if (currentBoardType === 'tasks') {
    openCreateTaskModal(columnStatus);
  } else {
    // On Challenges & KPIs board, default to challenge modal
    openCreateChallengeModal();
  }
}

function openCreateTaskModal(defaultStatus = 'TODO') {
  if (!canCreateTask) return;
  clearFormError('taskError');
  document.getElementById('taskForm').reset();
  document.getElementById('taskId').value = '';
  document.getElementById('taskModalTitle').textContent = 'Create Task';
  document.getElementById('taskStatus').value = defaultStatus;
  document.getElementById('taskPriority').value = 'MEDIUM';
  document.getElementById('taskJiraKey').value = `${currentProject.project_code}-${Math.floor(100 + Math.random() * 900)}`;
  taskModal.show();
}

function openEditTaskModal(taskId) {
  if (!canCreateTask) return;
  const task = loadedTasks.find(t => t.id === taskId);
  if (!task) return;
  clearFormError('taskError');
  document.getElementById('taskForm').reset();
  document.getElementById('taskId').value = task.id;
  document.getElementById('taskModalTitle').textContent = 'Edit Task';
  document.getElementById('taskTitle').value = task.title || '';
  document.getElementById('taskDescription').value = task.description || '';
  document.getElementById('taskStatus').value = task.status || 'TODO';
  document.getElementById('taskPriority').value = task.priority || 'MEDIUM';
  document.getElementById('taskAssignee').value = task.assignee_name || '';
  document.getElementById('taskJiraKey').value = task.jira_issue_key || '';
  taskModal.show();
}

async function submitTask() {
  clearFormError('taskError');
  const taskId = document.getElementById('taskId').value;
  const title = document.getElementById('taskTitle').value.trim();
  const description = document.getElementById('taskDescription').value.trim();
  const status = document.getElementById('taskStatus').value;
  const priority = document.getElementById('taskPriority').value;
  const assigneeName = document.getElementById('taskAssignee').value;
  const jiraIssueKey = document.getElementById('taskJiraKey').value.trim();

  if (!title) {
    showFormError('taskError', 'Task summary/title is required.');
    return;
  }

  const payload = { title, description, status, priority, assigneeName, jiraIssueKey };

  try {
    if (taskId) {
      await Api.put(`/projects/${projectId}/workspace-tasks/${taskId}`, payload);
    } else {
      await Api.post(`/projects/${projectId}/workspace-tasks`, payload);
    }
    taskModal.hide();
    await loadWorkspace();
  } catch (err) {
    showFormError('taskError', err.message);
  }
}

function openCreateChallengeModal() {
  clearFormError('challengeError');
  document.getElementById('challengeForm').reset();
  document.getElementById('challengeId').value = '';
  document.getElementById('challengeStatus').value = 'OPEN';
  challengeModal.show();
}

async function submitChallenge() {
  clearFormError('challengeError');
  const title = document.getElementById('challengeTitle').value.trim();
  const rootCause = document.getElementById('challengeRootCause').value.trim();
  const impact = document.getElementById('challengeImpact').value.trim();
  const supportRequired = document.getElementById('challengeSupport').value.trim();
  const status = document.getElementById('challengeStatus').value;

  if (!title) {
    showFormError('challengeError', 'Challenge title is required.');
    return;
  }

  try {
    await Api.post(`/projects/${projectId}/issues`, {
      title,
      rootCause,
      impact,
      supportRequired,
      status,
    });
    challengeModal.hide();
    await loadWorkspace();
  } catch (err) {
    showFormError('challengeError', err.message);
  }
}

function openCreateKpiModal() {
  clearFormError('kpiError');
  document.getElementById('kpiForm').reset();
  kpiModal.show();
}

async function submitKpi() {
  clearFormError('kpiError');
  const name = document.getElementById('kpiName').value.trim();
  const targetValue = document.getElementById('kpiTarget').value.trim();
  const unit = document.getElementById('kpiUnit').value.trim();

  if (!name) {
    showFormError('kpiError', 'KPI name is required.');
    return;
  }

  try {
    await Api.post(`/projects/${projectId}/kpis`, {
      name,
      targetValue,
      unit,
    });
    kpiModal.hide();
    await loadWorkspace();
  } catch (err) {
    showFormError('kpiError', err.message);
  }
}

function openMeasurementModal(kpiId) {
  clearFormError('measError');
  document.getElementById('measurementForm').reset();
  document.getElementById('measKpiId').value = kpiId;
  measurementModal.show();
}

async function submitMeasurement() {
  clearFormError('measError');
  const kpiId = document.getElementById('measKpiId').value;
  const measuredValue = document.getElementById('measValue').value.trim();
  const evidence = document.getElementById('measEvidence').value.trim();

  if (!measuredValue) {
    showFormError('measError', 'Measured value is required.');
    return;
  }

  try {
    await Api.post(`/kpis/${kpiId}/measurements`, {
      measuredValue,
      evidence,
    });
    measurementModal.hide();
    await loadWorkspace();
  } catch (err) {
    showFormError('measError', err.message);
  }
}

// -------------------------------------------------------------
// INIT
// -------------------------------------------------------------
async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  projectId = getProjectId();
  if (!projectId) {
    document.getElementById('projectTitle').textContent = 'Project Workspace';
    document.getElementById('projectMeta').innerHTML = '<span class="text-danger">No project selected. Please open a project first.</span>';
    return;
  }
  if (!new URLSearchParams(window.location.search).get('id')) {
    history.replaceState(null, '', `project-workspace.html?id=${encodeURIComponent(projectId)}`);
  }

  currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  if (currentUser) {
    const rolesStr = (currentUser.roleNames || currentUser.roles || []).join(', ');
    document.getElementById('userChip').textContent = `${currentUser.fullName || 'User'}${rolesStr ? ` (${rolesStr})` : ''}`;
    if ((currentUser.roles || []).some((r) => ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN'].includes(r))) {
      const navAdmin = document.getElementById('navAdmin');
      if (navAdmin) navAdmin.classList.remove('d-none');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  taskModal = new bootstrap.Modal(document.getElementById('taskModal'));
  challengeModal = new bootstrap.Modal(document.getElementById('challengeModal'));
  kpiModal = new bootstrap.Modal(document.getElementById('kpiModal'));
  measurementModal = new bootstrap.Modal(document.getElementById('measurementModal'));

  // Wire Tab buttons (Tasks Board vs Combined Challenges & KPIs Board)
  document.getElementById('tabTasks').addEventListener('click', () => {
    currentBoardType = 'tasks';
    updateBoardUIState();
  });
  document.getElementById('tabChallengesKpis').addEventListener('click', () => {
    currentBoardType = 'challenges-kpis';
    updateBoardUIState();
  });

  // Fetch project details
  try {
    const [{ project, jiraLink }, { students }] = await Promise.all([
      Api.get(`/projects/${projectId}`),
      Api.get(`/projects/${projectId}/students`),
    ]);
    currentProject = project;
    teamMembers = (students || []).map(s => s.name).filter(Boolean);
    if (project.mentor_name && !teamMembers.includes(project.mentor_name)) {
      teamMembers.push(project.mentor_name);
    }

    const roles = currentUser?.roles || [];
    const isGov = roles.some((r) =>
      ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'].includes(r)
    );
    const isGuide = roles.includes('FACULTY_MENTOR') && (
      (project.mentor_user_id && project.mentor_user_id === currentUser.id) ||
      (currentUser.fullName && project.mentor_name &&
       project.mentor_name.trim().toLowerCase() === currentUser.fullName.trim().toLowerCase()) ||
      (currentUser.fullName && project.faculty_mentor_name &&
       project.faculty_mentor_name.trim().toLowerCase() === currentUser.fullName.trim().toLowerCase()) ||
      (currentUser.projectIds || []).includes(project.id)
    );
    const isStudent = roles.includes('STUDENT') && (
      (currentUser.projectIds || []).includes(project.id) ||
      (currentUser.srn && (students || []).some(s => s.srn === currentUser.srn))
    );
    canCreateTask = Boolean(isGov || isGuide || isStudent);
    canManageChallenges = !roles.every(r => r === 'READ_ONLY_STAKEHOLDER');
    canManageKpis = Boolean(isGov || isGuide);

    renderBreadcrumb();
    renderHeader(jiraLink);
    populateAssigneeSelect();
    updateBoardUIState();
  } catch (err) {
    document.getElementById('projectTitle').textContent = 'Failed to load project workspace';
    document.getElementById('projectMeta').innerHTML = `<span class="text-danger">${esc(err.message)}</span>`;
    return;
  }

  async function refreshWorkspaceData() {
    try {
      const [{ project, jiraLink }, { students }] = await Promise.all([
        Api.get(`/projects/${projectId}`),
        Api.get(`/projects/${projectId}/students`),
      ]);
      currentProject = project;
      teamMembers = (students || []).map((s) => s.name).filter(Boolean);
      if (project.mentor_name && !teamMembers.includes(project.mentor_name)) {
        teamMembers.push(project.mentor_name);
      }
      renderBreadcrumb();
      renderHeader(jiraLink);
      populateAssigneeSelect();
    } catch (e) {
      console.warn('Workspace header reload warning:', e);
    }
    await loadWorkspace();
  }

  window.ApniLeap = window.ApniLeap || {};
  window.ApniLeap.onRefresh = refreshWorkspaceData;

  // Single Refresh & Sync button listener
  const btnSync = document.getElementById('btnSyncJira');
  if (btnSync) {
    btnSync.addEventListener('click', (e) => {
      e.preventDefault();
      window.ApniLeap.triggerRefresh();
    });
  }

  // Header Add/Create Buttons
  document.getElementById('btnCreateTask').addEventListener('click', () => openCreateTaskModal('TODO'));
  const btnLogCh = document.getElementById('btnLogChallenge');
  if (btnLogCh) btnLogCh.addEventListener('click', openCreateChallengeModal);
  const btnAddKp = document.getElementById('btnAddKpi');
  if (btnAddKp) btnAddKp.addEventListener('click', openCreateKpiModal);

  // Column "+" buttons
  document.querySelectorAll('[data-add-to]').forEach((btn) => {
    btn.addEventListener('click', () => openCreateModal(btn.dataset.addTo));
  });

  // Modal submit listeners
  document.getElementById('taskSubmit').addEventListener('click', submitTask);
  document.getElementById('challengeSubmit').addEventListener('click', submitChallenge);
  document.getElementById('kpiSubmit').addEventListener('click', submitKpi);
  document.getElementById('measSubmit').addEventListener('click', submitMeasurement);

  // Load initial tasks & workspace data
  await loadWorkspace();
}

document.addEventListener('DOMContentLoaded', init);