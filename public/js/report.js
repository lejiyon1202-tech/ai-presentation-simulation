/* report.js — 평가 리포트 페이지 */
(function () {
  'use strict';

  function getParam(n) { return new URL(window.location.href).searchParams.get(n); }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    var d = document.createElement('div'); d.textContent = str; return d.innerHTML;
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

  async function loadReport() {
    var sessionId = getParam('session') || localStorage.getItem('sessionId');
    if (!sessionId) {
      showToast('\uC138\uC158\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', 'error');
      return;
    }

    try {
      var resp = await fetch('/api/sessions/' + sessionId + '/report');
      var data = await resp.json();
      renderReport(data);
    } catch (e) {
      console.error('[report] load:', e);
      showToast('\uB9AC\uD3EC\uD2B8\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', 'error');
    }
  }

  function renderReport(data) {
    var session = data.session || {};
    var evaluation = data.evaluation || {};
    var scenario = data.scenario || {};

    // 기본 정보
    var nameEl = document.getElementById('learnerName');
    var scenarioEl = document.getElementById('scenarioTitle');
    var scoreEl = document.getElementById('overallScore');
    var gradeEl = document.getElementById('gradeText');

    if (nameEl) nameEl.textContent = session.learner_name || '-';
    if (scenarioEl) scenarioEl.textContent = scenario.title || session.scenario_id || '-';
    if (scoreEl) scoreEl.textContent = (evaluation.overallScore || session.score || 0).toFixed(1);
    if (gradeEl) gradeEl.textContent = evaluation.grade || session.grade || '-';

    // 5대 영역 카드 (기안84 CSS 클래스: dimension-card)
    var dims = evaluation.dimensions || [];
    var cardsContainer = document.getElementById('dimensionCards');
    if (cardsContainer && dims.length > 0) {
      var html = '';
      dims.forEach(function (d) {
        var pct = Math.min(Math.max(((d.score || 0) / 5) * 100, 0), 100);
        html +=
          '<article class="dimension-card">' +
            '<div class="dimension-card__header">' +
              '<h3 class="dimension-card__name">' + escapeHtml(d.name) + '</h3>' +
              '<span class="dimension-card__weight">' + (d.weight || 0) + '%</span>' +
            '</div>' +
            '<div class="dimension-card__score-row">' +
              '<span class="dimension-card__score-value">' + (d.score || 0).toFixed(1) + '<span class="dimension-card__score-max"> / 5</span></span>' +
              '<div class="score-bar" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100">' +
                '<div class="score-bar__fill" style="width:' + pct + '%"></div>' +
              '</div>' +
            '</div>' +
            (d.evidence ? '<div class="dimension-card__detail"><div class="dimension-card__detail-label">\uADFC\uAC70</div><p class="dimension-card__detail-text">' + escapeHtml(d.evidence) + '</p></div>' : '') +
            (d.suggestion ? '<div class="dimension-card__detail"><div class="dimension-card__detail-label">\uAC1C\uC120 \uC81C\uC548</div><p class="dimension-card__detail-text">' + escapeHtml(d.suggestion) + '</p></div>' : '') +
          '</article>';
      });
      cardsContainer.innerHTML = html;
    }

    // 강점/개선점 (기안84 CSS 클래스: feedback-card)
    var strengthsEl = document.getElementById('strengthsList');
    var devEl = document.getElementById('developmentList');
    if (strengthsEl && evaluation.strengths) {
      strengthsEl.innerHTML = evaluation.strengths.map(function (s) {
        return '<div class="feedback-card feedback-card--strength" style="margin-top:var(--space-sm);">' + escapeHtml(s) + '</div>';
      }).join('');
    }
    if (devEl && evaluation.developmentAreas) {
      devEl.innerHTML = evaluation.developmentAreas.map(function (s) {
        return '<div class="feedback-card feedback-card--improvement" style="margin-top:var(--space-sm);">' + escapeHtml(s) + '</div>';
      }).join('');
    }

    // 종합 코멘트
    var summaryEl = document.getElementById('executiveSummary');
    if (summaryEl) {
      summaryEl.textContent = evaluation.executiveSummary || '\uD3C9\uAC00 \uB370\uC774\uD130\uAC00 \uBD80\uC871\uD569\uB2C8\uB2E4.';
    }

    // 로딩 숨기기
    var skeleton = document.getElementById('loadingSkeleton');
    var content = document.getElementById('reportContent');
    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = '';
  }

  document.addEventListener('DOMContentLoaded', loadReport);
})();
