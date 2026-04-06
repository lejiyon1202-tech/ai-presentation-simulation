/* presentation.js — 발표 + AI Q&A 페이지 (전체 재작성)
   HTML ID 매핑: presentation.html 기준 */
(function () {
  'use strict';

  var state = {
    sessionId: null, phase: 'idle',
    mediaRecorder: null, audioChunks: [], audioBlob: null, audioUrl: null,
    recognition: null, transcript: '', recording: false,
    timerInterval: null, timeLeft: 600, recordStartTime: 0,
  };

  // ─── DOM 참조 (presentation.html ID 기준) ───
  var dom = {};
  function cacheDom() {
    dom = {
      // 발표 모드
      presentationMode: document.getElementById('presentationMode'),
      phaseIndicator: document.getElementById('phaseIndicator'),
      phaseText: document.querySelector('.phase-indicator__text'),
      phaseDot: document.querySelector('.phase-indicator__dot'),
      timerDisplay: document.getElementById('timerDisplay'),
      scriptBody: document.getElementById('scriptBody'),
      // 녹음 컨트롤
      recordBtn: document.getElementById('recordBtn'),
      stopBtn: document.getElementById('stopBtn'),
      reRecordBtn: document.getElementById('reRecordBtn'),
      recordingStatus: document.getElementById('recordingStatus'),
      recordingLabel: document.querySelector('.recording-status__label'),
      recordingTime: document.getElementById('recordingTime'),
      // 재생
      playbackControls: document.getElementById('playbackControls'),
      playBtn: document.getElementById('playBtn'),
      playbackSlider: document.getElementById('playbackSlider'),
      playbackCurrent: document.getElementById('playbackCurrent'),
      playbackTotal: document.getElementById('playbackTotal'),
      // Q&A 전환 버튼
      advanceToQA: document.getElementById('advanceToQA'),
      // Q&A 모드
      qaMode: document.getElementById('qaMode'),
      qaMessages: document.getElementById('qaMessages'),
      qaInput: document.getElementById('qaInput'),
      qaSendBtn: document.getElementById('qaSendBtn'),
      endSessionBtn: document.getElementById('endSessionBtn'),
      qaTimer: document.getElementById('qaTimer'),
      turnCount: document.getElementById('turnCount'),
      remainingQuestions: document.getElementById('remainingQuestions'),
      // 기타
      toastContainer: document.getElementById('toastContainer'),
      audioWaveform: document.getElementById('audioWaveform'),
    };
  }

  // ─── 유틸리티 ───
  function getParam(n) { return new URL(window.location.href).searchParams.get(n); }

  function formatTime(s) {
    var m = Math.floor(Math.max(0, s) / 60);
    var sec = Math.max(0, s) % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + Math.floor(sec);
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    var d = document.createElement('div'); d.textContent = str; return d.innerHTML;
  }

  function showToast(msg, type) {
    var c = dom.toastContainer;
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'info');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  // ─── 상태 업데이트 ───
  function setPhase(phase, label) {
    state.phase = phase;
    if (dom.phaseText) dom.phaseText.textContent = label;
    if (dom.phaseDot) {
      dom.phaseDot.className = 'phase-indicator__dot';
      if (phase === 'recording') dom.phaseDot.classList.add('phase-indicator__dot--recording');
      if (phase === 'qa') dom.phaseDot.classList.add('phase-indicator__dot--qa');
    }
  }

  function setRecordingLabel(text) {
    if (dom.recordingLabel) dom.recordingLabel.textContent = text;
  }

  // ─── 음성 녹음 ───
  async function startRecording() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      state.audioChunks = [];
      state.transcript = '';
      state.recording = true;
      state.recordStartTime = Date.now();

      state.mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) state.audioChunks.push(e.data); };
      state.mediaRecorder.onstop = onRecordingStop;
      state.mediaRecorder.start(1000);

      // UI 업데이트
      setPhase('recording', '발표 중');
      setRecordingLabel('발표 중');
      if (dom.recordBtn) dom.recordBtn.disabled = true;
      if (dom.stopBtn) dom.stopBtn.disabled = false;
      if (dom.recordingStatus) dom.recordingStatus.classList.add('recording-status--active');
      if (dom.audioWaveform) dom.audioWaveform.classList.add('waveform--active');

      // STT + 타이머 시작
      startSTT();
      startPresentTimer();

      showToast('녹음이 시작되었습니다. 발표해주세요.', 'success');
    } catch (e) {
      console.error('[presentation] mic error:', e);
      showToast('마이크를 사용할 수 없습니다. 텍스트 모드로 전환합니다.', 'warning');
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

    // UI 업데이트
    setPhase('recorded', '녹음 완료');
    setRecordingLabel('녹음 완료');
    if (dom.recordBtn) dom.recordBtn.disabled = true;
    if (dom.stopBtn) dom.stopBtn.disabled = true;
    if (dom.recordingStatus) dom.recordingStatus.classList.remove('recording-status--active');
    if (dom.audioWaveform) dom.audioWaveform.classList.remove('waveform--active');
    if (dom.advanceToQA) dom.advanceToQA.style.display = '';
  }

  function onRecordingStop() {
    state.audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
    state.audioUrl = URL.createObjectURL(state.audioBlob);
    var duration = Math.round((Date.now() - state.recordStartTime) / 1000);

    // 재생 컨트롤 표시
    if (dom.playbackControls) dom.playbackControls.hidden = false;
    if (dom.playbackTotal) dom.playbackTotal.textContent = formatTime(duration);
    if (dom.reRecordBtn) dom.reRecordBtn.style.display = '';

    // 음성 파일 업로드
    var formData = new FormData();
    formData.append('audio', state.audioBlob, 'presentation.webm');
    fetch('/api/sessions/' + state.sessionId + '/audio', { method: 'POST', body: formData }).catch(function () {});

    // STT 결과 + 음성 메타데이터 전송
    fetch('/api/sessions/' + state.sessionId + '/presentation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioTranscript: state.transcript, audioDurationSec: duration }),
    }).catch(function () {});

    showToast('녹음이 완료되었습니다. "Q&A 시작" 버튼을 눌러주세요.', 'success');
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
      if (dom.scriptBody) dom.scriptBody.textContent = transcript || '(음성을 인식하고 있습니다...)';
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
    state.timerInterval = setInterval(function () {
      state.timeLeft--;
      if (dom.timerDisplay) dom.timerDisplay.textContent = formatTime(state.timeLeft);
      if (dom.recordingTime) {
        var elapsed = Math.round((Date.now() - state.recordStartTime) / 1000);
        dom.recordingTime.textContent = formatTime(elapsed) + ' / 10:00';
      }
      if (state.timeLeft <= 0) { stopRecording(); }
    }, 1000);
  }

  // ─── 텍스트 폴백 (마이크 불가 시) ───
  function showTextFallback() {
    setPhase('text', '텍스트 발표');
    setRecordingLabel('텍스트 모드');

    // 녹음 컨트롤 숨기기
    if (dom.recordBtn) dom.recordBtn.style.display = 'none';
    if (dom.stopBtn) dom.stopBtn.style.display = 'none';
    if (dom.audioWaveform) dom.audioWaveform.style.display = 'none';

    var controls = dom.recordBtn && dom.recordBtn.parentElement;
    if (!controls) controls = dom.presentationMode;
    if (!controls) return;

    var fallback = document.createElement('div');
    fallback.className = 'text-fallback';
    fallback.style.cssText = 'padding:var(--space-lg);text-align:center;';
    fallback.innerHTML =
      '<p style="color:var(--text-muted);margin-bottom:var(--space-md);">마이크를 사용할 수 없습니다. (HTTPS 필요)</p>' +
      '<textarea id="textPresentationInput" rows="8" style="width:100%;padding:var(--space-md);border:1px solid var(--border-color);border-radius:var(--radius-md);font-size:var(--font-size-base);resize:vertical;" placeholder="발표 내용을 텍스트로 입력하세요..."></textarea>' +
      '<button id="textPresentSubmit" class="btn btn-primary" style="margin-top:var(--space-md);">발표 완료 → Q&A 시작</button>';
    controls.parentElement.insertBefore(fallback, controls.nextSibling);

    document.getElementById('textPresentSubmit').addEventListener('click', function () {
      var text = (document.getElementById('textPresentationInput') || {}).value || '';
      if (!text.trim()) { showToast('발표 내용을 입력해주세요.', 'warning'); return; }
      fetch('/api/sessions/' + state.sessionId + '/presentation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, audioDurationSec: 0 }),
      }).then(function () { enterQAPhase(); }).catch(function () { showToast('제출 실패', 'error'); });
    });
  }

  // ─── Q&A 전환 ───
  function enterQAPhase() {
    setPhase('qa', 'Q&A 진행 중');

    // 발표 모드 숨기고 Q&A 표시
    if (dom.presentationMode) { dom.presentationMode.hidden = true; dom.presentationMode.style.display = 'none'; }
    if (dom.qaMode) { dom.qaMode.hidden = false; dom.qaMode.style.display = ''; }

    // 샘플 데이터 제거
    if (dom.qaMessages) {
      var samples = dom.qaMessages.querySelectorAll('.qa-msg--audience, .qa-msg--learner');
      samples.forEach(function (el) { el.remove(); });
    }

    showToast('AI 청중 Q&A가 시작됩니다. 질문에 답변해주세요.', 'info');
  }

  // ─── Q&A 메시지 ───
  function sendQAMessage() {
    if (!dom.qaInput) return;
    var msg = dom.qaInput.value.trim();
    if (!msg) return;

    appendQAMessage('learner', localStorage.getItem('learnerName') || '발표자', '', msg);
    dom.qaInput.value = '';
    dom.qaInput.disabled = true;
    if (dom.qaSendBtn) dom.qaSendBtn.disabled = true;

    fetch('/api/sessions/' + state.sessionId + '/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      dom.qaInput.disabled = false;
      if (dom.qaSendBtn) dom.qaSendBtn.disabled = false;
      dom.qaInput.focus();
      if (data.aiResponse) {
        appendQAMessage('audience', data.aiResponse.speakerName, data.aiResponse.speakerRole || '', data.aiResponse.content);
      }
      if (dom.turnCount) dom.turnCount.textContent = data.totalTurns || 0;
    })
    .catch(function (err) {
      dom.qaInput.disabled = false;
      if (dom.qaSendBtn) dom.qaSendBtn.disabled = false;
      console.error('[qa]', err);
      showToast('Q&A 처리에 실패했습니다.', 'error');
    });
  }

  function appendQAMessage(type, name, dept, content) {
    if (!dom.qaMessages) return;
    var div = document.createElement('div');
    div.className = 'qa-msg qa-msg--' + type;

    if (type === 'audience') {
      div.innerHTML =
        '<div class="qa-msg__badge">' +
          '<div class="qa-msg__author">' +
            '<span class="qa-msg__name">' + escapeHtml(name) + '</span>' +
            (dept ? '<span class="qa-msg__dept">' + escapeHtml(dept) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="qa-msg__bubble"><p>' + escapeHtml(content) + '</p></div>';
    } else {
      div.innerHTML = '<div class="qa-msg__bubble"><p>' + escapeHtml(content) + '</p></div>';
    }

    dom.qaMessages.appendChild(div);
    dom.qaMessages.scrollTop = dom.qaMessages.scrollHeight;
  }

  // ─── 평가 + 종료 ───
  function endSession() {
    showToast('평가 준비 중...', 'info');
    if (dom.endSessionBtn) dom.endSessionBtn.disabled = true;

    fetch('/api/sessions/' + state.sessionId + '/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    .then(function (r) { return r.json(); })
    .then(function () {
      window.location.href = 'report.html?session=' + state.sessionId;
    })
    .catch(function (err) {
      if (dom.endSessionBtn) dom.endSessionBtn.disabled = false;
      console.error('[evaluate]', err);
      showToast('평가에 실패했습니다.', 'error');
    });
  }

  // ─── 재생 ───
  function playAudio() {
    if (!state.audioUrl) return;
    var audio = new Audio(state.audioUrl);
    audio.play();
    audio.ontimeupdate = function () {
      if (dom.playbackCurrent) dom.playbackCurrent.textContent = formatTime(audio.currentTime);
      if (dom.playbackSlider) dom.playbackSlider.value = (audio.currentTime / audio.duration) * 100;
    };
  }

  // ─── 초기화 ───
  document.addEventListener('DOMContentLoaded', function () {
    cacheDom();

    state.sessionId = getParam('session') || localStorage.getItem('sessionId');
    if (!state.sessionId) {
      showToast('세션을 찾을 수 없습니다.', 'error');
      setTimeout(function () { window.location.href = '/'; }, 2000);
      return;
    }

    // 초기 상태
    setPhase('idle', '대기 중');
    setRecordingLabel('대기 중');
    if (dom.advanceToQA) dom.advanceToQA.style.display = 'none';

    // 이벤트 바인딩
    if (dom.recordBtn) dom.recordBtn.addEventListener('click', startRecording);
    if (dom.stopBtn) dom.stopBtn.addEventListener('click', stopRecording);
    if (dom.reRecordBtn) dom.reRecordBtn.addEventListener('click', function () {
      state.audioChunks = []; state.audioBlob = null;
      if (dom.playbackControls) dom.playbackControls.hidden = true;
      if (dom.advanceToQA) dom.advanceToQA.style.display = 'none';
      startRecording();
    });
    if (dom.advanceToQA) dom.advanceToQA.addEventListener('click', enterQAPhase);
    if (dom.qaSendBtn) dom.qaSendBtn.addEventListener('click', sendQAMessage);
    if (dom.qaInput) dom.qaInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQAMessage(); }
    });
    if (dom.endSessionBtn) dom.endSessionBtn.addEventListener('click', endSession);
    if (dom.playBtn) dom.playBtn.addEventListener('click', playAudio);
  });
})();
