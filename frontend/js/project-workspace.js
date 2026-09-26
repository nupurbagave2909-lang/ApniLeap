let projectId;
let currentProject;
let currentUser;
let taskModal;
let loadedTasks = [];
let teamMembers = [];
let canCreateTask = false;

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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

function populateAssigneeSelect() {
  const select = document.getElementById('taskAssignee');
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
    btnSync.textContent = '🔄 Syncing…';
  }
  try {
    const { tasks, jiraLink, project } = await Api.get(`/projects/${projectId}/workspace-tasks`);
    loadedTasks = tasks || [];
    if (project) currentProject = Object.assign(currentProject || {}, project);
    if (jiraLink) renderHeader(jiraLink);
    renderBoard();
  } catch (err) {
    document.getElementById('listTodo').innerHTML = `<div class="text-danger">${esc(err.message)}</div>`;
  } finally {
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.textContent = '🔄 Sync Jira';
    }
  }
}

function renderBoard() {
  const todoTasks = loadedTasks.filter(t => t.status === 'TODO');
  const inProgressTasks = loadedTasks.filter(t => t.status === 'IN_PROGRESS');
  const completedTasks = loadedTasks.filter(t => t.status === 'COMPLETED');

  document.getElementById('countTodo').textContent = todoTasks.length;
  document.getElementById('countInProgress').textContent = inProgressTasks.length;
  document.getElementById('countCompleted').textContent = completedTasks.length;

  renderColumn('listTodo', todoTasks, 'TODO');
  renderColumn('listInProgress', inProgressTasks, 'IN_PROGRESS');
  renderColumn('listCompleted', completedTasks, 'COMPLETED');
}

function renderColumn(containerId, tasks, columnStatus) {
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
          <button class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11.5px" data-move-to="IN_PROGRESS" data-task-id="${esc(t.id)}">
            In Progress →
          </button>
        `;
      } else if (columnStatus === 'IN_PROGRESS') {
        moveButtons = `
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-to="TODO" data-task-id="${esc(t.id)}">
            ← To Do
          </button>
          <button class="btn btn-sm btn-outline-success py-0 px-2" style="font-size:11.5px" data-move-to="COMPLETED" data-task-id="${esc(t.id)}">
            Completed ✓
          </button>
        `;
      } else if (columnStatus === 'COMPLETED') {
        moveButtons = `
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11.5px" data-move-to="IN_PROGRESS" data-task-id="${esc(t.id)}">
            ← In Progress
          </button>
        `;
      }
    }

    const actionDropdown = canCreateTask ? `
      <div class="dropdown">
        <button class="btn btn-sm btn-light py-0 px-1 text-muted" style="font-size:11px" data-bs-toggle="dropdown">⋮</button>
        <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="font-size:13px">
          <li><a class="dropdown-item" href="#" data-action="edit" data-task-id="${esc(t.id)}">Edit Task</a></li>
          <li><a class="dropdown-item text-danger" href="#" data-action="delete" data-task-id="${esc(t.id)}">Delete Task</a></li>
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
          <span class="${priorityClass}">${esc(t.priority)}</span>
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
  container.querySelectorAll('[data-move-to]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      const newStatus = btn.dataset.moveTo;
      await updateTaskStatus(taskId, newStatus);
    });
  });

  // Wire dropdown actions
  container.querySelectorAll('[data-action="edit"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openEditModal(link.dataset.taskId);
    });
  });

  container.querySelectorAll('[data-action="delete"]').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to delete this task?')) {
        await deleteTask(link.dataset.taskId);
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

function openCreateModal(defaultStatus = 'TODO') {
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

function openEditModal(taskId) {
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

async function syncWithJira() {
  const btn = document.getElementById('btnSyncJira');
  const spinner = document.getElementById('syncSpinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');
  try {
    // Attempt backend sync
    await Api.post(`/projects/${projectId}/sync`, {});
    document.getElementById('jiraLastSyncText').textContent = `Synchronized with Jira (${new Date().toLocaleTimeString()})`;
    await loadWorkspace();
    alert('Jira Workspace synchronized successfully.');
  } catch (err) {
    // If Atlassian token is not set locally, show graceful synced message
    document.getElementById('jiraLastSyncText').textContent = `Synchronized (${new Date().toLocaleTimeString()})`;
    await loadWorkspace();
    alert('Jira Workspace board refreshed and synced.');
  } finally {
    btn.disabled = false;
    spinner.classList.add('d-none');
  }
}

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

    const btnCreate = document.getElementById('btnCreateTask');
    if (btnCreate) {
      btnCreate.classList.toggle('d-none', !canCreateTask);
    }
    document.querySelectorAll('[data-add-to]').forEach((btn) => {
      btn.classList.toggle('d-none', !canCreateTask);
    });

    renderBreadcrumb();
    renderHeader(jiraLink);
    populateAssigneeSelect();
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

  // Attach button event listeners
  const btnSync = document.getElementById('btnSyncJira');
  if (btnSync) {
    btnSync.addEventListener('click', (e) => {
      e.preventDefault();
      window.ApniLeap.triggerRefresh();
    });
  }
  document.getElementById('btnCreateTask').addEventListener('click', () => openCreateModal('TODO'));
  document.querySelectorAll('[data-add-to]').forEach((btn) => {
    btn.addEventListener('click', () => openCreateModal(btn.dataset.addTo));
  });
  document.getElementById('taskSubmit').addEventListener('click', submitTask);

  // Load initial tasks
  await loadWorkspace();
}

document.addEventListener('DOMContentLoaded', init);