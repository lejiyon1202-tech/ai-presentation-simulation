/* prepare.js — 준비 페이지: 자료 분석 + 발표문 작성 + 타이머 */
(function () {
  'use strict';

  var state = { sessionId: null, materials: {}, timerInterval: null, timeLeft: 0, prepStartTime: Date.now() };

  function getParam(name) {
    var url = new URL(window.location.href);
    return url.searchParams.get(name);
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

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  async function loadMaterials() {
    try {
      var resp = await fetch('/api/sessions/' + state.sessionId + '/materials?dataType=all');
      var data = await resp.json();
      state.materials = data.materials || {};
      state.timeLeft = (data.prepTimeMin || 45) * 60;

      var titleEl = document.getElementById('scenarioTitle');
      if (titleEl && data.background) titleEl.textContent = data.background.situation ? data.background.companyName || '' : '';

      // 자료 데이터만 state에 저장 — 기안84가 만든 HTML은 유지
      // API 자료는 시나리오별 동적 콘텐츠에만 사용

      startTimer();
    } catch (e) {
      console.error('[prepare] loadMaterials:', e);
      showToast('\uC790\uB8CC \uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    }
  }

  function startTimer() {
    var display = document.getElementById('prepTimer') || document.getElementById('timeRemaining');
    if (display) display.textContent = formatTime(state.timeLeft);

    state.timerInterval = setInterval(function () {
      state.timeLeft--;
      if (display) display.textContent = formatTime(Math.max(0, state.timeLeft));
      if (state.timeLeft <= 0) {
        clearInterval(state.timerInterval);
        showToast('\uC900\uBE44 \uC2DC\uAC04\uC774 \uC885\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', 'warning');
      }
    }, 1000);
  }

  function bindTabs() {
    var tabs = document.querySelectorAll('.materials-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.setAttribute('aria-selected', 'false'); t.classList.remove('active'); });
        tab.setAttribute('aria-selected', 'true');
        tab.classList.add('active');
        var target = tab.getAttribute('aria-controls') || tab.getAttribute('data-tab');
        document.querySelectorAll('[role="tabpanel"]').forEach(function (p) { p.hidden = true; });
        var panel = document.getElementById(target);
        if (panel) panel.hidden = false;

        // 데이터 접근 로그
        var dataType = tab.getAttribute('data-tab');
        if (dataType && state.sessionId) {
          fetch('/api/sessions/' + state.sessionId + '/materials?dataType=' + dataType).catch(function () {});
        }
      });
    });
  }

  function bindEditor() {
    var textarea = document.getElementById('presentationText');
    var charCount = document.getElementById('charCount');
    var wordCount = document.getElementById('wordCount');
    var startBtn = document.getElementById('startPresentationBtn');

    if (textarea) {
      textarea.addEventListener('input', function () {
        var text = textarea.value;
        if (charCount) charCount.textContent = text.length;
        if (wordCount) wordCount.textContent = text.trim().split(/\s+/).filter(Boolean).length;
        if (startBtn) startBtn.disabled = text.trim().length < 50;
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', function () {
        var text = textarea ? textarea.value : '';
        if (text.trim().length < 50) {
          showToast('\uBC1C\uD45C\uBB38\uC744 \uCD5C\uC18C 50\uC790 \uC774\uC0C1 \uC791\uC131\uD574\uC8FC\uC138\uC694.', 'warning');
          return;
        }

        var prepTimeSec = Math.round((Date.now() - state.prepStartTime) / 1000);

        fetch('/api/sessions/' + state.sessionId + '/presentation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, prepTimeSec: prepTimeSec }),
        })
        .then(function (r) { return r.json(); })
        .then(function () {
          clearInterval(state.timerInterval);
          window.location.href = 'presentation.html?session=' + state.sessionId;
        })
        .catch(function (err) {
          console.error('[prepare] submit:', err);
          showToast('\uBC1C\uD45C\uBB38 \uC81C\uCD9C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    state.sessionId = getParam('session') || localStorage.getItem('sessionId');
    if (!state.sessionId) {
      showToast('\uC138\uC158\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', 'error');
      setTimeout(function () { window.location.href = '/'; }, 2000);
      return;
    }
    loadMaterials();
    bindTabs();
    bindEditor();
  });
})();
