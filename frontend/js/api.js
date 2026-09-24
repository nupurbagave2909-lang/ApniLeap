// Minimal fetch wrapper. Backend base is same-origin (Express serves this
// frontend and the /api routes), so no cross-origin token exposure.
// Escapes text before it is placed into innerHTML. Names, titles and student
// details are typed by users and shown to others, so they must never be
// inserted as raw HTML.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A student signs in with the SRN and sees only their own team's project, read-only.
// The server enforces this on every request; this only tidies the screens
// (hides links a student cannot use and sends them to their project).
const Student = (() => {
  function user() {
    try { return JSON.parse(localStorage.getItem('al_user') || 'null'); } catch (e) { return null; }
  }
  function isStudent() {
    const roles = (user() && user().roles) || [];
    return roles.length > 0 && roles.every((r) => r === 'STUDENT');
  }
  function homeUrl() {
    const ids = (user() && user().projectIds) || [];
    return ids.length === 1 ? `/pages/project-dashboard.html?id=${encodeURIComponent(ids[0])}` : '/pages/reports.html#projects';
  }
  // Reports stays open for a student: it holds their (own-team) Projects / Issues / Reviews lists.
  const BLOCKED_PAGES = ['dashboard.html', 'institutes.html', 'institute-dashboard.html', 'department-dashboard.html', 'theme-dashboard.html', 'administration.html'];

  document.addEventListener('DOMContentLoaded', () => {
    if (!isStudent() || !localStorage.getItem('al_token')) return;
    if (BLOCKED_PAGES.includes(location.pathname.split('/').pop())) {
      location.replace(homeUrl());
      return;
    }
    document.querySelectorAll('.al-navbar a.nav-link').forEach((a) => {
      const page = (a.getAttribute('href') || '').split('/').pop();
      if (BLOCKED_PAGES.includes(page)) a.classList.add('d-none');
    });
    const brand = document.querySelector('.al-navbar .al-brand');
    if (brand) brand.setAttribute('href', homeUrl());
  });

  return { isStudent, homeUrl };
})();

const Api = (() => {
  function token() {
    return localStorage.getItem('al_token');
  }

  function setToken(t) {
    if (t) localStorage.setItem('al_token', t);
    else localStorage.removeItem('al_token');
  }

  async function request(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;

    const res = await fetch(`/api${path}`, Object.assign({}, options, { headers }));

    if (res.status === 401) {
      setToken(null);
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
        location.href = '/index.html';
      }
    }

    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await res.json() : null;

    if (!res.ok) {
      const message = (body && body.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return body;
  }

  return {
    get: (path) => request(path, { method: 'GET' }),
    post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
    put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
    patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data) }),
    del: (path) => request(path, { method: 'DELETE' }),
    token,
    setToken,
  };
})();

// Global in-site refresh coordination
window.ApniLeap = window.ApniLeap || {};
window.ApniLeap.onRefresh = null;
window.ApniLeap.triggerRefresh = async function() {
  const icons = document.querySelectorAll('.refresh-spinner-icon, #refreshIcon');
  icons.forEach((el) => el.classList.add('spinning'));
  try {
    if (typeof window.ApniLeap.onRefresh === 'function') {
      await window.ApniLeap.onRefresh();
    } else {
      window.location.reload();
    }
  } catch (err) {
    console.error('Refresh error:', err);
  } finally {
    setTimeout(() => {
      icons.forEach((el) => el.classList.remove('spinning'));
    }, 350);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#globalRefreshBtn, .btn-refresh-trigger').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.ApniLeap.triggerRefresh();
    });
  });
});

