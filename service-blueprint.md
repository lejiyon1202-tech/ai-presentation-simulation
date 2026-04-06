# AI 프레젠테이션 시뮬레이션 — 서비스 청사진

## 1. 서비스 개요

AI 기반 프레젠테이션 역량 평가 시뮬레이션. 학습자가 주어진 자료를 분석하여 발표문을 작성하고, 음성으로 발표한 뒤, AI 청중과 Q&A를 수행하면 6대 역량을 자동 평가합니다.

**포지셔닝**: AC 4대 핵심 과제(인바스켓/롤플레이/GD/프레젠테이션) 중 마지막 퍼즐. AC 플랫폼 통합 대상.

## 2. 학습자 흐름 (5단계)

```
[1] 인트로 → [2] 준비 → [3] 발표 → [4] AI Q&A → [5] 리포트
```

| 단계 | 페이지 | 시간 | 핵심 활동 |
|------|--------|------|----------|
| 1. 인트로 | index.html | - | 주제 선택, 학습자 정보 입력, 브리핑 확인 |
| 2. 준비 | prepare.html | 30~60분 | 자료 분석(데이터 탭), 발표문 텍스트 작성, 타이머 |
| 3. 발표 | presentation.html | 10~15분 | 음성 녹음(MediaRecorder), 실시간 STT(Web Speech API), 타이머 |
| 4. AI Q&A | presentation.html | 5~10분 | AI 청중 3~5명이 질문, 학습자 음성/텍스트 응답, 턴제 |
| 5. 리포트 | report.html | - | 6대 역량 점수, 레이더 차트, 발표 분석, Q&A 분석, 코칭 코멘트 |

## 3. 기술 스택

| 영역 | 기술 |
|------|------|
| 런타임 | Node.js + Express |
| DB | SQLite (sql.js), WAL 모드 |
| 프론트엔드 | 바닐라 HTML/CSS/JS |
| CSS | design-system.css + 3테마 |
| LLM | Claude API (Sonnet 4.6) |
| 음성 녹음 | MediaRecorder API (브라우저) |
| 음성→텍스트 | Web Speech API (브라우저 STT), Whisper API 폴백 |
| 보안 | helmet + express-rate-limit |
| 포트 | 3007 |

## 4. DB 스키마

### sessions
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | TEXT PK | UUID |
| scenario_id | TEXT | 시나리오 ID |
| scenario_set_id | TEXT | 시나리오 세트 ID |
| learner_id | TEXT | 학습자 ID |
| learner_name | TEXT | 학습자 이름 |
| learner_org | TEXT | 소속 |
| model | TEXT | LLM 모델 |
| status | TEXT | briefing/preparing/presenting/qa/evaluating/completed |
| presentation_text | TEXT | 제출된 발표문 텍스트 |
| audio_transcript | TEXT | 음성 STT 변환 텍스트 |
| audio_duration_sec | INTEGER | 녹음 시간(초) |
| prep_time_sec | INTEGER | 실제 준비 시간(초) |
| time_limit_sec | INTEGER | 준비 제한 시간 |
| score | REAL | 종합 점수 (5점 만점) |
| grade | TEXT | 등급 |
| evaluation_json | TEXT | 평가 결과 JSON |
| total_input_tokens | INTEGER | |
| total_output_tokens | INTEGER | |
| total_tokens | INTEGER | |
| estimated_cost | REAL | |
| started_at | TEXT | |
| completed_at | TEXT | |

### qa_messages
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| session_id | TEXT FK | |
| role | TEXT | user / ai |
| speaker_name | TEXT | AI 청중 이름 (예: "김상무") |
| speaker_role | TEXT | AI 청중 역할 (예: "재무담당 상무") |
| content | TEXT | 메시지 내용 |
| turn_number | INTEGER | 턴 번호 |
| created_at | TEXT | |

### data_access_log
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INTEGER PK | |
| session_id | TEXT FK | |
| data_type | TEXT | financial/market/organization 등 |
| accessed_at | TEXT | |

## 5. API 목록

### 학습자 API (12개)
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/health | 헬스체크 |
| GET | /api/scenarios | 시나리오 목록 |
| GET | /api/scenarios/:setId/:id | 시나리오 상세 |
| POST | /api/sessions | 세션 생성 |
| GET | /api/sessions/:id | 세션 상세 |
| GET | /api/sessions/:id/materials | 준비 자료 조회 (데이터 탭) |
| POST | /api/sessions/:id/presentation | 발표문 제출 (텍스트 + 음성 메타데이터) |
| POST | /api/sessions/:id/audio | 음성 파일 업로드 (webm/wav) |
| POST | /api/sessions/:id/qa | Q&A 메시지 전송 → AI 청중 응답 |
| POST | /api/sessions/:id/evaluate | 평가 요청 |
| GET | /api/sessions/:id/report | 평가 리포트 조회 |
| GET | /api/sessions/:id/report/pdf | PDF 다운로드 |

### 관리자 API (8개)
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/admin/sessions | 세션 목록 |
| GET | /api/admin/sessions/:id | 세션 상세 |
| GET | /api/admin/stats | 통계 |
| GET | /api/admin/export | 데이터 내보내기 |
| GET | /api/admin/scenarios | 시나리오 관리 |
| GET | /api/admin/scenarios/excel | 시나리오 Excel 다운로드 |
| POST | /api/admin/scenarios/excel | 시나리오 Excel 업로드 |
| POST | /api/admin/generate-scenario | AI 시나리오 자동생성 |

## 6. 프롬프트 구조

### dialogue-prompt.txt (AI 청중 Q&A)
- AI 청중 3~5명 (역할: CEO, CFO, CMO, CTO, HR임원 등 시나리오별 다름)
- 각 청중은 자기 관점에서 질문 (재무→ROI, 마케팅→시장, 기술→실현가능성)
- **괄호 지문 절대 금지** — "(고개를 끄덕이며)" 등 불가
- 후속 질문: 학습자 답변의 약점을 파고드는 날카로운 질문
- 총 Q&A 5~8턴 (AI 질문 → 학습자 응답 반복)

### evaluation-prompt.txt (평가)
- 평가 대상: 발표문 텍스트 + 음성 STT + Q&A 대화 내역
- 5대 채점 영역:
  1. 내용 구성 (30%) — 핵심 메시지, 데이터 활용, 근거 제시
  2. 논리 전개 (25%) — 구조화, MECE, 인과관계
  3. 전달력 (20%) — 명확성, 간결성, 청중 맞춤 (음성: 말 속도, 쉼, 필러워드)
  4. Q&A 대응 (15%) — 질문 이해, 구조화된 답변, 압박 대응
  5. 시간 관리 (10%) — 준비시간 활용, 발표시간 준수
- JSON 출력 스키마: dimensions[], overallScore, grade, strengths[], developmentAreas[], executiveSummary

## 7. 시나리오 구조 (scenarios.json)

```json
{
  "id": "scenario-01",
  "title": "신사업 투자 제안 발표",
  "type": "strategic",
  "difficulty": { "stars": 3, "label": "중급" },
  "estimatedMinutes": 60,
  "background": {
    "companyName": "한국테크(주)",
    "industry": "IT/소프트웨어",
    "situation": "...",
    "learnerRole": { "title": "전략기획팀 부장", "mission": "..." }
  },
  "materials": {
    "financial": { "title": "재무 데이터", "content": "..." },
    "market": { "title": "시장 분석", "content": "..." },
    "competitor": { "title": "경쟁사 현황", "content": "..." }
  },
  "audience": [
    { "id": "ceo", "name": "이대표", "role": "대표이사", "focus": "비전/전략" },
    { "id": "cfo", "name": "김재무", "role": "CFO", "focus": "ROI/리스크" },
    { "id": "cto", "name": "박기술", "role": "CTO", "focus": "기술 실현가능성" }
  ],
  "prepTimeMin": 45,
  "presentTimeMin": 10,
  "qaTimeMin": 8
}
```

## 8. 음성 처리 흐름

```
[브라우저] MediaRecorder → WebM/WAV 녹음
    ↓
[브라우저] Web Speech API → 실시간 STT (한국어)
    ↓
[서버] POST /api/sessions/:id/audio → 음성 파일 저장
[서버] POST /api/sessions/:id/presentation → 발표문(텍스트) + STT 결과 + 음성 메타데이터(duration, wordCount)
    ↓
[평가 시] 발표문 텍스트 + STT 텍스트 + 음성 메타데이터 → LLM 평가
```

**음성 분석 지표:**
- 말 속도 (WPM) — STT 단어 수 / 발표 시간
- 발표 시간 준수율 — 실제 시간 / 제한 시간
- 필러워드 감지 — STT에서 "음...", "그...", "어..." 등 카운트

## 9. 페이지 구조

```
ai-presentation-simulation/
├── .env, .env.example, .gitignore
├── package.json, server.js, data-store.js
├── data/ (런타임: database.sqlite, audio/)
├── public/
│   ├── index.html, prepare.html, presentation.html, report.html, admin.html
│   ├── js/ (index.js, prepare.js, presentation.js, report.js, admin.js, theme.js)
│   └── css/ (design-system.css, index.css, prepare.css, presentation.css, report.css, admin.css)
├── scenarios/
│   └── default/
│       ├── scenarios.json
│       └── prompts/ (dialogue-prompt.txt, evaluation-prompt.txt)
└── uploads/ (음성 파일)
```

## 10. AC 플랫폼 통합

- 포트 3007로 독립 실행
- AC 플랫폼에 `presentation` 솔루션으로 등록
- iframe 임베딩 지원
- 완료 콜백 API 지원 (/api/callback)
- postMessage 지원 (맥락적 전환용)

## 11. 보안

- helmet CSP + CORS
- Rate Limiting: 전역 60/min, Q&A 채팅 10/min, 평가 5/min
- 관리자 API: Basic Auth (ADMIN_PASSWORD)
- 음성 파일: 10MB 제한, webm/wav만 허용
- API 키: .env 서버 사이드만
- 에러 메시지: str(e) 클라이언트 미노출
- 프롬프트 인젝션: 사용자 입력 새니타이징
