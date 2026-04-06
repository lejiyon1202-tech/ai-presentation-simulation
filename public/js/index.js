/* index.js — 인트로 페이지: 시나리오 선택 + 학습자 등록 */
(function () {
  'use strict';

  var state = { selectedScenario: null, selectedSetId: 'default', scenarios: [] };

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function showToast(msg, type) {
    var c = document.getElementById('toastContainer');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'info');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  async function loadScenarios() {
    try {
      var resp = await fetch('/api/scenarios');
      var data = await resp.json();
      var grid = document.getElementById('scenarioGrid');
      if (!grid) return;
      grid.innerHTML = '';

      for (var setId in data) {
        var set = data[setId];
        var scenarios = set.scenarios || [];
        state.scenarios = scenarios;
        state.selectedSetId = setId;

        scenarios.forEach(function (s) {
          var card = document.createElement('div');
          card.className = 'scenario-card';
          card.setAttribute('role', 'option');
          card.setAttribute('tabindex', '0');
          card.setAttribute('aria-selected', 'false');
          card.setAttribute('data-scenario', s.id);

          var stars = '';
          for (var i = 0; i < (s.difficulty && s.difficulty.stars || 3); i++) stars += '\u2605';

          card.innerHTML =
            '<div class="scenario-card-header">' +
              '<h3 class="scenario-card-title">' + escapeHtml(s.title) + '</h3>' +
              '<span class="scenario-card-badge" style="background:' + (s.difficulty && s.difficulty.color || '#f59e0b') + '">' +
                escapeHtml(s.difficulty && s.difficulty.label || '') +
              '</span>' +
            '</div>' +
            '<p class="scenario-card-desc">' + escapeHtml((s.background && s.background.situation || '').substring(0, 120)) + '...</p>' +
            '<div class="scenario-card-meta">' +
              '<span>' + stars + '</span>' +
              '<span>' + (s.estimatedMinutes || 60) + '\uBD84</span>' +
              '<span>AI \uCCAD\uC911 ' + (s.audience && s.audience.length || 3) + '\uBA85</span>' +
            '</div>';

          card.addEventListener('click', function () { selectScenario(s, card); });
          card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectScenario(s, card); }
          });
          grid.appendChild(card);
        });
      }
    } catch (e) {
      console.error('[index] loadScenarios:', e);
      showToast('\uC2DC\uB098\uB9AC\uC624 \uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    }
  }

  function selectScenario(scenario, card) {
    document.querySelectorAll('.scenario-card').forEach(function (c) {
      c.classList.remove('selected');
      c.setAttribute('aria-selected', 'false');
    });
    card.classList.add('selected');
    card.setAttribute('aria-selected', 'true');
    state.selectedScenario = scenario;

    var registerSection = document.getElementById('register');
    if (registerSection) {
      registerSection.style.display = '';
      registerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!state.selectedScenario) {
      showToast('\uC2DC\uB098\uB9AC\uC624\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694.', 'warning');
      return;
    }

    var name = (document.getElementById('learnerName') || {}).value || '';
    if (!name.trim()) {
      showToast('\uC774\uB984\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694.', 'warning');
      return;
    }

    var dept = (document.getElementById('learnerDept') || {}).value || '';

    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: state.selectedScenario.id,
        scenarioSetId: state.selectedSetId,
        learnerName: name.trim(),
        learnerId: name.trim().replace(/\s/g, '-') + '-' + Date.now(),
        learnerOrg: dept,
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.id) {
        localStorage.setItem('sessionId', data.id);
        localStorage.setItem('learnerName', name.trim());
        window.location.href = 'prepare.html?session=' + data.id;
      } else {
        showToast(data.error || '\uC138\uC158 \uC0DD\uC131\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
      }
    })
    .catch(function (err) {
      console.error('[index] submit:', err);
      showToast('\uC138\uC158 \uC0DD\uC131\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadScenarios();
    var form = document.getElementById('startForm');
    if (form) form.addEventListener('submit', handleSubmit);
  });
})();
