-- ============================================================
-- M10 — 학습자 · 세션 · 시도 (자습 모드의 척추)
-- 적용: npm run db:schema   (멱등)
--
-- 교실 모드(pc_rooms/pc_players/pc_submissions)와 **섞지 않는다.**
-- 교실은 1회성 라운드라 방이 단위지만, 자습은 누적이 전부라 학습자가 단위다.
-- 같은 테이블에 밀어 넣으면 room_id 가 NULL 인 행이 늘고 두 흐름의 질의가 엉킨다.
--
-- 자습에는 순위가 없다. 그래서 총점 칼럼을 두지 않고 **시도마다 유형을 남긴다** —
-- 리포트는 처음부터 끝까지 축별이며, 총점으로 뭉뚱그릴 유혹 자체를 스키마에서 없앤다.
-- ============================================================

-- 1. 학습자 --------------------------------------------------
-- 자습이지만 학생이 스스로 가입하지 않는다. 수능 원문이 걸려 있어
-- 교사가 발급한 초대 코드로만 들어온다.
CREATE TABLE IF NOT EXISTS pc_learners (
  id           TEXT PRIMARY KEY,              -- ULID
  invite_code  TEXT NOT NULL,
  nickname     TEXT NOT NULL,
  device_token TEXT,                          -- 브라우저 재접속 식별
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pc_learners_code ON pc_learners (invite_code);

-- 2. 세션 ----------------------------------------------------
-- 하루 5~10분이 기본 단위다. 세션이 끊겨도 시도는 남는다.
CREATE TABLE IF NOT EXISTS pc_sessions (
  id         TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES pc_learners(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pc_sessions_learner ON pc_sessions (learner_id, started_at);

-- 3. 시도 (append-only) --------------------------------------
-- 고쳐 쓰지 않는다. 같은 태스크를 다시 만나는 것이 자습의 정상 동작이고
-- (간격 반복), 두 번째 시도가 첫 번째를 지우면 성장 곡선이 사라진다.
CREATE TABLE IF NOT EXISTS pc_attempts (
  id         TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES pc_learners(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES pc_sessions(id) ON DELETE SET NULL,
  task_id    TEXT NOT NULL REFERENCES pc_tasks(id),
  type       INTEGER NOT NULL CHECK (type IN (1, 2, 3)),
  answer     TEXT NOT NULL,
  score      REAL,                            -- 0~100. NULL = 채점 전
  -- 오답 5종의 이름을 그대로 담는다. 교사가 없으니 이 문자열이 유일한 지도이고,
  -- M12 의 적응형 출제가 이 분포를 보고 다음 문항을 고른다.
  error_name TEXT,
  judged     INTEGER NOT NULL DEFAULT 0,      -- 유료 판정을 실제로 썼는가
  flags      TEXT,                            -- JSON 배열
  day        TEXT NOT NULL,                   -- YYYY-MM-DD. 일별 집계용(로컬 날짜)
  elapsed_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pc_attempts_axis ON pc_attempts (learner_id, type, day);
CREATE INDEX IF NOT EXISTS idx_pc_attempts_task ON pc_attempts (learner_id, task_id, created_at);
