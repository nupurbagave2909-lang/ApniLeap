const ADMIN_ROLES = ['PLATFORM_ADMIN', 'GLOBAL_PROGRAMME_LEADER', 'INSTITUTE_ADMIN'];
let reportData = null;
let weeklyMeta = 'Loading…';
const mounted = {};

// Weekly Report / Projects / Issues / Reviews tabs. The three lists are built the
// first time their tab is opened; the address (#projects ...) selects a tab.
function showTab(tab) {
  const student = Student.isStudent();
  if (student && tab === 'weekly') tab = 'projects';
  if (!['weekly', 'projects', 'issues', 'reviews'].includes(tab)) tab = student ? 'projects' : 'weekly';
  document.querySelectorAll('#reportTabs .nav-link').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('d-none', p.id !== `pane-${tab}`));
  document.getElementById('weeklyActions').classList.toggle('d-none', tab !== 'weekly');
  document.getElementById('reportMeta').innerHTML = tab === 'weekly' ? weeklyMeta : esc(PortfolioList.subtitleOf(tab));
  if (tab !== 'weekly' && !mounted[tab]) {
    mounted[tab] = PortfolioList.mount(tab, document.getElementById(`pane-${tab}`));
  }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}

function formatDate(iso) {
  if (!iso) return '<span class="text-muted">&ndash;</span>';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderTable(bodyId, rows, rowFn, emptyMessage) {
  const tbody = document.getElementById(bodyId);
  tbody.innerHTML = rows.length ? rows.map(rowFn).join('') : `<tr><td class="text-muted">${emptyMessage}</td></tr>`;
}

function projectLabel(row) {
  return `<strong>${esc(row.title)}</strong><br><span class="text-muted" style="font-size:12.5px">${esc(row.project_code)} &middot; ${esc(row.institute_name)}</span>`;
}

function render(data) {
  reportData = data;
  weeklyMeta = esc(`Generated ${new Date(data.generatedAt).toLocaleString()}`);
  if (document.querySelector('#reportTabs .nav-link.active').dataset.tab === 'weekly') document.getElementById('reportMeta').innerHTML = weeklyMeta;

  renderTable('instituteSummaryBody', data.instituteSummary, (i) => `
    <tr><td>${esc(i.name)} <span class="text-muted">(${esc(i.code)})</span></td>
        <td class="text-end">${esc(i.total_projects)}</td><td class="text-end">${esc(i.green_count)}</td>
        <td class="text-end">${esc(i.yellow_count)}</td><td class="text-end">${esc(i.red_count)}</td></tr>
  `, 'No institutes in scope.');

  renderTable('newRedBody', data.newRed, (r) => `<tr><td>${projectLabel(r)}</td><td class="text-end text-muted">${formatDate(r.created_at)}</td></tr>`, 'No new Red projects this week.');
  renderTable('longStandingBody', data.longStandingRed, (r) => `<tr><td>${projectLabel(r)}</td><td class="text-end text-muted">Since ${formatDate(r.rag_since)}</td></tr>`, 'No long-standing Red projects.');
  renderTable('recoveringBody', data.recovering, (r) => `<tr><td>${projectLabel(r)}</td><td class="text-end">${ragBadge(r.new_status)}</td></tr>`, 'No recoveries this week.');
  renderTable('overdueActionsBody', data.overdueActions, (a) => `<tr><td><strong>${esc(a.description)}</strong><br><span class="text-muted" style="font-size:12.5px">${esc(a.project_code)} &middot; ${esc(a.institute_name)} &middot; Owner: ${esc(a.owner_name) || 'Unassigned'}</span></td><td class="text-end text-danger">${formatDate(a.due_date)}</td></tr>`, 'No overdue corrective actions.');
  renderTable('staleBody', data.staleProjects, (p) => `<tr><td>${projectLabel(p)}</td><td class="text-end text-muted">${formatDate(p.last_update_at)}</td></tr>`, 'No stale projects.');
  renderTable('upcomingReviewsBody', data.upcomingReviews, (p) => `<tr><td>${projectLabel(p)}</td><td class="text-end text-muted">${formatDate(p.next_review_at)}</td></tr>`, 'No reviews due in the next 14 days.');
  renderTable('upcomingMilestonesBody', data.upcomingMilestones, (m) => `<tr><td><strong>${esc(m.title)}</strong><br><span class="text-muted" style="font-size:12.5px">${esc(m.project_code)} &middot; ${esc(m.institute_name)}</span></td><td class="text-end text-muted">${formatDate(m.due_date)}</td></tr>`, 'No milestones due in the next 14 days.');
  renderTable('decisionsBody', data.recentDecisions, (d) => `<tr><td><strong>${esc(d.decision)}</strong><br><span class="text-muted" style="font-size:12.5px">${esc(d.project_code)} &middot; ${esc(d.institute_name)} &middot; ${esc(d.reviewer_name) || 'Unknown'}</span></td><td class="text-end text-muted">${formatDate(d.review_date)}</td></tr>`, 'No decisions recorded this week.');
}

function toCsvValue(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  if (!reportData) return;
  const lines = [];
  lines.push('ApniLeap Weekly Management Report', `Generated,${reportData.generatedAt}`, '');

  lines.push('Institute-wise RAG Summary');
  lines.push(['Institute', 'Code', 'Total', 'Green', 'Yellow', 'Red'].map(toCsvValue).join(','));
  reportData.instituteSummary.forEach((i) => lines.push([i.name, i.code, i.total_projects, i.green_count, i.yellow_count, i.red_count].map(toCsvValue).join(',')));
  lines.push('');

  const section = (title, rows, cols) => {
    lines.push(title);
    lines.push(cols.map(([, h]) => h).map(toCsvValue).join(','));
    rows.forEach((r) => lines.push(cols.map(([k]) => r[k]).map(toCsvValue).join(',')));
    lines.push('');
  };

  section('New Red Projects', reportData.newRed, [['project_code', 'Project'], ['title', 'Title'], ['institute_name', 'Institute'], ['created_at', 'Changed At']]);
  section('Long-Standing Red Projects', reportData.longStandingRed, [['project_code', 'Project'], ['title', 'Title'], ['institute_name', 'Institute'], ['rag_since', 'Red Since']]);
  section('Recovering Projects', reportData.recovering, [['project_code', 'Project'], ['title', 'Title'], ['institute_name', 'Institute'], ['new_status', 'New Status']]);
  section('Overdue Corrective Actions', reportData.overdueActions, [['project_code', 'Project'], ['description', 'Description'], ['owner_name', 'Owner'], ['due_date', 'Due Date']]);
  section('Stale Projects', reportData.staleProjects, [['project_code', 'Project'], ['title', 'Title'], ['institute_name', 'Institute'], ['last_update_at', 'Last Update']]);
  section('Upcoming Reviews', reportData.upcomingReviews, [['project_code', 'Project'], ['title', 'Title'], ['next_review_at', 'Next Review']]);
  section('Upcoming Milestones', reportData.upcomingMilestones, [['project_code', 'Project'], ['title', 'Milestone'], ['due_date', 'Due Date']]);
  section('Recent Review Decisions', reportData.recentDecisions, [['project_code', 'Project'], ['decision', 'Decision'], ['reviewer_name', 'Reviewer'], ['review_date', 'Review Date']]);

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apnileap-weekly-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function init() {
  if (!Api.token()) {
    window.location.href = '../index.html';
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('al_user') || 'null');
  const userChip = document.getElementById('userChip');
  if (currentUser) {
    userChip.textContent = `${currentUser.fullName} · ${currentUser.roleNames?.[0] || currentUser.roles?.[0] || ''}`;
    if ((currentUser.roles || []).some((r) => ADMIN_ROLES.includes(r))) {
      document.getElementById('navAdmin').classList.remove('d-none');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await Api.post('/auth/logout', {}); } catch (e) { /* ignore */ }
    Api.setToken(null);
    localStorage.removeItem('al_user');
    window.location.href = '../index.html';
  });

  document.getElementById('btnExportCsv').addEventListener('click', exportCsv);
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  document.querySelectorAll('#reportTabs .nav-link').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  // A student has no weekly report: they get the lists (their own team only).
  if (Student.isStudent()) {
    document.querySelector('#reportTabs [data-tab="weekly"]').parentElement.classList.add('d-none');
    showTab(location.hash.slice(1) || 'projects');
    return;
  }
  showTab(location.hash.slice(1) || 'weekly');

  async function reloadReports() {
    try {
      const data = await Api.get('/reports/weekly');
      render(data);
    } catch (err) {
      weeklyMeta = `<span class="text-danger">Failed to load report: ${esc(err.message)}</span>`;
      if (document.querySelector('#reportTabs .nav-link.active').dataset.tab === 'weekly') document.getElementById('reportMeta').innerHTML = weeklyMeta;
    }
  }

  window.ApniLeap = window.ApniLeap || {};
  window.ApniLeap.onRefresh = reloadReports;

  await reloadReports();
}

document.addEventListener('DOMContentLoaded', init);
