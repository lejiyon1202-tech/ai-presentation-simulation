/* presentation.js — 발표 + AI Q&A 페이지: 음성 녹음 + STT + AI 청중 Q&A */
(function () {
  'use strict';

  var state = {
    sessionId: null, phase: 'present', mediaRecorder: null,
    audioChunks: [], audioBlob: null, audioUrl: null,
    recognition: null, transcript: '', recording: false,
    timerInterval: null, timeLeft: 600, qaMessages: [],
  };

  function getParam(n) { return new URL(window.location.href).searchParams.get(n); }

  function showToast(msg, type) {
    var c = document.getElementById('toastContainer');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'info');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  function formatTime(s) {
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    var d = document.createElement('div'); d.textContent = str; return d.innerHTML;
  }

  // ─── 음성 녹음 ───
  async function startRecording() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      state.audioChunks = [];
      state.transcript = '';
      state.recording = true;

      state.mediaRecorder.ondataavailable = function (e) { state.audioChunks.push(e.data); };
      state.mediaRecorder.onstop = onRecordingStop;
      state.mediaRecorder.start(1000);

      // STT 시작
      startSTT();
      startPresentTimer();

      var recordBtn = document.getElementById('recordBtn');
      var stopBtn = document.getElementById('stopBtn');
      var status = document.getElementById('recordingStatus');
      if (recordBtn) recordBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (status) status.style.display = '';

      showToast('\uB179\uC74C\uC774 \uC2DC\uC791\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uBC1C\uD45C\uD574\uC8FC\uC138\uC694.', 'success');
    } catch (e) {
      console.error('[presentation] mic error:', e);
      showToast('\uB9C8\uC774\uD06C\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD14D\uC2A4\uD2B8 \uBC1C\uD45C \uBAA8\uB4DC\uB85C \uC804\uD658\uD569\uB2C8\uB2E4.', 'warning');
      showTextFallback();
    }
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
      state.mediaRecorder.stream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (state.recognition) { try { state.recognition.stop(); } catch (e) {} }
    state.recording = false;
    clearInterval(state.timerInterval);
  }

  function onRecordingStop() {
    state.audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
    state.audioUrl = URL.createObjectURL(state.audioBlob);

    var playback = document.getElementById('playbackControls');
    if (playback) playback.hidden = false;

    // 음성 파일 업로드
    var formData = new FormData();
    formData.append('audio', state.audioBlob, 'presentation.webm');
    fetch('/api/sessions/' + state.sessionId + '/audio', { method: 'POST', body: formData })
      .then(function () { console.log('[presentation] audio uploaded'); })
      .catch(function (e) { console.error('[presentation] audio upload error:', e); });

    // STT 결과 + 음성 메타데이터 전송
    var duration = state.audioChunks.length; // 대략 초 단위 (1초당 1 chunk)
    fetch('/api/sessions/' + state.sessionId + '/presentation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioTranscript: state.transcript, audioDurationSec: duration }),
    }).catch(function () {});

    showToast('\uB179\uC74C\uC774 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', 'success');
    showQAPhase();
  }

  // ─── STT (Web Speech API) ───
  function startSTT() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = 'ko-KR';

    state.recognition.onresult = function (event) {
      var transcript = '';
      for (var i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      state.transcript = transcript;
      var display = document.getElementById('scriptBody');
      if (display) display.textContent = transcript || '(\uC74C\uC131\uC744 \uC778\uC2DD\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4...)';
    };

    state.recognition.onerror = function (e) {
      if (e.error !== 'no-speech') console.error('[STT] error:', e.error);
    };

    state.recognition.onend = function () {
      if (state.recording) { try { state.recognition.start(); } catch (e) {} }
    };

    state.recognition.start();
  }

  function startPresentTimer() {
    state.timeLeft = 600; // 10분
    var display = document.getElementById('timerDisplay') || document.getElementById('recordingTime');
    state.timerInterval = setInterval(function () {
      state.timeLeft--;
      if (display) display.textContent = formatTime(Math.max(0, state.timeLeft));
      if (state.timeLeft <= 0) { stopRecording(); }
    }, 1000);
  }

  // ─── Q&A 페이즈 ───
  function showQAPhase() {
    state.phase = 'qa';
    var indicator = document.getElementById('phaseIndicator');
    if (indicator) indicator.textContent = 'Q&A \uC9C4\uD589 \uC911';

    var presentMode = document.getElementById('presentationMode');
    var qaMode = document.getElementById('qaMode');
    if (presentMode) { presentMode.style.display = 'none'; presentMode.hidden = true; }
    if (qaMode) { qaMode.hidden = false; qaMode.style.display = ''; }

    // 샘플 데이터 제거 (기안84 HTML placeholder)
    var qaMessages = document.getElementById('qaMessages');
    if (qaMessages) {
      var samples = qaMessages.querySelectorAll('.qa-msg--audience, .qa-msg--learner');
      samples.forEach(function (el) { el.remove(); });
    }

    showToast('AI \uCCAD\uC911 Q&A\uAC00 \uC2DC\uC791\uB429\uB2C8\uB2E4.', 'info');
  }

  // ─── 텍스트 폴백 (마이크 불가 시) ───
  function showTextFallback() {
    var presentMode = document.getElementById('presentationMode');
    if (!presentMode) return;

    // 녹음 UI 숨기고 텍스트 입력 표시
    var recordingArea = presentMode.querySelector('.recording-controls') || presentMode.querySelector('.waveform');
    if (recordingArea) recordingArea.style.display = 'none';

    var fallback = document.createElement('div');
    fallback.className = 'text-fallback';
    fallback.innerHTML =
      '<div style="padding:var(--space-lg);text-align:center;">' +
        '<p style="color:var(--text-muted);margin-bottom:var(--space-md);">\uB9C8\uC774\uD06C\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. (HTTPS \uD544\uC694)</p>' +
        '<p style="margin-bottom:var(--space-lg);">\uD14D\uC2A4\uD2B8\uB85C \uBC1C\uD45C \uB0B4\uC6A9\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694.</p>' +
        '<textarea id="textPresentationInput" rows="8" style="width:100%;padding:var(--space-md);border:1px solid var(--border-color);border-radius:var(--radius-md);font-size:var(--font-size-base);resize:vertical;" placeholder="\uBC1C\uD45C \uB0B4\uC6A9\uC744 \uC785\uB825\uD558\uC138\uC694..."></textarea>' +
        '<button id="textPresentSubmit" class="btn btn-primary" style="margin-top:var(--space-md);">\uBC1C\uD45C \uC644\uB8CC \u2192 Q&A \uC2DC\uC791</button>' +
      '</div>';
    presentMode.appendChild(fallback);

    var submitBtn = document.getElementById('textPresentSubmit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var text = (document.getElementById('textPresentationInput') || {}).value || '';
        if (!text.trim()) { showToast('\uBC1C\uD45C \uB0B4\uC6A9\uC744 \uC785\uB825\uD574\uC8FC\uC138\uC694.', 'warning'); return; }

        fetch('/api/sessions/' + state.sessionId + '/presentation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, audioDurationSec: 0 }),
        }).then(function () {
          showQAPhase();
        }).catch(function () {
          showToast('\uC81C\uCD9C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
        });
      });
    }
  }

  function sendQAMessage() {
    var input = document.getElementById('qaInput');
    if (!input) return;
    var msg = input.value.trim();
    if (!msg) return;

    appendQAMessage('user', localStorage.getItem('learnerName') || '\uBC1C\uD45C\uC790', msg);
    input.value = '';
    input.disabled = true;

    fetch('/api/sessions/' + state.sessionId + '/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      input.disabled = false;
      input.focus();
      if (data.aiResponse) {
        appendQAMessage('ai', data.aiResponse.speakerName + ' (' + data.aiResponse.speakerRole + ')', data.aiResponse.content);
      }
    })
    .catch(function (err) {
      input.disabled = false;
      console.error('[qa]', err);
      showToast('Q&A \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    });
  }

  function appendQAMessage(role, name, content) {
    var container = document.getElementById('qaMessages');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'qa-message qa-message--' + role;
    div.innerHTML = '<div class="qa-message__name">' + escapeHtml(name) + '</div><div class="qa-message__content">' + escapeHtml(content) + '</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function endQA() {
    showToast('\uD3C9\uAC00 \uC900\uBE44 \uC911...', 'info');
    fetch('/api/sessions/' + state.sessionId + '/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    .then(function (r) { return r.json(); })
    .then(function () {
      window.location.href = 'report.html?session=' + state.sessionId;
    })
    .catch(function (err) {
      console.error('[evaluate]', err);
      showToast('\uD3C9\uAC00\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.', 'error');
    });
  }

  // ─── Init ───
  document.addEventListener('DOMContentLoaded', function () {
    state.sessionId = getParam('session') || localStorage.getItem('sessionId');
    if (!state.sessionId) {
      showToast('\uC138\uC158\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', 'error');
      setTimeout(function () { window.location.href = '/'; }, 2000);
      return;
    }

    var recordBtn = document.getElementById('recordBtn');
    var stopBtn = document.getElementById('stopBtn');
    var reRecordBtn = document.getElementById('reRecordBtn');
    var qaSubmit = document.getElementById('qaSendBtn');
    var qaInput = document.getElementById('qaInput');
    var endBtn = document.getElementById('endQaBtn');

    if (recordBtn) recordBtn.addEventListener('click', startRecording);
    if (stopBtn) stopBtn.addEventListener('click', stopRecording);
    if (reRecordBtn) reRecordBtn.addEventListener('click', function () {
      state.audioChunks = []; state.audioBlob = null;
      var playback = document.getElementById('playbackControls');
      if (playback) playback.hidden = true;
      startRecording();
    });
    if (qaSubmit) qaSubmit.addEventListener('click', sendQAMessage);
    if (qaInput) qaInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQAMessage(); }
    });
    if (endBtn) endBtn.addEventListener('click', endQA);

    // 재생 컨트롤
    var playBtn = document.getElementById('playBtn');
    if (playBtn) playBtn.addEventListener('click', function () {
      if (state.audioUrl) {
        var audio = new Audio(state.audioUrl);
        audio.play();
      }
    });
  });
})();
