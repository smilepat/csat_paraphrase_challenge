-- ============================================================
-- 유형별 판정 캐시
-- 적용: npm run db:schema   (멱등)
--
-- 왜 필요한가 (실측): 의미 판정은 temperature 0 인데도 **실행마다 흔들린다.**
-- 같은 14건 캘리브레이션 세트에서 92.9% / 85.7% / 85.7% 가 나왔고 흔들리는
-- 항목이 매번 달랐다. 캐시가 없으면 **같은 답안에 다른 점수**가 나오고,
-- 자습에서 그건 학생이 앱을 못 믿게 되는 종류의 결함이다.
-- 비용 절감은 부수 효과이고, 일관성이 본래 목적이다.
--
-- pc_score_cache 와 나눈 이유: 그쪽은 지문 단위(passage_id NOT NULL)라
-- 태스크 단위 판정을 넣으면 의미가 어긋난다.
-- ============================================================

CREATE TABLE IF NOT EXISTS pc_task_verdict_cache (
  key        TEXT PRIMARY KEY,   -- sha256(taskId, kind, 프롬프트 지문, 정규화 답안)
  task_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,      -- type1 | type2
  -- 프롬프트 지문을 **열로도** 남긴다. 키는 해시라 되돌릴 수 없어서, 이 열이 없으면
  -- 프롬프트를 고친 뒤 옛 항목을 골라 지울 방법이 없다.
  fingerprint TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL,      -- JSON: 판정 결과
  hits       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pc_verdict_cache_task ON pc_task_verdict_cache (task_id, kind);
CREATE INDEX IF NOT EXISTS idx_pc_verdict_cache_fp ON pc_task_verdict_cache (kind, fingerprint);
