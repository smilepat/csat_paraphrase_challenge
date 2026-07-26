-- ============================================================
-- 100-Word Paraphrase Challenge — 스키마 (pc_ 접두)
-- 적용: npm run db:schema   (멱등 — 여러 번 실행해도 안전)
-- ============================================================

-- 1. 지문 ------------------------------------------------------
-- CSAT 기출은 저작권상 비공개 전제. source='csat' 행은 공개 배포 금지.
CREATE TABLE IF NOT EXISTS pc_passages (
  id               TEXT PRIMARY KEY,          -- CSAT_EVEN_2025_18 또는 ULID(custom)
  source           TEXT NOT NULL,             -- csat | custom
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  word_count       INTEGER NOT NULL,
  topic            TEXT,
  question_type    TEXT,                      -- 빈칸 추론 | 요지 | ...
  difficulty_score REAL,                      -- 원천 데이터의 난도(16.6~41.7)
  year             INTEGER,
  -- 채점의 기준이 되는 데이터. M1 에서 생성 후 교사가 검수한다.
  propositions     TEXT,                      -- JSON: ["Fast guidance improves ...", ...]
  model_answers    TEXT,                      -- JSON: ["...", "..."]
  ref_embedding    TEXT,                      -- JSON: { propositions: number[][], models: number[][] }
  review_status    TEXT NOT NULL DEFAULT 'raw', -- raw | draft | approved | rejected
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pc_passages_status ON pc_passages (review_status, question_type);

-- 2. 방 --------------------------------------------------------
CREATE TABLE IF NOT EXISTS pc_rooms (
  id              TEXT PRIMARY KEY,           -- ULID
  code            TEXT NOT NULL UNIQUE,       -- 6자리 (O/0/I/1/L 제외)
  host_token_hash TEXT NOT NULL,              -- sha256(host token). 평문 저장 안 함
  title           TEXT,
  passage_id      TEXT REFERENCES pc_passages(id),
  target_words    INTEGER NOT NULL DEFAULT 25,
  mode            TEXT NOT NULL DEFAULT 'individual', -- individual | team
  state           TEXT NOT NULL DEFAULT 'lobby',      -- lobby | writing | scoring | review | closed
  round_no        INTEGER NOT NULL DEFAULT 1,
  writing_ends_at TEXT,                       -- 타이머 종료 시각(UTC ISO). NULL = 무제한
  reveal_feedback INTEGER NOT NULL DEFAULT 0, -- 학생에게 AI 피드백 공개 여부
  settings        TEXT,                       -- JSON 여분
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pc_rooms_code ON pc_rooms (code);

-- 3. 참가자 ----------------------------------------------------
CREATE TABLE IF NOT EXISTS pc_players (
  id           TEXT PRIMARY KEY,              -- ULID
  room_id      TEXT NOT NULL REFERENCES pc_rooms(id) ON DELETE CASCADE,
  nickname     TEXT NOT NULL,
  team         TEXT,                          -- blue | red | NULL(개인전)
  device_token TEXT NOT NULL,                 -- 브라우저 재접속 식별
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_players_device ON pc_players (room_id, device_token);
CREATE INDEX IF NOT EXISTS idx_pc_players_room ON pc_players (room_id);

-- 4. 제출 (append-only) ----------------------------------------
CREATE TABLE IF NOT EXISTS pc_submissions (
  id           TEXT PRIMARY KEY,              -- ULID
  room_id      TEXT NOT NULL REFERENCES pc_rooms(id) ON DELETE CASCADE,
  player_id    TEXT NOT NULL REFERENCES pc_players(id) ON DELETE CASCADE,
  round_no     INTEGER NOT NULL,
  passage_id   TEXT REFERENCES pc_passages(id),
  text         TEXT NOT NULL,
  word_count   INTEGER NOT NULL,
  scores       TEXT,                          -- JSON: { meaning, brevity, ease, total, detail }
  verdict      TEXT,                          -- JSON: LLM 판정 결과
  flags        TEXT,                          -- JSON: ["verbatim","peer-copy",...]
  teacher_ok   INTEGER,                       -- NULL=미확인 1=인정 0=기각
  paste_count  INTEGER NOT NULL DEFAULT 0,
  edit_count   INTEGER NOT NULL DEFAULT 0,
  elapsed_ms   INTEGER,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  scored_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_sub_round ON pc_submissions (room_id, round_no, player_id);
CREATE INDEX IF NOT EXISTS idx_pc_sub_room ON pc_submissions (room_id, round_no);

-- 5. 채점 캐시 -------------------------------------------------
-- key = sha256(passage_id + '\n' + 정규화 답안). 같은 답안 재채점 과금을 막는다.
CREATE TABLE IF NOT EXISTS pc_score_cache (
  key        TEXT PRIMARY KEY,
  passage_id TEXT NOT NULL,
  payload    TEXT NOT NULL,                   -- JSON: { scores, verdict }
  hits       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. API 사용량 ------------------------------------------------
-- 서버리스 인스턴스 메모리는 리셋되므로 정확한 집계는 여기서 한다.
CREATE TABLE IF NOT EXISTS pc_api_usage (
  day    TEXT NOT NULL,                       -- YYYY-MM-DD
  kind   TEXT NOT NULL,                       -- embed | verdict | enrich
  calls  INTEGER NOT NULL DEFAULT 0,
  items  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
