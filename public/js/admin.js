/* admin.js — 관리자 대시보드 */
(function () {
  'use strict';

  var state = { authenticated: false };

  function showToast(msg, type) {
    var c = document.getElementById('toastContainer');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'info');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  function getAuth() {
    var pw = localStorage.getItem('adminPassword') || '';
    return 'Basic ' + btoa('admin:' + pw);
  }

  async function login() {
    var input = document.getElementById('adminPassword');
    if (!input) return;
    var pw = input.value;
    if (!pw) { showToast('\uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694.', 'warning'); return; }

    try {
      var resp = await fetch('/api/admin/stats', {
        headers: { 'Authorization': 'Basic ' + btoa('admin:' + pw) }
      });
      if (resp.ok) {
        localStorage.setItem('adminPassword', pw);
        state.authenticated = true;
        var overlay = document.getElementById('loginOverlay');
        if (overlay) overlay.style.display = 'none';
        loadDashboard();
      } else {
        showToast('\uBE44\uBC00\uBC88\uD638\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.', 'error');
      }
    } catch (e) {
      showToast('\uC11C\uBC84 \uC5F0\uACB0\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    }
  }

  async function loadDashboard() {
    try {
      var auth = getAuth();
      var [statsResp, sessionsResp] = await Promise.all([
        fetch('/api/admin/stats', { headers: { 'Authorization': auth } }),
        fetch('/api/admin/sessions?limit=20', { headers: { 'Authorization': auth } }),
      ]);

      var stats = await statsResp.json();
      var sessionsData = await sessionsResp.json();

      // 통계 카드
      var totalEl = document.getElementById('statTotal');
      var completedEl = document.getElementById('statCompleted');
      var rateEl = document.getElementById('statRate');
      var scoreEl = document.getElementById('statAvgScore');
      if (totalEl) totalEl.textContent = stats.total || 0;
      if (completedEl) completedEl.textContent = stats.completed || 0;
      if (rateEl) rateEl.textContent = (stats.completionRate || 0) + '%';
      if (scoreEl) scoreEl.textContent = (stats.avgScore || 0).toFixed(1);

      // 세션 테이블
      var tbody = document.getElementById('sessionsTableBody');
      if (tbody) {
        var sessions = sessionsData.sessions || [];
        tbody.innerHTML = sessions.map(function (s) {
          return '<tr>' +
            '<td>' + (s.learner_name || '-') + '</td>' +
            '<td>' + (s.scenario_id || '-') + '</td>' +
            '<td><span class="status-badge status-' + (s.status || '') + '">' + (s.status || '-') + '</span></td>' +
            '<td>' + (s.score !== null && s.score !== undefined ? s.score.toFixed(1) : '-') + '</td>' +
            '<td>' + (s.grade || '-') + '</td>' +
            '<td>' + (s.started_at || '-') + '</td>' +
          '</tr>';
        }).join('');
      }
    } catch (e) {
      console.error('[admin] load:', e);
      showToast('\uB300\uC2DC\uBCF4\uB4DC \uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    }
  }

  async function exportData(format) {
    try {
      var auth = getAuth();
      var resp = await fetch('/api/admin/export?format=' + (format || 'json'), {
        headers: { 'Authorization': auth }
      });
      if (format === 'csv') {
        var blob = await resp.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'export.csv'; a.click();
        URL.revokeObjectURL(url);
      } else {
        var data = await resp.json();
        var blob2 = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url2 = URL.createObjectURL(blob2);
        var a2 = document.createElement('a');
        a2.href = url2; a2.download = 'export.json'; a2.click();
        URL.revokeObjectURL(url2);
      }
      showToast('\uB0B4\uBCF4\uB0B4\uAE30 \uC644\uB8CC', 'success');
    } catch (e) {
      showToast('\uB0B4\uBCF4\uB0B4\uAE30\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var loginBtn = document.getElementById('loginBtn');
    var pwInput = document.getElementById('adminPassword');
    var exportJsonBtn = document.getElementById('exportJson');
    var exportCsvBtn = document.getElementById('exportCsv');

    if (loginBtn) loginBtn.addEventListener('click', login);
    if (pwInput) pwInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') login();
    });
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', function () { exportData('json'); });
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', function () { exportData('csv'); });

    // 자동 로그인 시도
    if (localStorage.getItem('adminPassword')) {
      login();
    }
  });
})();
