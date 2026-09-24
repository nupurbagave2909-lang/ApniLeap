function formatDate(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isOverdue(iso) {
  return iso && new Date(iso) < new Date();
}

function getThemeId() {
  return new URLSearchParams(window.location.search).get('id');
}

let themeId;
let themeInfo;
let addProjectModal;
const ADMIN_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN'];

function currentFilters() {
  const params = new URLSearchParams();
  const search = document.getElementById('fSearch').value.trim();
  const status = document.getElementById('fStatus').value;
  const mentor = document.getElementById('fMentor').value;
  const semester = document.getElementById('fSemester').value;
  const phase = document.getElementById('fPhase').value;
  const overdue = document.getElementById('fOverdue').checked;
  const sort = document.getElementById('fSort').value;

  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (mentor) params.set('mentor', mentor);
  if (semester) params.set('semester', semester);
  if (phase) params.set('phase', phase);
  if (overdue) params.set('overdue', 'true');
  if (sort) params.set('sort', sort);
  return params.toString();
}

function updateStatusBar(projects) {
  const total = projects.length;
  const greenCount = projects.filter((p) => p.rag_status === 'GREEN').length;
  const yellowCount = projects.filter((p) => p.rag_status === 'YELLOW').length;
  const redCount = projects.filter((p) => p.rag_status === 'RED').length;
  const avgComp = total ? Math.round(projects.reduce((acc, p) => acc + (Number(p.completion_pct) || 0), 0) / total) : 0;

  const sbTotal = document.getElementById('sbTotalProjects');
  const sbGreen = document.getElementById('sbGreenCount');
  const sbYellow = document.getElementById('sbYellowCount');
  const sbRed = document.getElementById('sbRedCount');
  const sbAvg = document.getElementById('sbAvgCompletion');
  const barGreen = document.getElementById('sbProgressGreen');
  const barYellow = document.getElementById('sbProgressYellow');
  const barRed = document.getElementById('sbProgressRed');

  if (sbTotal) sbTotal.textContent = `${total} ${total === 1 ? 'Project' : 'Projects'}`;
  if (sbGreen) sbGreen.textContent = greenCount;
  if (sbYellow) sbYellow.textContent = yellowCount;
  if (sbRed) sbRed.textContent = redCount;
  if (sbAvg) sbAvg.textContent = `${avgComp}%`;

  const greenPct = total ? (greenCount / total) * 100 : 0;
  const yellowPct = total ? (yellowCount / total) * 100 : 0;
  const redPct = total ? (redCount / total) * 100 : 0;

  if (barGreen) {
    barGreen.style.width = `${greenPct}%`;
    barGreen.textContent = greenPct >= 10 ? `${Math.round(greenPct)}%` : '';
  }
  if (barYellow) {
    barYellow.style.width = `${yellowPct}%`;
    barYellow.textContent = yellowPct >= 10 ? `${Math.round(yellowPct)}%` : '';
  }
  if (barRed) {
    barRed.style.width = `${redPct}%`;
    barRed.textContent = redPct >= 10 ? `${Math.round(redPct)}%` : '';
  }
}

async function loadProjects() {
  const tbody = document.getElementById('projectTableBody');
  tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Loading projects…</td></tr>';

  try {
    const qs = currentFilters();
    const { projects } = await Api.get(`/themes/${themeId}/projects${qs ? `?${qs}` : ''}`);

    if (!projects.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No projects found under this theme.</td></tr>';
      updateStatusBar([]);
      return;
    }

    updateStatusBar(projects);

    tbody.innerHTML = projects.map((p) => `
      <tr>
        <td>
          <a href="project-dashboard.html?id=${esc(p.id)}"><strong>${esc(p.title)}</strong></a><br>
          <span class="text-muted" style="font-size:12.5px">${esc(p.project_code)}${p.team_id ? ` · ${esc(p.team_id)}` : ''}${p.artefact_id ? ` · ${esc(p.artefact_id)}` : ''}</span>
        </td>
        <td>${esc(p.mentor_name) || '<span class="text-muted">Unassigned</span>'}</td>
        <td class="text-end">
          <a href="project-dashboard.html?id=${esc(p.id)}" class="btn btn-sm btn-outline-secondary">Open &rarr;</a>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-danger">Failed to load projects: ${esc(err.message)}</td></tr>`;
  }
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  themeId = getThemeId();
  if (!themeId) {
    window.location.href = 'dashboard.html';
    return;
  }

  const userChip = document.getElementById('userChip');
  const storedUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  const roles = storedUser?.roles || [];
  const isFacultyOnly = roles.includes('FACULTY_MENTOR') &&
    !roles.some((r) => ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'].includes(r));
  if (isFacultyOnly) {
    window.location.replace('dashboard.html');
    return;
  }

  if (storedUser) {
    userChip.textContent = `${storedUser.fullName} · ${storedUser.roleNames?.[0] || storedUser.roles?.[0] || ''}`;
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  try {
    const { theme } = await Api.get(`/themes/${themeId}`);
    themeInfo = theme;
    document.getElementById('themeTitle').textContent = theme.name;
    if (roles.includes('DEAN_PRINCIPAL') || roles.includes('READ_ONLY_STAKEHOLDER') || roles.includes('REVIEWER')) {
      document.getElementById('breadcrumb').innerHTML =
        `<a href="dashboard.html">Departments</a> / <a href="department-dashboard.html?id=${esc(theme.department_id)}">${esc(theme.department_name)}</a> / ` +
        esc(theme.name);
    } else if (roles.includes('DEPARTMENT_HEAD')) {
      document.getElementById('breadcrumb').innerHTML =
        `<a href="dashboard.html">Themes</a> / ${esc(theme.name)}`;
    } else {
      document.getElementById('breadcrumb').innerHTML =
        `<a href="dashboard.html">Dashboard</a> / <a href="institute-dashboard.html?id=${esc(theme.institute_id)}">${esc(theme.institute_name)}</a> / ` +
        `<a href="department-dashboard.html?id=${esc(theme.department_id)}">${esc(theme.department_name)}</a> / ` +
        esc(theme.name);
    }
    document.getElementById('themeMeta').textContent =
      `${theme.department_name} (${theme.department_code}) · ${theme.institute_name}${theme.description ? ` — ${theme.description}` : ''}`;

    const { mentors } = await Api.get(`/themes/${themeId}/mentors`);
    const mentorSelect = document.getElementById('fMentor');
    mentors.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.full_name;
      opt.textContent = m.full_name;
      mentorSelect.appendChild(opt);
    });
  } catch (err) {
    document.getElementById('projectTableBody').innerHTML =
      `<tr><td colspan="3" class="text-danger">Failed to load theme: ${esc(err.message)}</td></tr>`;
    return;
  }

  const hideStatus = roles.includes('READ_ONLY_STAKEHOLDER') || roles.includes('REVIEWER');
  const btnToggleStatus = document.getElementById('btnToggleStatus');
  const statusBarCard = document.getElementById('themeStatusBarCard');
  const themeStatusFilterCol = document.getElementById('themeStatusFilterCol');

  if (hideStatus) {
    if (btnToggleStatus) btnToggleStatus.classList.add('d-none');
    if (statusBarCard) statusBarCard.style.display = 'none';
    if (themeStatusFilterCol) themeStatusFilterCol.classList.add('d-none');
  } else if (btnToggleStatus && statusBarCard) {
    btnToggleStatus.addEventListener('click', () => {
      const isHidden = statusBarCard.style.display === 'none';
      statusBarCard.style.display = isHidden ? 'block' : 'none';
      btnToggleStatus.textContent = isHidden ? 'Hide Status' : 'View Status';
      if (isHidden) {
        btnToggleStatus.classList.remove('btn-outline-primary');
        btnToggleStatus.classList.add('btn-primary');
      } else {
        btnToggleStatus.classList.remove('btn-primary');
        btnToggleStatus.classList.add('btn-outline-primary');
      }
    });
  }

  ['fSearch', 'fStatus', 'fMentor', 'fSemester', 'fPhase', 'fOverdue', 'fSort'].forEach((id) => {
    const el = document.getElementById(id);
    const evt = el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change';
    el.addEventListener(evt, () => loadProjects());
  });

  const currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  if (currentUser && (currentUser.roles || []).some((r) => ADMIN_ROLES.includes(r))) {
    document.getElementById('navAdmin').classList.remove('d-none');
  }
  const mentorUpRoles = ['PLATFORM_ADMIN', 'FACULTY_MENTOR', 'DEPARTMENT_HEAD', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'GLOBAL_PROGRAMME_LEADER'];
  const canCreateProject = currentUser && (currentUser.roles || []).some((r) => mentorUpRoles.includes(r));
  const addProjectBtn = document.getElementById('btnAddProject');
  if (canCreateProject) {
    addProjectBtn.classList.remove('d-none');
    addProjectModal = new bootstrap.Modal(document.getElementById('addProjectModal'));
    addProjectBtn.addEventListener('click', async () => {
      document.getElementById('addProjectForm').reset();
      document.getElementById('addProjectSubmit').disabled = false;
      document.getElementById('newThemeName').value = themeInfo.name;
      TeamForm.render(document.getElementById('newProjectTeam'), []);
      document.getElementById('newProjectYear').innerHTML = Academic.yearOptions('');
      document.getElementById('newProjectSemester').innerHTML = Academic.semesterOptions('');
      clearAddProjectError();
      showNextIds();
      try {
        const { staff } = await Api.get(`/institutes/${themeInfo.institute_id}/staff`);
        Academic.fillNameList('staffNames', staff.map((s) => s.full_name));
      } catch (e) { /* names can still be typed */ }
      addProjectModal.show();
    });
    document.getElementById('addProjectSubmit').addEventListener('click', submitNewProject);

    // Bulk upload from a CSV file
    ProjectImport.init({ departmentId: themeInfo.department_id, onDone: () => loadProjects() });
    const importBtn = document.getElementById('btnImportProjects');
    importBtn.classList.remove('d-none');
    importBtn.addEventListener('click', () => {
      document.getElementById('importDeptName').textContent = themeInfo.department_name;
      document.getElementById('importThemeName').textContent = themeInfo.name;
      ProjectImport.open(themeInfo.department_name);
    });
    document.getElementById('linkOpenImport').addEventListener('click', () => {
      addProjectModal.hide();
      ProjectImport.open(themeInfo.department_name);
    });
  }

  window.ApniLeap = window.ApniLeap || {};
  window.ApniLeap.onRefresh = loadProjects;

  await loadProjects();
}

async function showNextIds() {
  const teamEl = document.getElementById('newTeamId');
  const artefactEl = document.getElementById('newArtefactId');
  teamEl.value = artefactEl.value = '…';
  try {
    const ids = await Api.get('/projects/next-ids');
    teamEl.value = ids.team_id;
    artefactEl.value = ids.artefact_id;
  } catch (e) {
    teamEl.value = artefactEl.value = 'Automatic';
  }
}

function showAddProjectError(message) {
  const el = document.getElementById('addProjectError');
  el.textContent = message;
  el.style.display = 'block';
}
function clearAddProjectError() {
  const el = document.getElementById('addProjectError');
  el.textContent = '';
  el.style.display = 'none';
}

async function submitNewProject() {
  clearAddProjectError();
  const title = document.getElementById('newProjectTitle').value.trim();
  const artefactTitle = document.getElementById('newArtefactTitle').value.trim();
  const facultyMentorName = document.getElementById('newProjectMentor').value.trim();
  const coordinatorName = document.getElementById('newProjectCoordinator').value.trim();
  const reviewerName = document.getElementById('newProjectReviewer').value.trim();
  const academicYear = document.getElementById('newProjectYear').value || null;
  const semester = document.getElementById('newProjectSemester').value || null;

  if (!artefactTitle) {
    showAddProjectError('Artefact title is required.');
    return;
  }
  if (!title) {
    showAddProjectError('Project title is required.');
    return;
  }

  const submitBtn = document.getElementById('addProjectSubmit');
  submitBtn.disabled = true;
  try {
    const students = TeamForm.read(document.getElementById('newProjectTeam'));
    const { project } = await Api.post('/projects', {
      departmentId: themeInfo.department_id,
      themeId: themeInfo.id,
      themeName: themeInfo.name,
      title,
      artefactTitle,
      facultyMentorName,
      coordinatorName,
      reviewerName,
      academicYear,
      semester,
      students
    });
    addProjectModal.hide();
    window.location.href = `project-dashboard.html?id=${esc(project.id)}`;
  } catch (err) {
    submitBtn.disabled = false;
    showAddProjectError(err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
