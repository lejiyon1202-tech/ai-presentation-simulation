/**
 * server.js — AI 프레젠테이션 시뮬레이션 서버
 * Express + SQLite + Claude API
 */

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { randomUUID, randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';

import {
  initDB, createSession, getSession, updateSession, listSessions,
  addQAMessage, getQAMessages, logDataAccess, getDataAccessLog,
  getStats, exportAllData, saveDB,
} from './data-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3007', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const app = express();

// ─── 미들웨어 ───

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

app.use(cors({
  origin: NODE_ENV === 'production'
    ? (process.env.CORS_ORIGINS || '').split(',').filter(Boolean)
    : true,
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.static(join(__dirname, 'public')));

const globalLimiter = rateLimit({ windowMs: 60000, max: 60 });
const chatLimiter = rateLimit({ windowMs: 60000, max: 10, message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' } });
const evaluateLimiter = rateLimit({ windowMs: 60000, max: 5, message: { error: '평가 요청이 너무 많습니다.' } });

app.use(globalLimiter);

// ─── 음성 파일 업로드 설정 ───

const UPLOAD_DIR = join(__dirname, 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${req.params.id}-${Date.now()}.webm`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/mp4', 'audio/mpeg', 'audio/ogg'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ─── 시나리오 로드 ───

const scenarioSets = {};

// 시나리오 로드는 initServer()에서 수행

function getScenarioById(setId, scenarioId) {
  const set = scenarioSets[setId];
  if (!set) return null;
  return set.scenarios.find(s => s.id === scenarioId) || null;
}

// ─── 관리자 인증 ───

function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const pw = decoded.indexOf(':') >= 0 ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
    if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }
    next();
  } catch {
    return res.status(401).json({ error: '인증 오류' });
  }
}

// ─── 유틸리티 ───

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, 200);
}

// ════════════════════════════════════════════
// API 라우트 — 학습자
// ════════════════════════════════════════════

// 1. 헬스체크
app.get('/api/health', (req, res) => {
  const setCount = Object.keys(scenarioSets).length;
  res.json({
    status: 'ok',
    service: 'ai-presentation-simulation',
    port: PORT,
    scenarioSets: setCount,
    claude: !!CLAUDE_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// 2. 시나리오 목록
app.get('/api/scenarios', (req, res) => {
  res.json(scenarioSets);
});

// 3. 시나리오 상세
app.get('/api/scenarios/:setId/:id', (req, res) => {
  const scenario = getScenarioById(req.params.setId, req.params.id);
  if (!scenario) return res.status(404).json({ error: '시나리오를 찾을 수 없습니다.' });
  res.json(scenario);
});

// 4. 세션 생성
app.post('/api/sessions', (req, res) => {
  try {
    const { scenarioId, scenarioSetId, learnerName, learnerId, learnerOrg, model } = req.body;
    if (!scenarioId || !learnerName) {
      return res.status(400).json({ error: 'scenarioId, learnerName은 필수입니다.' });
    }

    const setId = scenarioSetId || 'default';
    const scenario = getScenarioById(setId, scenarioId);
    if (!scenario) {
      return res.status(404).json({ error: '시나리오를 찾을 수 없습니다.' });
    }

    const sessionId = randomUUID();
    const session = createSession({
      id: sessionId,
      scenarioId,
      scenarioSetId: setId,
      learnerId: sanitizeInput(learnerId || ''),
      learnerName: sanitizeInput(learnerName),
      learnerOrg: sanitizeInput(learnerOrg || ''),
      model: model || 'claude',
      timeLimitSec: (scenario.prepTimeMin || 45) * 60,
    });

    console.log(`[POST /api/sessions] 세션 생성: ${sessionId} (시나리오: ${scenarioId}, 학습자: ${learnerName})`);
    res.json(session);
  } catch (err) {
    console.error('[POST /api/sessions]', err.message);
    res.status(500).json({ error: '세션 생성에 실패했습니다.' });
  }
});

// 5. 세션 상세
app.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  res.json(session);
});

// 6. 준비 자료 조회
app.get('/api/sessions/:id/materials', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

  const scenario = getScenarioById(session.scenario_set_id, session.scenario_id);
  if (!scenario) return res.status(404).json({ error: '시나리오를 찾을 수 없습니다.' });

  const { dataType } = req.query;
  if (dataType) {
    logDataAccess(session.id, dataType);
  }

  res.json({
    materials: scenario.materials || {},
    background: scenario.background || {},
    prepTimeMin: scenario.prepTimeMin || 45,
    presentTimeMin: scenario.presentTimeMin || 10,
    qaTimeMin: scenario.qaTimeMin || 8,
  });
});

// 7. 발표문 제출
app.post('/api/sessions/:id/presentation', (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

    const { text, audioTranscript, audioDurationSec, prepTimeSec } = req.body;
    if (!text && !audioTranscript) {
      return res.status(400).json({ error: '발표문 텍스트 또는 음성 변환 텍스트가 필요합니다.' });
    }

    updateSession(session.id, {
      presentationText: text || '',
      audioTranscript: audioTranscript || '',
      audioDurationSec: audioDurationSec || 0,
      prepTimeSec: prepTimeSec || 0,
      status: 'presenting',
    });

    console.log(`[POST /api/sessions/${req.params.id}/presentation] 발표문 제출 (${(text || '').length}자)`);
    res.json({ message: '발표문이 제출되었습니다.', status: 'presenting' });
  } catch (err) {
    console.error('[POST /api/sessions/:id/presentation]', err.message);
    res.status(500).json({ error: '발표문 제출에 실패했습니다.' });
  }
});

// 8. 음성 파일 업로드
app.post('/api/sessions/:id/audio', upload.single('audio'), (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

    if (!req.file) return res.status(400).json({ error: '음성 파일이 없습니다.' });

    updateSession(session.id, { audioPath: req.file.path });
    console.log(`[POST /api/sessions/${req.params.id}/audio] 음성 업로드: ${req.file.filename}`);
    res.json({ message: '음성 파일이 업로드되었습니다.', filename: req.file.filename });
  } catch (err) {
    console.error('[POST /api/sessions/:id/audio]', err.message);
    res.status(500).json({ error: '음성 업로드에 실패했습니다.' });
  }
});

// 9. Q&A 메시지 (AI 청중 응답)
app.post('/api/sessions/:id/qa', chatLimiter, async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message는 필수입니다.' });

    const messages = getQAMessages(session.id);
    const turnNumber = messages.length + 1;

    // 학습자 메시지 저장
    addQAMessage({
      sessionId: session.id,
      role: 'user',
      speakerName: session.learner_name,
      content: message,
      turnNumber,
    });

    // AI 청중 응답 생성
    const scenario = getScenarioById(session.scenario_set_id, session.scenario_id);
    const audience = scenario?.audience || [];
    const speakerIdx = Math.floor(turnNumber / 2) % audience.length;
    const speaker = audience[speakerIdx] || { name: 'AI 청중', role: '평가위원', focus: '', personality: '' };

    let aiContent = '';
    if (CLAUDE_API_KEY) {
      const promptTemplate = scenarioSets[session.scenario_set_id]?.dialoguePrompt || '';
      const qaHistory = messages.map(m => `${m.role === 'user' ? '발표자' : m.speaker_name}: ${m.content}`).join('\n');
      const systemPrompt = promptTemplate
        .replace('{{speaker_name}}', speaker.name)
        .replace('{{speaker_role}}', speaker.role)
        .replace('{{speaker_focus}}', speaker.focus || '')
        .replace('{{speaker_personality}}', speaker.personality || '')
        .replace('{{company_name}}', scenario?.background?.companyName || '')
        .replace('{{scenario_title}}', scenario?.title || '')
        .replace('{{learner_role}}', scenario?.background?.learnerRole?.title || '')
        .replace('{{presentation_text}}', session.presentation_text || '')
        .replace('{{qa_history}}', qaHistory);

      try {
        const claude = new Anthropic({ apiKey: CLAUDE_API_KEY });
        const resp = await claude.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
        });
        aiContent = resp.content[0]?.text || '';
        const usage = resp.usage || {};
        updateSession(session.id, {
          totalInputTokens: (session.total_input_tokens || 0) + (usage.input_tokens || 0),
          totalOutputTokens: (session.total_output_tokens || 0) + (usage.output_tokens || 0),
          totalTokens: (session.total_tokens || 0) + (usage.input_tokens || 0) + (usage.output_tokens || 0),
        });
      } catch (e) {
        console.error('[Q&A] Claude API error:', e.message);
        aiContent = '죄송합니다만, 그 부분에 대해 좀 더 구체적으로 설명해주시겠습니까?';
      }
    } else {
      aiContent = '(Claude API 키가 설정되지 않았습니다.)';
    }

    const aiResponse = {
      speakerName: speaker.name,
      speakerRole: speaker.role,
      content: aiContent,
    };

    addQAMessage({
      sessionId: session.id,
      role: 'ai',
      speakerName: aiResponse.speakerName,
      speakerRole: aiResponse.speakerRole,
      content: aiResponse.content,
      turnNumber: turnNumber + 1,
    });

    if (session.status !== 'qa') {
      updateSession(session.id, { status: 'qa' });
    }

    res.json({
      userMessage: { turnNumber, content: message },
      aiResponse: { ...aiResponse, turnNumber: turnNumber + 1 },
      totalTurns: turnNumber + 1,
    });
  } catch (err) {
    console.error('[POST /api/sessions/:id/qa]', err.message);
    res.status(500).json({ error: 'Q&A 처리에 실패했습니다.' });
  }
});

// 10. 평가 요청
app.post('/api/sessions/:id/evaluate', evaluateLimiter, async (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

    updateSession(session.id, { status: 'evaluating' });

    const scenario = getScenarioById(session.scenario_set_id, session.scenario_id);
    const qaMessages = getQAMessages(session.id);
    const dataLog = getDataAccessLog(session.id);

    let evaluation;
    if (CLAUDE_API_KEY) {
      const promptTemplate = scenarioSets[session.scenario_set_id]?.evaluationPrompt || '';
      const qaText = qaMessages.map(m => `${m.role === 'user' ? '발표자' : m.speaker_name}(${m.speaker_role || ''}): ${m.content}`).join('\n');
      const dataLogText = dataLog.map(d => `${d.data_type} (${d.accessed_at})`).join(', ') || '없음';

      const evalPrompt = promptTemplate
        .replace('{{learner_name}}', session.learner_name)
        .replace('{{learner_role}}', scenario?.background?.learnerRole?.title || '')
        .replace('{{scenario_title}}', scenario?.title || '')
        .replace('{{company_name}}', scenario?.background?.companyName || '')
        .replace('{{presentation_text}}', session.presentation_text || '(발표문 미제출)')
        .replace('{{audio_transcript}}', session.audio_transcript || '(음성 없음)')
        .replace('{{audio_duration_sec}}', String(session.audio_duration_sec || 0))
        .replace('{{present_time_min}}', String(scenario?.presentTimeMin || 10))
        .replace('{{prep_time_sec}}', String(session.prep_time_sec || 0))
        .replace('{{prep_time_min}}', String(scenario?.prepTimeMin || 45))
        .replace('{{qa_messages}}', qaText || '(Q&A 없음)')
        .replace('{{data_access_log}}', dataLogText);

      try {
        const claude = new Anthropic({ apiKey: CLAUDE_API_KEY });
        const resp = await claude.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: evalPrompt,
          messages: [{ role: 'user', content: '위 데이터를 기반으로 프레젠테이션 역량을 평가해주세요.' }],
        });

        const text = resp.content[0]?.text || '{}';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

        const usage = resp.usage || {};
        updateSession(session.id, {
          totalInputTokens: (session.total_input_tokens || 0) + (usage.input_tokens || 0),
          totalOutputTokens: (session.total_output_tokens || 0) + (usage.output_tokens || 0),
          totalTokens: (session.total_tokens || 0) + (usage.input_tokens || 0) + (usage.output_tokens || 0),
        });
      } catch (e) {
        console.error('[EVALUATE] Claude API error:', e.message);
        evaluation = { error: true, executiveSummary: '평가 처리 중 오류가 발생했습니다.' };
      }
    } else {
      evaluation = {
        dimensions: [
          { name: '내용 구성', score: 0, weight: 30, level: '미평가', evidence: '', suggestion: '' },
          { name: '논리 전개', score: 0, weight: 25, level: '미평가', evidence: '', suggestion: '' },
          { name: '전달력', score: 0, weight: 20, level: '미평가', evidence: '', suggestion: '' },
          { name: 'Q&A 대응', score: 0, weight: 15, level: '미평가', evidence: '', suggestion: '' },
          { name: '시간 관리', score: 0, weight: 10, level: '미평가', evidence: '', suggestion: '' },
        ],
        overallScore: 0,
        grade: '미평가',
        strengths: [],
        developmentAreas: [],
        executiveSummary: 'Claude API 키가 설정되지 않아 평가를 수행할 수 없습니다.',
      };
    }

    updateSession(session.id, {
      score: evaluation.overallScore,
      grade: evaluation.grade,
      evaluationJson: JSON.stringify(evaluation),
      status: 'completed',
      completedAt: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    });

    console.log(`[POST /api/sessions/${req.params.id}/evaluate] 평가 완료`);
    res.json({ evaluation, sessionId: session.id });
  } catch (err) {
    console.error('[POST /api/sessions/:id/evaluate]', err.message);
    res.status(500).json({ error: '평가에 실패했습니다.' });
  }
});

// 11. 리포트 조회
app.get('/api/sessions/:id/report', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

  const scenario = getScenarioById(session.scenario_set_id, session.scenario_id);
  const qaMessages = getQAMessages(session.id);
  const dataLog = getDataAccessLog(session.id);
  let evaluation = {};
  try { evaluation = JSON.parse(session.evaluation_json || '{}'); } catch { /* ignore */ }

  res.json({
    session,
    scenario: scenario ? { id: scenario.id, title: scenario.title, type: scenario.type, difficulty: scenario.difficulty } : null,
    evaluation,
    qaMessages,
    dataAccessLog: dataLog,
  });
});

// ════════════════════════════════════════════
// API 라우트 — 관리자
// ════════════════════════════════════════════

app.get('/api/admin/sessions', adminAuth, (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const sessions = listSessions(limit, offset);
  res.json({ sessions, total: sessions.length });
});

app.get('/api/admin/sessions/:id', adminAuth, (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  const qaMessages = getQAMessages(session.id);
  const dataLog = getDataAccessLog(session.id);
  let evaluation = {};
  try { evaluation = JSON.parse(session.evaluation_json || '{}'); } catch { /* ignore */ }
  res.json({ session, qaMessages, dataAccessLog: dataLog, evaluation });
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
  const stats = getStats();
  const scenarioList = [];
  for (const [setId, set] of Object.entries(scenarioSets)) {
    for (const s of set.scenarios) {
      scenarioList.push({ setId, id: s.id, title: s.title, type: s.type });
    }
  }
  res.json({ ...stats, scenarios: scenarioList });
});

app.get('/api/admin/export', adminAuth, (req, res) => {
  const format = req.query.format || 'json';
  const data = exportAllData();
  if (format === 'csv') {
    const sessions = data.sessions || [];
    const header = 'id,learner_name,learner_id,scenario_id,status,score,grade,started_at,completed_at\n';
    const rows = sessions.map(s =>
      `${s.id},${s.learner_name},${s.learner_id},${s.scenario_id},${s.status},${s.score || ''},${s.grade || ''},${s.started_at},${s.completed_at || ''}`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=export.csv');
    res.send('\uFEFF' + header + rows);
  } else {
    res.json(data);
  }
});

app.get('/api/admin/scenarios', adminAuth, (req, res) => {
  res.json(scenarioSets);
});

app.get('/api/admin/scenarios/excel', adminAuth, async (req, res) => {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const [setId, set] of Object.entries(scenarioSets)) {
      const rows = set.scenarios.map(s => ({
        id: s.id,
        title: s.title,
        type: s.type,
        difficulty: s.difficulty?.label || '',
        prepTimeMin: s.prepTimeMin,
        presentTimeMin: s.presentTimeMin,
        qaTimeMin: s.qaTimeMin,
        audienceCount: s.audience?.length || 0,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, setId.slice(0, 31));
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=scenarios.xlsx');
    res.send(buf);
  } catch (err) {
    console.error('[GET /api/admin/scenarios/excel]', err.message);
    res.status(500).json({ error: '엑셀 내보내기에 실패했습니다.' });
  }
});

app.post('/api/admin/generate-scenario', adminAuth, evaluateLimiter, async (req, res) => {
  try {
    const { type, industry, targetLevel, difficulty } = req.body;
    if (!type) return res.status(400).json({ error: 'type은 필수입니다.' });

    if (!CLAUDE_API_KEY) {
      return res.status(500).json({ error: 'Claude API 키가 설정되지 않았습니다.' });
    }

    const claude = new Anthropic({ apiKey: CLAUDE_API_KEY });
    const resp = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: `당신은 DC 프레젠테이션 시나리오 설계 전문가입니다. 주어진 조건에 맞는 프레젠테이션 시나리오를 JSON으로 생성하세요. 시나리오 구조: { id, title, type, difficulty, prepTimeMin, presentTimeMin, qaTimeMin, background: { companyName, industry, situation, learnerRole: { title, mission } }, materials: { ... }, audience: [ { id, name, role, focus, personality } ], evaluationCriteria: [...] }. 한국어로 작성하세요.`,
      messages: [{
        role: 'user',
        content: `프레젠테이션 유���: ${type}\n산업: ${industry || '일반'}\n대상 직급: ${targetLevel || '부장급'}\n난이도: ${difficulty || 3}/5\n\n상세한 분석 자료(materials)와 AI 청중(audience) 3~4명을 포함해주세요.`
      }],
    });

    const text = resp.content[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const scenario = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (!scenario) {
      return res.status(500).json({ error: '시나리오 생성 결과를 파싱할 수 없습니다.' });
    }

    res.json({ success: true, scenario });
  } catch (err) {
    console.error('[POST /api/admin/generate-scenario]', err.message);
    res.status(500).json({ error: '시나리오 생성에 실패했습니다.' });
  }
});

// ════════════════════════════════════════════
// 404 핸들러
// ════════════════════════════════════════════

app.use('/api/*', (req, res) => {
  res.status(404).json({ error: '존재하지 않는 API 엔드포인트입니다.' });
});

// ════════════════════════════════════════════
// 서버 시작
// ════════════════════════════════════════════

async function initServer() {
  await initDB();

  // 시나리오 로드
  const scenariosDir = join(__dirname, 'scenarios');
  if (existsSync(scenariosDir)) {
    const { readdirSync } = await import('fs');
    const dirs = readdirSync(scenariosDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const setId of dirs) {
      const jsonPath = join(scenariosDir, setId, 'scenarios.json');
      if (!existsSync(jsonPath)) continue;
      try {
        const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        const scenarios = Array.isArray(data) ? data : data.scenarios || [data];
        scenarioSets[setId] = { id: setId, scenarios };

        const promptDir = join(scenariosDir, setId, 'prompts');
        if (existsSync(join(promptDir, 'dialogue-prompt.txt'))) {
          scenarioSets[setId].dialoguePrompt = readFileSync(join(promptDir, 'dialogue-prompt.txt'), 'utf-8');
        }
        if (existsSync(join(promptDir, 'evaluation-prompt.txt'))) {
          scenarioSets[setId].evaluationPrompt = readFileSync(join(promptDir, 'evaluation-prompt.txt'), 'utf-8');
        }
        console.log(`[INIT] 시나리오 세트 로드: ${setId} (${scenarios.length}개)`);
      } catch (e) {
        console.error(`[INIT] 시나리오 로드 실패: ${setId}`, e.message);
      }
    }
  }

  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log('  AI 프레젠테이션 시뮬레이션');
    console.log(`  서버: http://localhost:${PORT}`);
    console.log(`  환경: ${NODE_ENV}`);
    console.log(`  Claude: ${CLAUDE_API_KEY ? '설정됨' : '미설정'}`);
    console.log(`  시나리오: ${Object.values(scenarioSets).reduce((sum, s) => sum + s.scenarios.length, 0)}개 로드됨`);
    console.log(`${'='.repeat(50)}\n`);
  });
}

process.on('SIGINT', () => { saveDB(); process.exit(0); });
process.on('SIGTERM', () => { saveDB(); process.exit(0); });

initServer().catch(err => {
  console.error('[INIT] 서버 시작 실패:', err.message);
  process.exit(1);
});
