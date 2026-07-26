# 100-Word Paraphrase Challenge

수능 기출 지문을 **가장 짧고 쉬운 영어**로 바꾸는 교실 활동 앱.
학생은 자기 기기로 제출하고, 교사 화면에서 실시간으로 진행·채점·비교합니다.

> ⚠️ **비공개 전제** — CSAT 기출 원문을 담고 있습니다.
> `noindex` 헤더가 걸려 있고, `/admin/*` 과 `/host/*` 는 `TEACHER_PASSWORD` 로 막힙니다
> (운영에서 미설정 시 503). 배포 전 [docs/DEPLOY.md](docs/DEPLOY.md) 를 먼저 읽으세요.

재개·인수인계는 [HANDOFF.md](HANDOFF.md) 를 먼저 보세요.

## 빠르게 돌려보기

```bash
npm install
cp .env.example .env.local      # GEMINI_API_KEY 입력
npm run db:schema               # 스키마 (미설정 시 file:./local.db)
npm run db:import               # CSAT 지문 적재 (565 → 필터 → 118)
npm run db:enrich               # 핵심 명제·모범 답안 생성 (Gemini)
npm run dev
```

1. `/admin/passages` 에서 명제·모범 답안을 확인하고 **승인**
   (자동 점검이 지적 없는 지문을 골라 주므로 일괄 승인도 가능. 118개 중 115개가 무지적)
2. `/host` 에서 지문·목표 단어 수를 고르고 방 생성 → 6자리 코드
3. 학생은 `/join` 에서 코드 입력
4. 교사 화면에서 라운드 시작 → 마감하고 채점 → 결과 공개

교과서·부교재 지문은 `/admin/passages/new` 에서 직접 넣을 수 있습니다 —
붙여넣으면 핵심 명제·모범 답안을 만들어 주고, 같은 검수 경로를 거칩니다.

기기를 못 쓰는 교실용으로 원래의 단일 HTML 판이 `/standalone.html` 에 남아 있습니다.

## 채점

총점 100 = **의미 보존 50 + 간결 25 + 쉬움 25** (+ 초간결 보너스는 팀 점수에 별도 가산)

| 축 | 근거 |
|---|---|
| 의미 보존 | 지문별 **핵심 명제 3~5개**를 학생 답안이 담았는지. LLM 이 명제마다 agree/disagree/absent 를 판정하고, 임베딩은 LLM 이 꺼졌을 때의 폴백 |
| 간결 | 목표 초과 1단어당 −2점 |
| 쉬움 | 수능 코퍼스 **빈도 순위 6,266 표제어** 기준 (내용어 중 2000위 이내 비율 + 빈도표 밖 비율 + 평균 문장 길이) |

**가드** — 원문 12단어 연속 복사, 모범 답안 베끼기, 옆 사람 답안 베끼기, 원문과 반대로 진술.
걸리면 점수를 확정하지 않고 교사 확인 대기로 넘깁니다. 베낌 판정은 임베딩이 아니라
표면(단어·순서) 비교로 합니다 — 같은 뜻을 자기 말로 바꿔 쓴 답안을 부정행위로 몰면 안 되니까요.

측정 결과와 설계 근거는 [docs/CALIBRATION.md](docs/CALIBRATION.md) 에 있습니다.
요약: 의미 ρ0.978 · 쉬움 ρ0.932 · 간결 ρ0.924 · 모순 탐지 9/9 · 복붙 6/6, 오탐 0/84.

## 검증

```bash
npm test          # 채점·검수 순수 함수 단위 테스트 37개
npm run test:e2e  # 수업 전 구간 (외부 API 없이, 가짜 임베딩)
npm run calibrate # 채점 품질 회귀 (실제 API 사용)
npm run typecheck
npx vite-node scripts/audit-passages.mjs  # 검수 자동 점검 요약
```

## 비용 관리

- 제출 즉시에는 임베딩만 부른다. LLM 판정은 **라운드 종료 시 10명씩 배치**로 1~2콜
- 같은 (지문, 답안) 조합은 `pc_score_cache` 에서 재사용 — 다시 과금되지 않음
- `PARAPHRASE_LLM=off` 로 판정을 완전히 끌 수 있음 (임베딩+규칙만으로 계속 동작)
- `GEMINI_DAILY_LIMIT` 로 일일 상한. 교사 화면에 오늘 사용량 표시

## 구조

```
app/actions/     서버 액션 (host / play / admin / teacher-view)
lib/scoring/     채점 — 순수 함수 + service.ts(I/O) + verdict.ts(LLM)
lib/            codes(ULID·조인코드) / db(Turso) / gemini / identity / rooms
scripts/        스키마·적재·보강·캘리브레이션
e2e/            Playwright
```

`lib/codes.ts`, `lib/db.ts`, `lib/gemini.ts`, `lib/identity.ts` 는
`Korea_English_Solution` 에서 이식했습니다(각 파일 헤더에 원본 경로 명시).
독립 앱이라 복사본이므로 원본 개선이 자동 반영되지는 않습니다.
