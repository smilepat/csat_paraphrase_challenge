-- ============================================================
-- M8 — 유형별 태스크 (pc_tasks)
-- 적용: npm run db:schema   (멱등)
--
-- 왜 지문이 아니라 태스크인가:
--   기존 과제는 "지문 전체 → 100단어"  하나뿐이라 세 역량을 분리하지 못한다.
--   태스크는 지문의 **일부 구간**을 가리키고, 그 구간에 어떤 조작을 요구하는지를
--   유형으로 표시한다. 자습 모드는 지문 전문을 띄우지 않고 이 구간만 보여준다
--   (저작권 노출면을 줄이는 것이 부수 효과가 아니라 설계 이유다).
--
-- 좌표 규약:
--   *_start / *_end 는 pc_passages.body 에 대한 **0-기반 문자 오프셋**이며
--   end 는 배타적이다. 즉 body.slice(start, end) 가 그 구간이다.
--   SQLite substr() 은 1-기반이므로 검증 시 substr(body, start+1, end-start) 로 비교한다.
--   stimulus_text 는 그 사본이다 — 지문이 수정되면 오프셋이 어긋나므로
--   `npm run tasks:verify` 가 둘의 불일치를 잡아낸다.
-- ============================================================

CREATE TABLE IF NOT EXISTS pc_tasks (
  id             TEXT PRIMARY KEY,           -- {passage_id}#t{type}-{nn}
  passage_id     TEXT NOT NULL REFERENCES pc_passages(id) ON DELETE CASCADE,

  -- 1 = 같은 개념 다른 단어 | 2 = 문장↔이름(명사화) | 3 = 여러 개를 되받는 이름
  type           INTEGER NOT NULL CHECK (type IN (1, 2, 3)),
  -- type2: fold(문장→이름) | unfold(이름→문장)
  -- type3: span(되받는 범위 표시) | name(되받는 이름 쓰기)
  direction      TEXT,

  -- 학생에게 보여줄 최소 문맥. 유형 1·2 는 문장 하나, 유형 3 은 앞 문장들을 포함한다.
  context_start  INTEGER NOT NULL,
  context_end    INTEGER NOT NULL,

  -- 학생이 조작할 대상 구간
  stimulus_start INTEGER NOT NULL,
  stimulus_end   INTEGER NOT NULL,
  stimulus_text  TEXT NOT NULL,              -- 오프셋 무결성 검증용 사본

  -- 유형 2 의 목표 구조. 구조 검사(정형동사 유무)가 1차 채점이라 무료로 걸러진다.
  target_form    TEXT CHECK (target_form IN ('noun_phrase', 'clause') OR target_form IS NULL),

  -- 유형 3 의 정답 범위(되받는 표현이 가리키는 선행 구간)
  answer_start   INTEGER,
  answer_end     INTEGER,

  -- 유형 1 에서 재사용을 금지할 내용어. JSON 배열.
  avoid_words    TEXT,

  -- 사람이 만든 정답 예시. JSON: [{ "text": "...", "note": "..." }]
  gold           TEXT,

  origin         TEXT NOT NULL,              -- gold | regex | llm
  review_status  TEXT NOT NULL DEFAULT 'raw',-- raw | draft | approved | rejected
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pc_tasks_pick   ON pc_tasks (type, review_status, direction);
CREATE INDEX IF NOT EXISTS idx_pc_tasks_source ON pc_tasks (passage_id, type);
