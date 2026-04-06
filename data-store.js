/**
 * data-store.js — AI 프레젠테이션 시뮬레이션 데이터 레이어
 * SQLite (sql.js) WAL 모드, KST 타임스탬프
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, 'data');
const DB_PATH = join(DB_DIR, 'database.sqlite');

let db = null;

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
}

// ─── 초기화 ───

export async function initDB() {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

  const SQL = await initSqlJs();
  if (existsSync(DB_PATH)) {
    db = new SQL.Database(readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    scenario_set_id TEXT NOT NULL DEFAULT 'default',
    learner_id TEXT,
    learner_name TEXT NOT NULL,
    learner_org TEXT DEFAULT '',
    model TEXT DEFAULT 'claude',
    status TEXT DEFAULT 'briefing',
    presentation_text TEXT,
    audio_transcript TEXT,
    audio_duration_sec INTEGER DEFAULT 0,
    audio_path TEXT,
    prep_time_sec INTEGER DEFAULT 0,
    time_limit_sec INTEGER DEFAULT 2700,
    score REAL,
    grade TEXT,
    evaluation_json TEXT,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now', '+9 hours')),
    completed_at TEXT,
    updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS qa_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    speaker_name TEXT DEFAULT '',
    speaker_role TEXT DEFAULT '',
    content TEXT NOT NULL,
    turn_number INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', '+9 hours'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS data_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    data_type TEXT NOT NULL,
    accessed_at TEXT DEFAULT (datetime('now', '+9 hours'))
  )`);

  saveDB();
  console.log('[DB][INIT] 초기화 완료 (WAL 모드, 외래키 활성화)');

  // 자동 저장 (5분마다)
  setInterval(saveDB, 300000);
}

function saveDB() {
  if (!db) return;
  try {
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('[DB][SAVE] 저장 실패:', e.message);
  }
}

// ─── 세션 CRUD ───

export function createSession(params) {
  const {
    id, scenarioId, scenarioSetId, learnerId, learnerName,
    learnerOrg, model, timeLimitSec,
  } = params;

  const stmt = db.prepare(`INSERT INTO sessions
    (id, scenario_id, scenario_set_id, learner_id, learner_name, learner_org, model, time_limit_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run([id, scenarioId, scenarioSetId || 'default', learnerId, learnerName, learnerOrg || '', model || 'claude', timeLimitSec || 2700]);
  stmt.free();
  saveDB();
  return getSession(id);
}

export function getSession(id) {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  stmt.bind([id]);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

export function updateSession(id, fields) {
  const allowed = [
    'status', 'presentation_text', 'audio_transcript', 'audio_duration_sec',
    'audio_path', 'prep_time_sec', 'score', 'grade', 'evaluation_json',
    'total_input_tokens', 'total_output_tokens', 'total_tokens',
    'estimated_cost', 'completed_at',
  ];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    if (allowed.includes(col)) {
      sets.push(`${col} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now', '+9 hours')");
  vals.push(id);
  db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, vals);
  saveDB();
}

export function listSessions(limit = 50, offset = 0) {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?');
  stmt.bind([limit, offset]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─── Q&A 메시지 ───

export function addQAMessage(params) {
  const { sessionId, role, speakerName, speakerRole, content, turnNumber } = params;
  const stmt = db.prepare(`INSERT INTO qa_messages
    (session_id, role, speaker_name, speaker_role, content, turn_number)
    VALUES (?, ?, ?, ?, ?, ?)`);
  stmt.run([sessionId, role, speakerName || '', speakerRole || '', content, turnNumber || 0]);
  stmt.free();
  saveDB();
}

export function getQAMessages(sessionId) {
  const stmt = db.prepare('SELECT * FROM qa_messages WHERE session_id = ? ORDER BY turn_number, id');
  stmt.bind([sessionId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─── 데이터 접근 로그 ───

export function logDataAccess(sessionId, dataType) {
  db.run(`INSERT INTO data_access_log (session_id, data_type) VALUES (?, ?)`, [sessionId, dataType]);
  saveDB();
}

export function getDataAccessLog(sessionId) {
  const stmt = db.prepare('SELECT * FROM data_access_log WHERE session_id = ? ORDER BY accessed_at');
  stmt.bind([sessionId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─── 통계 ───

export function getStats() {
  const total = db.exec("SELECT COUNT(*) as c FROM sessions")[0]?.values[0][0] || 0;
  const completed = db.exec("SELECT COUNT(*) as c FROM sessions WHERE status = 'completed'")[0]?.values[0][0] || 0;
  const avgScore = db.exec("SELECT AVG(score) FROM sessions WHERE score IS NOT NULL")[0]?.values[0][0] || 0;
  return {
    total,
    completed,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    avgScore: avgScore ? Math.round(avgScore * 10) / 10 : 0,
  };
}

// ─── 내보내기 ───

export function exportAllData() {
  const sessions = listSessions(9999);
  return { sessions, exportedAt: kstNow() };
}

export { saveDB };
