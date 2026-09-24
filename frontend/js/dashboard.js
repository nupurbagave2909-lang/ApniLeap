let allProjects = [];
let currentUser = null;

function updateStats(projects) {
  const total = projects.length;
  const green = projects.filter((p) => (p.rag_status || '').toUpperCase() === 'GREEN').length;
  const yellow = projects.filter((p) => (p.rag_status || '').toUpperCase() === 'YELLOW').length;
  const red = projects.filter((p) => (p.rag_status || '').toUpperCase() === 'RED').length;
  const avg = total ? Math.round(projects.reduce((sum, p) => sum + (Number(p.completion_pct) || 0), 0) / total) : 0;

  const countBadge = document.getElementById('projectCountBadge');
  if (countBadge) countBadge.textContent = `${total} ${total === 1 ? 'Project' : 'Projects'}`;

  const elGreen = document.getElementById('statGreen');
  if (elGreen) elGreen.textContent = green;
  const elYellow = document.getElementById('statYellow');
  if (elYellow) elYellow.textContent = yellow;
  const elRed = document.getElementById('statRed');
  if (elRed) elRed.textContent = red;
  const elAvg = document.getElementById('statAvg');
  if (elAvg) elAvg.textContent = `${avg}%`;
}

function renderProjects(projects, isFacultyOnly, isReadOnly = false) {
  const tbody = document.getElementById('projectsTableBody');
  updateStats(projects);

  const thStatus = document.getElementById('thStatus');
  if (thStatus) thStatus.classList.toggle('d-none', isReadOnly);

  const statusFilterCol = document.getElementById('statusFilterCol');
  if (statusFilterCol) statusFilterCol.classList.toggle('d-none', isReadOnly);

  if (!projects.length) {
    let colSpan = 7;
    if (isFacultyOnly) colSpan--;
    if (isReadOnly) colSpan--;
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-muted text-center py-4">No projects found matching the criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = projects.map((p) => {
    const rag = (p.rag_status || 'GREEN').toUpperCase();
    const ragClass = rag === 'RED' ? 'rag-red' : (rag === 'YELLOW' ? 'rag-yellow' : 'rag-green');
    const barClass = rag === 'RED' ? 'bg-danger' : (rag === 'YELLOW' ? 'bg-warning' : 'bg-success');
    const compPct = Number(p.completion_pct) || 0;
    const reviewDate = p.next_review_at ? new Date(p.next_review_at).toLocaleDateString() : '—';

    const mentorCol = isFacultyOnly ? '' : `
      <td>
        <span class="fw-medium">${esc(p.mentor_name || 'Unassigned')}</span>
      </td>
    `;

    const statusCol = isReadOnly ? '' : `
      <td>
        <span class="d-inline-flex align-items-center">
          <span class="al-rag-dot ${ragClass} me-1"></span>
          <span class="fw-semibold" style="font-size: 12px;">${rag}</span>
        </span>
      </td>
    `;

    return `
      <tr>
        <td>
          <a href="project-dashboard.html?id=${esc(p.id)}" class="fw-bold text-decoration-none">${esc(p.title)}</a>
          <div class="text-muted mt-1" style="font-size: 12px;">
            <span class="badge bg-light text-dark border me-1">${esc(p.project_code)}</span>
            ${p.team_id ? `<span class="me-1">Team: ${esc(p.team_id)}</span>` : ''}
            ${p.artefact_title ? `· <span title="Artefact">${esc(p.artefact_title)}</span>` : (p.artefact_id ? `· <span>${esc(p.artefact_id)}</span>` : '')}
          </div>
        </td>
        <td>
          ${p.department_name ? `<span class="badge bg-secondary-subtle text-secondary-emphasis border me-1 mb-1" style="font-size: 11px;">${esc(p.department_name)}</span><br>` : ''}
          <span style="font-size: 13px;">${esc(p.theme_name || '—')}</span>
        </td>
        ${mentorCol}
        ${statusCol}
        <td>
          <div class="d-flex align-items-center gap-2" style="min-width: 100px;">
            <div class="progress flex-grow-1" style="height: 7px; background-color: #e2e8f0; border-radius: 4px;">
              <div class="progress-bar ${barClass}" role="progressbar" style="width: ${compPct}%;"></div>
            </div>
            <span class="text-muted" style="font-size: 12px;">${compPct}%</span>
          </div>
        </td>
        <td>
          <span style="font-size: 12px;">${reviewDate}</span>
        </td>
        <td class="text-end">
          <div class="d-inline-flex gap-2">
            <a href="project-workspace.html?id=${esc(p.id)}" class="btn btn-sm btn-outline-primary" style="font-size: 12px;">Project Workspace</a>
            <a href="project-dashboard.html?id=${esc(p.id)}" class="btn btn-sm btn-primary" style="font-size: 12px;">Open &rarr;</a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function applyFilters(isFacultyOnly, isReadOnly = false) {
  const term = (document.getElementById('fSearch')?.value || '').toLowerCase().trim();
  const dept = document.getElementById('fDepartment')?.value || '';
  const mentor = document.getElementById('fMentor')?.value || '';
  const theme = document.getElementById('fTheme')?.value || '';
  const status = document.getElementById('fStatus')?.value || '';

  const filtered = allProjects.filter((p) => {
    if (status && (p.rag_status || '').toUpperCase() !== status) return false;
    if (dept && p.department_name !== dept) return false;
    if (mentor && (p.mentor_name || '') !== mentor) return false;
    if (theme && (p.theme_name || '') !== theme) return false;

    if (term) {
      const matchTitle = (p.title || '').toLowerCase().includes(term);
      const matchCode = (p.project_code || '').toLowerCase().includes(term);
      const matchArtefact = (p.artefact_title || p.artefact_id || '').toLowerCase().includes(term);
      const matchTheme = (p.theme_name || '').toLowerCase().includes(term);
      const matchTeam = (p.team_id || '').toLowerCase().includes(term);
      const matchMentor = (p.mentor_name || '').toLowerCase().includes(term);
      const matchDept = (p.department_name || '').toLowerCase().includes(term);
      if (!matchTitle && !matchCode && !matchArtefact && !matchTheme && !matchTeam && !matchMentor && !matchDept) return false;
    }
    return true;
  });

  renderProjects(filtered, isFacultyOnly, isReadOnly);
}

function populateFilterOptions(projects, isFacultyOnly, isDean) {
  // Populate Departments
  const deptCol = document.getElementById('deptFilterCol');
  const deptSelect = document.getElementById('fDepartment');
  if (!isFacultyOnly) {
    deptCol.classList.remove('d-none');
    const deptCounts = {};
    projects.forEach((p) => {
      if (p.department_name) deptCounts[p.department_name] = (deptCounts[p.department_name] || 0) + 1;
    });
    const depts = Object.keys(deptCounts).sort();
    deptSelect.innerHTML = `<option value="">All Departments (${projects.length})</option>` +
      depts.map((d) => `<option value="${esc(d)}">${esc(d)} (${deptCounts[d]})</option>`).join('');
  } else {
    deptCol.classList.add('d-none');
  }

  // Populate Mentors
  const mentorCol = document.getElementById('mentorFilterCol');
  const mentorSelect = document.getElementById('fMentor');
  if (!isFacultyOnly) {
    mentorCol.classList.remove('d-none');
    const mentors = [...new Set(projects.map((p) => p.mentor_name).filter(Boolean))].sort();
    mentorSelect.innerHTML = '<option value="">All Mentors</option>' +
      mentors.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  } else {
    mentorCol.classList.add('d-none');
    const thMentor = document.getElementById('thMentor');
    if (thMentor) thMentor.remove();
  }

  // Populate Themes
  const themeSelect = document.getElementById('fTheme');
  const themes = [...new Set(projects.map((p) => p.theme_name).filter(Boolean))].sort();
  themeSelect.innerHTML = '<option value="">All Themes</option>' +
    themes.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
}

async function loadProjectsDashboard(user, roleInfo) {
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  const navDashboard = document.querySelector('a.nav-link.active');

  if (roleInfo.isFacultyOnly) {
    pageTitle.textContent = 'My Projects';
    pageSubtitle.textContent = `Projects mentored by ${user.fullName || 'you'}`;
    if (navDashboard) navDashboard.textContent = 'My Projects';
  } else if (roleInfo.isDean) {
    pageTitle.textContent = 'Dean Department Portfolio';
    pageSubtitle.textContent = `Overseeing all projects across authorized departments (${user.fullName || ''})`;
    if (navDashboard) navDashboard.textContent = 'Projects';
  } else if (roleInfo.isHead) {
    pageTitle.textContent = 'Department Projects';
    pageSubtitle.textContent = `Department projects portfolio (${user.fullName || ''})`;
    if (navDashboard) navDashboard.textContent = 'Projects';
  } else {
    pageTitle.textContent = 'Mini-Project Portfolio';
    pageSubtitle.textContent = 'All projects under your administrative oversight';
  }

  try {
    const data = await Api.get('/portfolio/projects');
    allProjects = data.projects || [];

    populateFilterOptions(allProjects, roleInfo.isFacultyOnly, roleInfo.isDean);
    renderProjects(allProjects, roleInfo.isFacultyOnly, roleInfo.isReadOnly);

    document.getElementById('fSearch')?.addEventListener('input', () => applyFilters(roleInfo.isFacultyOnly, roleInfo.isReadOnly));
    document.getElementById('fDepartment')?.addEventListener('change', () => applyFilters(roleInfo.isFacultyOnly, roleInfo.isReadOnly));
    document.getElementById('fMentor')?.addEventListener('change', () => applyFilters(roleInfo.isFacultyOnly, roleInfo.isReadOnly));
    document.getElementById('fTheme')?.addEventListener('change', () => applyFilters(roleInfo.isFacultyOnly, roleInfo.isReadOnly));
    document.getElementById('fStatus')?.addEventListener('change', () => applyFilters(roleInfo.isFacultyOnly, roleInfo.isReadOnly));
  } catch (err) {
    document.getElementById('projectsTableBody').innerHTML =
      `<tr><td colspan="7" class="text-danger text-center py-4">Failed to load projects: ${esc(err.message)}</td></tr>`;
  }
}

async function loadDeanDepartments(user, isReadOnly = false) {
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  pageTitle.textContent = isReadOnly ? 'Department Portfolio' : 'Dean Department Portfolio';
  pageSubtitle.textContent = isReadOnly
    ? `Select a department to view themes and mini-projects (${user.fullName || 'KLE Technological University (Hubballi Campus)'})`
    : `Select a department under your oversight to view themes and mini-projects (${user.fullName || 'KLE Technological University (Hubballi Campus)'})`;

  const deptChoiceTitle = document.getElementById('deptChoiceTitle');
  if (deptChoiceTitle) deptChoiceTitle.textContent = 'Select Department';
  const deptChoiceSubtitle = document.getElementById('deptChoiceSubtitle');
  if (deptChoiceSubtitle) {
    deptChoiceSubtitle.textContent = isReadOnly
      ? 'Select a department to explore its project themes and mini-projects.'
      : 'Select a department under your oversight to explore its project themes and mini-projects.';
  }

  const grid = document.getElementById('deanDepartmentGrid');
  grid.innerHTML = '<div class="col-12 text-muted">Loading departments…</div>';
  try {
    const { departments } = await Api.get('/portfolio/departments');
    if (!departments || !departments.length) {
      grid.innerHTML = '<div class="col-12 text-muted">No departments assigned under your oversight.</div>';
      return;
    }
    grid.innerHTML = departments.map((d) => `
      <div class="col-12 col-md-6">
        <a href="department-dashboard.html?id=${esc(d.id)}" class="text-decoration-none text-reset d-block h-100">
          <div class="al-department-block h-100">
            <div>
              <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                <h3 class="al-department-name mb-0">${esc(d.name)}</h3>
                <span class="al-department-code">${esc(d.code)}</span>
              </div>
              <div class="text-muted mb-3" style="font-size: 13px;">
                Head of Department: <strong>${esc(d.head_name || 'Not assigned')}</strong>
              </div>
            </div>
            <div>
              <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
                <div>
                  <span class="fs-4 fw-bold text-dark">${esc(d.project_count)}</span>
                  <span class="text-muted" style="font-size: 12.5px;">${Number(d.project_count) === 1 ? 'Project' : 'Projects'}</span>
                </div>
              </div>
              <div class="mt-3 text-primary fw-medium text-end" style="font-size: 13px;">
                View Themes &rarr;
              </div>
            </div>
          </div>
        </a>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div class="col-12 text-danger">Failed to load departments: ${esc(err.message)}</div>`;
  }
}

async function loadInstituteGrid() {
  try {
    const data = await Api.get('/dashboard/programme');
    const grid = document.getElementById('instituteGrid');
    if (!data.institutes.length) {
      grid.innerHTML = '<div class="col-12 text-muted">No institutes in your authorized scope.</div>';
    } else {
      grid.innerHTML = data.institutes.map((inst) => `
        <div class="col-12 col-md-6 col-lg-4">
          <a href="institute-dashboard.html?id=${esc(inst.id)}" class="text-decoration-none text-reset d-block h-100">
            <div class="al-institute-block h-100">
              <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
                <h3 class="al-institute-name mb-0">${esc(inst.name)}</h3>
                <span class="al-institute-code">${esc(inst.code)}</span>
              </div>
              <div class="al-inst-counts">
                <div class="al-inst-total">
                  <span class="al-inst-num">${esc(inst.total_projects)}</span>
                  <span class="al-inst-cap">Projects</span>
                </div>
              </div>
            </div>
          </a>
        </div>
      `).join('');
    }
  } catch (err) {
    document.getElementById('instituteGrid').innerHTML =
      `<div class="col-12 text-danger">Failed to load institutes: ${esc(err.message)}</div>`;
  }
}

async function loadHodThemes(user) {
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');
  const navDashboard = document.querySelector('a.nav-link.active');
  if (navDashboard) navDashboard.textContent = 'Themes';

  const grid = document.getElementById('hodThemeGrid');
  grid.innerHTML = '<div class="col-12 text-muted">Loading department themes…</div>';
  try {
    const { departments } = await Api.get('/portfolio/departments');
    if (!departments || !departments.length) {
      grid.innerHTML = '<div class="col-12 text-muted">No department assigned under your oversight.</div>';
      return;
    }
    const myDept = departments[0];
    pageTitle.textContent = `${myDept.name} — Themes`;
    pageSubtitle.textContent = `Department themes under your oversight (${user.fullName || 'Head of Department'})`;
    const hodTitleEl = document.getElementById('hodDeptTitle');
    if (hodTitleEl) hodTitleEl.textContent = `${myDept.name} Themes`;
    const hodSubtitleEl = document.getElementById('hodDeptSubtitle');
    if (hodSubtitleEl) hodSubtitleEl.textContent = `Select a theme to explore its mini-projects (${myDept.project_count} total projects).`;

    const { themes } = await Api.get(`/departments/${myDept.id}/themes`);
    if (!themes || !themes.length) {
      grid.innerHTML = '<div class="col-12 text-muted">No themes added for your department yet.</div>';
      return;
    }
    grid.innerHTML = themes.map((t) => `
      <div class="col-12 col-md-6 col-lg-4">
        <a href="theme-dashboard.html?id=${esc(t.id)}" class="text-decoration-none text-reset d-block h-100">
          <div class="al-theme-block h-100">
            <div>
              <h3 class="al-theme-name mb-1">${esc(t.name)}</h3>
              ${t.description ? `<p class="al-theme-desc">${esc(t.description)}</p>` : ''}
            </div>
            <div class="al-inst-counts mt-3">
              <div class="al-inst-total">
                <span class="al-inst-num">${esc(t.project_count)}</span>
                <span class="al-inst-cap">${Number(t.project_count) === 1 ? 'Project' : 'Projects'}</span>
              </div>
            </div>
            <div class="mt-3 text-primary fw-medium text-end" style="font-size: 13px;">
              View Projects &rarr;
            </div>
          </div>
        </a>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div class="col-12 text-danger">Failed to load themes: ${esc(err.message)}</div>`;
  }
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  const userChip = document.getElementById('userChip');
  currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
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

  const roles = currentUser?.roles || [];
  const isFacultyOnly = roles.includes('FACULTY_MENTOR') &&
    !roles.some((r) => ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN', 'DEAN_PRINCIPAL', 'DEPARTMENT_HEAD', 'REVIEWER'].includes(r));
  const isDean = roles.includes('DEAN_PRINCIPAL');
  const isHead = roles.includes('DEPARTMENT_HEAD');
  const isAdmin = roles.some((r) => ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN'].includes(r));
  const isReadOnly = roles.includes('READ_ONLY_STAKEHOLDER');
  const isReviewer = roles.includes('REVIEWER');
  const isDeptDrilldown = isDean || isReadOnly || isReviewer;
  const hideStatus = isReadOnly || isReviewer;

  const roleInfo = { isFacultyOnly, isDean, isHead, isAdmin, isReadOnly, isReviewer, isDeptDrilldown, hideStatus };

  async function loadDashboardContent() {
    if (roleInfo.isDeptDrilldown) {
      await loadDeanDepartments(currentUser, roleInfo.hideStatus);
    } else if (roleInfo.isHead) {
      await loadHodThemes(currentUser);
    } else if (roleInfo.isAdmin) {
      await loadInstituteGrid();
    } else {
      await loadProjectsDashboard(currentUser, roleInfo);
    }
  }

  window.ApniLeap = window.ApniLeap || {};
  window.ApniLeap.onRefresh = loadDashboardContent;

  const btnRefreshPage = document.getElementById('btnRefreshPage');
  if (btnRefreshPage) {
    btnRefreshPage.addEventListener('click', (e) => {
      e.preventDefault();
      window.ApniLeap.triggerRefresh();
    });
  }

  // Dean, Read-only Stakeholders, and Reviewers see Department Choice Boxes directly (Depts -> Themes -> Projects)
  if (roleInfo.isDeptDrilldown) {
    const deanView = document.getElementById('deanView');
    const projectsView = document.getElementById('projectsView');
    deanView.classList.remove('d-none');
    projectsView.classList.add('d-none');
  } else if (roleInfo.isHead) {
    const hodView = document.getElementById('hodView');
    const projectsView = document.getElementById('projectsView');
    hodView.classList.remove('d-none');
    projectsView.classList.add('d-none'); // Department themes come first!
  } else if (roleInfo.isAdmin) {
    const instituteCard = document.getElementById('instituteSummaryCard');
    const projectsView = document.getElementById('projectsView');
    instituteCard.classList.remove('d-none');
    projectsView.classList.add('d-none');

    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');
    pageTitle.textContent = 'Mini-Project Portfolio';
    pageSubtitle.textContent = 'All projects under your administrative oversight';
  }

  await loadDashboardContent();
}

document.addEventListener('DOMContentLoaded', init);
