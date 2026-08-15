# HANDOFF — 100-Word Paraphrase Challenge

**최종 갱신** 2026-07-27 · **레포** `smilepat/csat_paraphrase_challenge` (private)
현재 커밋은 `git log --oneline -1` 로 확인하세요 — 이 문서에 해시를 박으면
문서를 고치는 순간 어긋납니다.

수능 기출 지문을 가장 짧고 쉬운 영어로 바꾸는 교실 활동 앱.
단일 HTML 게임을 Next.js 16 앱으로 전환했고, 학생은 자기 기기로 제출하고 교사는
실시간 화면으로 진행·채점·비교합니다.

---

## 1. 지금 상태

| 영역 | 상태 |
|---|---|
| 수업 전 구간 (검수→방→조인→제출→채점→리포트) | **완료**, E2E 7개 green |
| 플래그 제출 처리 | 교사 판단 전까지 순위·팀점수·평균에서 제외 |
| 채점 엔진 | **완료**, 축별 캘리브레이션 전체 PASS |
| 지문 | 로컬·원격 Turso 모두 **119개**(명제 보유 119). **승인 0개** — 사람이 눌러야 함 |
| Vercel 배포 | **프로덕션 가동** https://csat-paraphrase-challenge.vercel.app · 실 라운드 통과 |
| 운영 투입 | **가능** — 지문 승인만 남음 |

로컬에서는 전부 동작합니다. 막힌 건 배포 환경의 DB와 학생 접근 경로뿐입니다.

---

## 2. 바로 재개하기

### 이 PC (`C:\tmp\csat_paraphrase_challenge`)

```bash
npm run dev            # local.db 에 지문 118개 + 보강 결과가 이미 들어 있음
```

`/admin/passages` → 무지적 115개 일괄 승인 → `/host` 에서 방 생성 → 다른 창에서 `/join`.

### 다른 PC

```bash
git clone https://github.com/smilepat/csat_paraphrase_challenge && cd csat_paraphrase_challenge
npm install
cp .env.example .env.local        # GEMINI_API_KEY 입력
npm run db:schema                 # file:./local.db
npm run db:import                 # CSAT 565 → 필터 → 118  (원천 경로는 아래 참고)
npm run db:enrich                 # 명제·모범답안 생성. Gemini 약 24콜, 3~4분
npm run dev
```

`db:import` 의 원천은 `C:/tmp/csat-reasoning-bridge-builder/public/passages.json` 입니다.
다른 PC에서는 그 레포를 먼저 클론하거나 경로를 인자로 넘기세요:
`node scripts/import-passages.mjs <passages.json 경로>`

`data/freq-rank.json`(어휘 빈도 6,266)은 레포에 커밋돼 있어 다시 만들 필요가 없습니다.
다시 만들려면 `npm run db:freq` (원천 `C:/tmp/vocab-context/designed_min_clean.csv`).

---

## 3. 남은 일

### ① ~~Turso DB~~ — 해소됨 (2026-07-27)

`csat-paraphrase` DB 생성·스키마 적용·지문 119개 이관 완료(`npm run db:migrate`).
Vercel env 에 `TURSO_*` 등록 후 재배포했고, **프로덕션 실 라운드가 통과**했다
(`SMOKE_ANSWER="..." node scripts/prod-smoke.mjs`).

실측 비용: 1명 라운드에 `embed 2콜 / verdict 1콜`. 설계값과 일치.

### ② ~~Vercel SSO~~ — 해소됨 (2026-07-27)

`ssoProtection` 을 `preview` 전용으로 바꿨습니다(Vercel API PATCH). 프로덕션
`.vercel.app` 은 열려 있어 학생이 코드로 입장할 수 있습니다.

**그래서 프로덕션에서 지문을 지키는 것은 `TEACHER_PASSWORD` 하나뿐입니다.**
`/admin/*`·`/host/*` 만 막히고 학생 경로는 열려 있습니다. 비밀번호를 지우거나
`proxy.ts` 를 건드리면 CSAT 원문이 그대로 공개됩니다.

---

## 4. 자격 증명

| 항목 | 위치 |
|---|---|
| `GEMINI_API_KEY` | 로컬 `.env.local` (gitignore), Vercel env(prod+preview) |
| `TEACHER_PASSWORD` | 로컬 `.env.local`(git 제외) + Vercel env. 보려면 `grep TEACHER_PASSWORD .env.local` |
| Vercel 프로젝트 | 팀 `prompt-improvement-dm-pat` / `csat-paraphrase-challenge` |
| Turso | 미생성 (블로커 ①) |

비밀번호를 바꾸려면 Vercel env 의 `TEACHER_PASSWORD` 를 교체하고 **재배포**해야 합니다
(env 만 바꾸면 기존 배포에는 반영되지 않습니다). 교체 후 옛 비번이 401 이 되는지 확인하세요.

⚠ 초기 비밀번호를 대화와 `scripts/prod-smoke.mjs` 기본값에 노출한 적이 있어
2026-07-27 에 교체했습니다. 옛 값은 무효지만 git 히스토리에는 남아 있습니다.
스크립트는 이제 `.env.local` 에서 읽고, 레포에 비밀번호를 두지 않습니다.
운영에서 이 값을 비우면 `/admin`·`/host` 가 **503** 으로 막힙니다(고의적 안전 기본값 —
설정을 깜빡해 CSAT 원문이 열리는 것보다 낫다고 판단).

---

## 5. 설계에서 반드시 알아야 할 것

전부 **측정으로 뒤집힌** 것들입니다. 근거와 수치는 [docs/CALIBRATION.md](docs/CALIBRATION.md).
채점을 건드리기 전에 그 문서를 먼저 읽으세요.

1. **임베딩은 명제 커버리지를 못 잽니다.** 한 지문의 명제들은 주제가 같아서, 4개 중
   1개만 담은 답안도 나머지와 0.78+ 유사도가 나옵니다(커버리지 1.00 vs 0.25 가
   50.0 vs 47.6점). 임계값 문제가 아니라 원리 문제입니다(격자 탐색 최대 ρ 0.728).
   → **LLM 의 명제별 agree/disagree/absent 판정이 1차**, 임베딩은 폴백.
2. **`text-embedding-004` 는 퇴역(404)**. `gemini-embedding-001` 은 의미 역전을
   구별하지 못합니다(0.804 vs 0.812). **`gemini-embedding-2` / 768차원**을 씁니다.
3. **"모순 인덱스를 나열하라"** 프롬프트는 탐지율 67%. **명제별 입장을 강제**하니 100%.
4. **모순은 누락보다 무겁게** 쳐야 합니다. 0점 처리만 하면 둘이 동점이 됩니다(42.5 vs 42.5).
   모순 명제는 −1 로 계산합니다.
5. **베낌 판정에 임베딩을 쓰면 안 됩니다.** 같은 뜻을 자기 말로 바꿔 쓴 정직한 답안을
   부정행위로 몰게 됩니다 — 이 게임이 장려하려는 바로 그 행동을. 표면 비교
   (최장 공통 연속 단어 + 내용어 자카드)로 합니다. 오탐 0/84 실측.

6. **플래그가 붙은 제출은 교사 판단 전까지 어디에도 반영하지 않습니다**
   (`lib/rooms.ts` 의 `reviewState`). 복붙의 원점수는 69.3 으로 여전히 높게 나옵니다 —
   임베딩·규칙만 보면 실제로 "핵심을 다 담은 짧은 글"이기 때문입니다. 그래서 예전에는
   순위 2위에 올랐습니다. 자동 0점 처리는 하지 않습니다(정당한 인용을 기계가 가려낼 수
   없음). `counted`/`pending`/`rejected` 세 상태로 순위·팀점수·평균·학생 화면을 한꺼번에
   통제합니다. **이 규칙을 지우면 베낀 답안이 다시 1위에 오릅니다.**

**측정 방법론 교훈**: 총점 하나로 뭉뚱그려 재면 측정 도구의 결함이 채점기 성능처럼
보입니다(v1 에서 실제로 그럴 뻔했습니다 — ρ 0.709 가 나왔는데 진단해 보니 정답
순서가 애초에 신호에 없었습니다). 축을 하나씩만 움직인 데이터로 재고, 심판 LLM 의
라벨로 그 심판을 평가하는 순환을 피하세요.

---

## 6. 파일 지도

```
app/actions/       host(방·전이·권한) / play(조인·제출·라운드채점) /
                   admin(검수·일괄승인) / custom-passage(교사 입력) / teacher-view(폴링)
app/host, app/r, app/join, app/admin, app/reports   화면
lib/scoring/       text·brevity·ease·guards·meaning·audit = 순수 함수 (테스트 대상)
                   index.ts 조립 / service.ts 는 I/O / verdict.ts 는 LLM 판정
lib/               codes(ULID·6자리) db(Turso) gemini identity
                   rooms — 방 상태 전이 + reviewState(플래그 제출 반영 규칙)
proxy.ts           교사 경로 Basic 인증 (Next 16 규약. 구 middleware)
scripts/           schema·import·enrich·freq·calibrate·audit·live-check
e2e/               Playwright 7개
docs/              CALIBRATION.md(채점 근거) DEPLOY.md(배포)
HANDOFF.md         이 문서(정본) · STATUS.md 는 repo-ops 자동화가 읽는 요약
public/standalone.html   원래 단일 HTML — 기기 없는 교실용 폴백
```

`lib/codes.ts`, `lib/db.ts`, `lib/gemini.ts`, `lib/identity.ts` 는
`Korea_English_Solution` 에서 **복사**한 것입니다(각 파일 헤더에 원본 경로).
원본이 개선돼도 자동 반영되지 않습니다.

> 파생 발견: KES 의 `lib/gemini.ts` `generateEmbedding` 도 퇴역한
> `text-embedding-004` 를 써서 **현재 404 로 깨져 있습니다**. 그 레포는 건드리지
> 않았습니다.

---

## 7. 밟았던 함정 (반복 방지)

- **`vercel env add` 가 프롬프트 안내만 반복** — `--value --yes` 를 줘도. REST API 우회.
- **`vercel logs` 는 스트리밍** — 타임아웃으로 죽으면 출력이 빕니다. 배포 원인 확인은
  로컬 프로덕션 모드 재현이 빠릅니다.
- **Playwright `request` 컨텍스트가 config 의 `httpCredentials` 를 물려받습니다** —
  인증 차단 테스트가 200 으로 통과해 버립니다. 순수 `fetch` 로 확인하세요.
- **`next start` 가 `.env.local` 을 자동으로 읽습니다** — E2E 가 실수로 실제 API 를
  때립니다. `playwright.config.ts` 에서 `GEMINI_API_KEY: ""` 로 덮어썼습니다.
- **E2E DB 는 매 실행 리셋해야 합니다**(`e2e/global-setup.ts`). 이전 실행의 승인분이
  남아 "승인한 지문"과 "방이 고른 지문"이 어긋난 적이 있습니다.
- **vite-node 는 `vitest.config.ts` 를 읽지 않습니다** — `@/` 별칭 때문에
  `vite.config.ts` 한 곳으로 합쳤습니다.
- **Node 의 `/tmp/x` 는 Windows 에서 `C:\tmp\x`**, Git Bash 의 `/tmp` 와 다른 곳입니다.
- **Next 16 은 `middleware` 규약을 deprecated** 처리했습니다 → `proxy.ts`.
- **`vercel env add` 가 값을 빈 문자열로 저장합니다.** 성공을 반환하는데도 그렇습니다.
  실제로 `GEMINI_API_KEY`·`PARAPHRASE_LLM` 이 프로덕션에 0자로 들어가 배포본에서
  Gemini 호출이 전부 실패했습니다. **REST API(`POST /v10/projects/{id}/env?upsert=true`)로
  넣고, `vercel env pull` 로 길이를 확인하세요.**
- **`.env.local` 의 따옴표가 그대로 넘어갑니다.** `KEY="AIza..."` 를 그대로 밀면
  값에 `"` 가 포함돼 401/400 이 납니다. `loadEnv()` 는 벗기지만 REST 로 밀 때는 직접 벗겨야 합니다.
- **로컬에서 안 잡히는 결함이 있습니다.** 학생 화면이 첫 렌더에서 localStorage·Date.now()
  를 읽어 프로덕션에서만 React #418(하이드레이션 실패)이 났습니다.
  배포 후에는 `scripts/prod-smoke.mjs` 를 한 번 돌리세요.
- **원격 main 에 자동화가 직접 push 합니다** — `project-dashboard` 액션이 `STATUS.md` 를
  넣습니다. push 가 거부되면 남의 작업이 아니라 이것일 가능성이 큽니다.
  `git pull --rebase origin main` 후 다시 push 하세요.
- **`vercel link` 가 비대화형에서 개인 계정을 스코프로 못 씁니다** — 팀
  `prompt-improvement-dm-pat` 을 `--scope` 로 명시해야 합니다(기존 100개 프로젝트가
  전부 이 팀에 있고 멤버는 1명입니다).

---

## 8. 검증

```bash
npm test          # 순수 함수 단위 44개
npm run test:e2e  # 수업 전 구간 7개 (외부 API 없이 — 가짜 임베딩)
npm run typecheck
npm run calibrate # 채점 품질 회귀 (실제 API. 채점 로직·임베딩 모델 건드렸을 때만)
npx vite-node scripts/audit-passages.mjs   # 지문 검수 자동 점검 요약
npx vite-node scripts/live-check.mjs       # 실제 API 로 한 라운드 채점 + 호출 수
SMOKE_ANSWER="..." node scripts/prod-smoke.mjs   # 배포본에서 실 라운드 1회 (지문에 맞는 답안 필수)
```

CI(`.github/workflows/ci.yml`)는 typecheck + 단위 + build + E2E 를 돌립니다.
캘리브레이션은 실제 API 라 `workflow_dispatch` 수동 실행입니다
(`GEMINI_API_KEY` 시크릿 등록 완료).

**현재 수치**: 의미 ρ0.978 · 쉬움 ρ0.932 · 간결 ρ0.924 · 모순 9/9 ·
복붙 6/6 오탐 0/84 · 지문 자동점검 무지적 115/118. 단위 44 · E2E 7.

---

## 9. 비용

- 30명 라운드 1회 ≈ **5콜** (임베딩 1~2 + 판정 3). 같은 답안 재채점은 **0콜**(캐시).
- 제출 즉시에는 임베딩만 부릅니다. LLM 판정은 라운드 종료 시 10명씩 배치.
- `PARAPHRASE_LLM=off` 로 판정을 끌 수 있습니다(임베딩+규칙만으로 계속 동작).
  단 이 경우 의미 점수의 **간격이 거의 없습니다** — 등수는 되지만 절대 점수는 믿지 마세요.
- `GEMINI_DAILY_LIMIT` 로 일일 상한. 교사 화면에 오늘 사용량이 표시됩니다.

---

## 10. 선택 과제 (블로커 아님)

- **교사 감각 검증** — 캘리브레이션의 정답 라벨은 구성 사양 + 심판 LLM 확인이지
  사람 교사의 판단이 아닙니다. 실제 학생 답안 30~50개에 교사가 순위를 매겨
  ρ 를 다시 재면 신뢰도가 한 단계 올라갑니다.
- **지문 유형 확대** — 지금은 6개 유형(빈칸추론·요지·주제·제목·주장·함축)만 씁니다.
  넓히면 명제 구조가 달라 임계값 재조정이 필요합니다.
- **실제 수업 1회 투입** — 지금까지의 검증은 전부 합성 데이터입니다. 실제 학생 답안이
  들어와야만 드러나는 것들이 있습니다(빈 제출·한글 섞임·초성체·시간 초과 행동 등).
  블로커 2개를 푼 뒤 한 반으로 먼저 돌려 보는 게 다음 단계입니다.

코드로 더 할 수 있는 항목은 소진했습니다. 남은 것은 전부 사람의 판단(SSO·도메인),
계정 작업(Turso 로그인), 또는 실제 학생 데이터가 있어야 진행됩니다.


---

## 11. M8 — 유형별 태스크 (자습 확장의 첫 단계)

2026-08-15 추가. 수능 313편 전수 대조로 패러프레이즈를 3역량으로 나눈 분석
(`C:\tmp\csat-paraphrase\`)을 앱에 들이는 첫 단계다.

**왜**: 기존 과제는 「지문 전체 → 100단어」 **하나뿐**이라 세 역량을 분리하지 못한다.
특히 **유형 2(명사화)는 전혀 훈련되지 않는데**, 수능이 40번 요약문으로 12개년 전수
평가하는 역량이다. 용도는 **학생 개인 자습**(교실 라이브 아님)으로 확정됐다.

```bash
npm run db:schema                 # 002-tasks.sql 적용 (멱등)
npm run tasks:mine -- --local     # 채굴 후 적재. --dry 는 DB 미변경
npm run tasks:verify -- --local   # 오프셋 무결성. 실패 시 exit 1 (CI 용)
```
`--local` 이 없으면 `.env.local` 의 Turso 를 본다. **프로덕션 적재는 의식적으로**.

### 현재 수치 (지문 119편 → 태스크 478건, 전부 `raw`)

| 유형 | 건수 | 지문 | 비고 |
|---|---|---|---|
| 1 다른 단어로 | 237 | 119 | 지문당 상한 2 |
| 2 접기↔펴기 | 211 | 119 | fold 129 · unfold 82 · 그중 gold 11 |
| 3 되받는 이름 | 30 | 25 | 지시사 16 · 정관사 14(검수 우선) |

**승인 0건** — 사람이 눌러야 학생에게 나간다. 이것이 M8 의 남은 한 칸이다.

### 설계에서 알아야 할 것

- **오프셋이 진실이다.** `*_start/_end` 는 `pc_passages.body` 의 0-기반 문자 오프셋
  (end 배타적). `stimulus_text` 는 그 사본이며 `tasks:verify` 가 둘의 불일치를 잡는다.
  **지문을 고치면 조용히 어긋나므로** 지문 수정 후 반드시 verify 를 돌릴 것.
- **자습이라 지문 전문을 띄우지 않는다.** 학생에게는 `context_start/end` 만 보여준다.
  유형 1·2 는 문장 하나, 유형 3 만 앞 문장 둘. 저작권 노출면이 교실 모드보다 **작다**.
- **유형 3 의 `answer` 는 후보일 뿐이다.** 기본값은 "직전 한 문장"이고, 나열이 두 문장에
  걸치면 검수에서 넓혀야 한다.
- **40번 요약문 골드는 자동 추출이 불가능하다.** 명사화 자리가 곧 빈칸 `(A)` 이기
  때문이다("The (A) of the production process"). 그래서 10편을 **검수 대기 스텁**으로
  세워 뒀다(`origin='gold'`, notes 에 지시 있음). 12개년 중 가장 값진 쌍이라 놓치면 안 된다.

### 밟았던 함정 (M8)

- **요약문 구분자는 U+F003B** — BMP 사제 영역(U+E000~U+F8FF)이 **아니라** Plane 15
  보충 사제 영역이다. JS 에서 서로게이트 쌍이라 문자 클래스에 `u` 플래그가 필요하고,
  범위를 좁게 잡으면 **조용히 0건**이 된다(에러가 안 난다).
- **셔뱅 + CRLF + TS import 세 개가 겹치면 vite-node 가 죽는다.**
  `SyntaxError: Invalid or unexpected token`. 셋 다 있어야 재현된다 — 셔뱅이 없거나
  TS 를 import 하지 않으면 CRLF 여도 멀쩡하고, **`node --check` 는 CRLF 파일을
  통과시킨다**(vite 의 변환 단계 문제라 순수 파싱으로는 안 잡힌다). 그래서 원인을
  찾기가 유난히 어렵다. 처음엔 "CRLF 가 셔뱅을 깬다"고 적었는데 최소 재현으로
  확인해 보니 틀렸다 — TS import 가 있어야 vite 가 그 파일을 변환하고, 그때 셔뱅
  제거가 `` 을 남긴다.
  → `.gitattributes` 로 LF 를 고정했다. Windows 새 클론에서
  `scripts/mine-tasks.mjs` 와 기존 `scripts/diagnose-meaning.mjs` 가 이 조건이었다.
  스크립트로 파일을 고칠 때도 `newline=''` 로 LF 를 유지할 것.
- **`This may result` 는 되받기가 아니다.** result 가 동사다. 껍데기 이름 바로 앞이
  조동사면 버린다(`VERB_CUE`). 이 한 줄이 없으면 오탐이 그대로 들어온다.
- **`of` 보문이 술부를 삼킨다.** "the variability of natural food ingredients **may**
  (B) people's ..." → `STOP_OF` 에 조동사·계사를 넣어야 명사구에서 끊긴다.
- **변이 검사 없이는 가드가 검사되지 않는다.** 처음 쓴 "요약문 블록 제외" 검사는
  픽스처에 그 경로를 밟을 재료가 없어 **가드를 지워도 통과했다.** 미끼로 쓴
  `These pressures` 는 pressure 가 껍데기 이름 목록에 없어 무력했다.
  → 지금은 세 가드(요약문 제외 · 유형1 범위 · 동사 오인) 모두 변이 시 죽는 것을 확인했다.

### 파일

| 경로 | 역할 |
|---|---|
| `scripts/002-tasks.sql` | `pc_tasks` 스키마. 좌표 규약이 주석에 있다 |
| `lib/tasks/segment.ts` | 문장 분할(오프셋 보존) · 한글 판별 · 요약문 블록 분리 |
| `lib/tasks/mine.ts` | 세 유형 채굴. **LLM 미사용(비용 0)** |
| `scripts/mine-tasks.mjs` | 채굴 → 적재. 검수본(`review_status != 'raw'`)은 덮지 않는다 |
| `scripts/verify-tasks.mjs` | 오프셋·범위·유형별 필수 필드 검사 |
| `lib/tasks/__tests__/mine.test.ts` | 13개. 실제 지문 조각 + 가드 전용 픽스처 |
| `.gitattributes` | 줄끝 LF 고정. 위 함정의 재발 방지 |

### 다음 (M9)

유형 2 채점기. 구조 검사(정형동사 유무)로 **무료 선필터** 후 `verdict.ts` 호출.
종료 조건은 상·중·하 합성 학습자의 점수가 갈리는 것 — 셋이 비슷하면 변별력 0 이므로 되돌린다.

---

## 12. M9 1단계 — 유형 2 구조 검사 (무료)

2026-08-15. 계획대로 **유료 판정을 붙이기 전에** 무료 구조 검사만으로 변별력을 먼저 시험했다.

```bash
npm run typed:measure -- --local   # 정형동사 판별 정확도를 코퍼스로 잰다
```

### 정확도 — 라벨이 공짜로 나온다

채굴된 유형2 unfold 자극(`the X of Y`)은 **정의상 명사구**, 지문 문장은 **정의상 절**이다.
사람 라벨도 LLM 도 필요 없이 853건이 나온다.

| 라벨 | 건수 | 정확도 |
|---|---|---|
| 명사구 | 82 | **100.0%** |
| 절 | 771 | 95.5% |
| 전체 | 853 | 95.9% |

**비대칭이 의도한 방향이다.** 명사구 쪽 오탐이 0 이라 "접었는데 아직 문장입니다"라고
잘못 말하는 일이 없다. 절 쪽 4.5% 누락은 아래 3분법으로 흡수한다.

### 왜 세 갈래인가 (pass / unclear / fail)

교사가 없는 자습에서 **틀린 지적은 회복되지 않는다.** 그래서 확신이 있을 때만 판정하고
아니면 유료 판정으로 미룬다. 미룬 것만 돈이 드니 절감 효과는 그대로다.

- 목표가 명사구인데 정형동사가 남았다 → `fail` (실측 100%, 즉결)
- 목표가 절인데 누가 봐도 맨 명사구다 → `fail`
- 그 밖에 애매하면 → `unclear` → `verdict.ts` 로 넘긴다

⚠ **명사구 목표에서도 "동사 없음 = 통과"로 확정하면 안 된다.** 절 판별이 95.5% 라
목록 밖 동사를 쓴 문장("natural ingredients vary a lot")이 새어 나오고, 그걸 통과시키면
접지 못한 학생에게 "이름으로 접었습니다"라고 말하게 된다.

### 킬 기준 — 통과

무료 구조 검사만으로 합성 학습자 3수준이 갈린다.

| 수준 | 구조점수 | 확신 실패 | 유료 호출 | 베낌 표시 |
|---|---|---|---|---|
| 상 | 1.00 | 0% | 100% | 0% |
| 중 | 0.50 | 40% | 60% | 0% |
| 하 | 0.10 | 80% | **20%** | 100% |

**하위권이 유료 판정을 20% 만 부른다** — 구조에서 떨어진 답안에 돈을 쓰지 않는다는
설계가 실측으로 확인됐다. 셋이 비슷했다면 설계를 되돌렸어야 했다.

### 판별기를 만들며 실측으로 고친 것

품사 태거 없이 정형동사를 찾는다. 추측으로 규칙을 넣지 않고 measure 로 확인하며 고쳤다.

- **어휘 목록을 늘리면 오히려 나빠진다.** 명사와 겹치는 낱말(process, sense, value …)을
  넣자 명사구 정확도가 100% → 89% 로 떨어졌다. 재현율보다 정확도가 중요한 자리다.
- **분사 수식어는 거리로 재면 안 된다.** "한정사가 앞 2칸 안" 규칙은
  "remotely sensed imagery" 를 놓친다. **바로 앞 낱말의 종류**(부사 -ly / 전치사 / 한정사)로
  판정해야 한다. 거리로 재면 "The arrival of the Industrial Age **changed** …" 까지 삼킨다.
- **`'s` 는 대명사 뒤에서만 계사다.** 명사 뒤면 소유격이라
  "the importance of an individual's action" 이 절로 오인된다.
- **코퍼스의 아포스트로피는 U+2019(곱슬표)다.** 곧은표만 처리하면 "It's" 가 조용히 샌다.
- **채굴기의 `of` 보문이 술부를 삼키고 있었다.** `STOP_OF` 에 조동사·계사만 있어
  "the representation of cowardly people **makes** us cowardly" 를 명사구로 뽑았다.
  구조 검사기를 채굴기가 재사용하도록 고쳤다 — 라벨이 정화되면서 명사구 정확도가
  93.9% → 100% 가 됐다. **측정 도구의 결함이 채점기 성능처럼 보이던 사례다.**

### 파일

| 경로 | 역할 |
|---|---|
| `lib/scoring/typed/structure.ts` | 정형동사 판별 + 3분법 구조 검사 |
| `lib/scoring/typed/type2.ts` | 유형 2 채점 1단. `needsVerdict` 로 유료 판정 여부를 정한다 |
| `scripts/measure-structure.mjs` | 코퍼스 자동 라벨로 정확도 측정 |
| `lib/scoring/typed/__tests__/type2.test.ts` | 16개. 킬 기준 포함 |

### 다음

`verdict.ts` 연결(2단 의미 판정). `needsVerdict === true` 인 답안만 넘긴다.

---

## 13. M9 2단계 — 유형 2 의미 판정 (유료)

2026-08-15. 구조 검사가 미룬 답안만 LLM 으로 넘긴다.

```bash
npm run typed:calibrate            # 실 API 2콜(8건씩 배치). 과금됨
npm run typed:calibrate -- --dry   # 가짜 판정, 무과금
```

### 무엇을 묻는가

기존 `verdict.ts` 는 **지문 전체의 명제 커버리지**를 잰다. 유형 2 는 그게 아니라
자극 한 조각과 답안 사이의 **국소 등가성**이라 별도 판정(`verdict2.ts`)을 뒀다.

`meaning` 을 다섯 갈래(`same/narrower/broader/changed/reversed`)로 **강제**한다.
"뜻이 같은가?"를 예/아니오로 물으면 모델이 관대해진다. 그리고 그 갈래가 그대로
**오답의 이름**이 된다 — 교수 설계의 오답 5종과 같은 어휘라 학생이 자기 오류를
분류할 수 있다.

### 캘리브레이션 결과 (14건, 손으로 단 라벨)

| 축 | 일치 |
|---|---|
| 의미 | **13/14 (92.9%)** |
| 형식 | 14/14 (100%) |
| 뒤집힌 답을 정답 계열로 부름 | **0** ← 통과 조건 |

기준은 의미 80% 이상 **+ reversed 오판 0**. 뒤집힌 답을 정답으로 부르는 것은
다른 오류보다 훨씬 나쁘므로 따로 건다.

### 밟았던 함정 (M9-2)

- **배치가 조용히 잘린다.** 14건을 `maxOutputTokens: 4096` 으로 한 콜에 보냈더니
  **뒤 4건이 통째로 사라졌다.** `parseGeminiJson` 이 온전한 객체만 건져 내는 탓에
  **에러가 나지 않고 개수만 줄었다.** 항목마다 한국어 피드백과 예시가 붙어 출력이 길다.
  → `BATCH = 8` 로 쪼개고 8192 로 올렸다. 개수가 모자라면 경고를 찍는다.
- **형식 실패가 의미 판정으로 샌다.** 구조를 못 바꾼 답안에 모델이 `meaning: "changed"` 를
  주고 피드백에 "절 형태로 바꿔야 합니다"라고 썼다. 프롬프트에 "두 판단은 분리되며
  서로 영향을 주지 않는다 / 형식 실패는 절대 meaning 에 넣지 말라"를 명시해 고쳤다.
  71.4% → 78.6%.
- **부정을 `changed` 로 부른다.** "…cannot be controlled" 를 reversed 가 아니라 changed 로
  판정했다. "부정·부인은 reversed 다"를 명시해 고쳤다.
- **라벨이 틀린 경우가 있었다.** `the variability of natural ingredients` →
  `… of natural **food** ingredients` 를 same 으로 달았는데 실제로는 좁아진 것이라
  **모델이 옳고 내 라벨이 그랬다.** 모호한 케이스 두 개도 정의상 명확하게 다시 썼다
  (수량어 하나만 바꾸는 식으로). 78.6% → 92.9%.
  ⚠ 라벨을 모델 출력에 맞춰 고치면 순환이다. 정의로 판정할 수 있을 때만 고쳤다.

### 설계 결정 — 구조 검사가 우선이다

**LLM 의 `form` 판정은 실행마다 흔들린다.** 같은 답안(`the production process can be
controlled`)이 run 에 따라 `clause` 와 `noun_phrase` 로 갈렸다. 무료 구조 검사는
실측 95.9% 로 더 정확하고 결정적이다.

그래서 `finalizeType2` 는 **구조 검사가 확신했으면 그 판단을 쓰고, 미뤘을 때만**
LLM 의 form 을 심판으로 쓴다. 이 순서를 뒤집으면 공짜로 맞힐 것에 돈을 쓰고
정확도까지 떨어진다. 테스트로 고정했고 변이 검사로 확인했다.

### 지켜볼 것

남은 오답 1건(`s2`)은 **2025·40 의 실제 정답 쌍**이다.
`natural ingredients often vary in their composition` → `the variability of natural
ingredients` 를 모델이 `narrower`(‘often’·‘composition’ 누락)로 본다. **모델이 수능보다
엄격하다.** 운영에서 `narrower` 가 과다 발생하면 이 지점을 의심할 것.

### 파일

| 경로 | 역할 |
|---|---|
| `lib/scoring/typed/verdict2.ts` | 유형 2 의미 판정. 배치 8건, 가짜 모드 `PARAPHRASE_FAKE_LLM=1` |
| `lib/scoring/typed/type2.ts` | `finalizeType2` — 구조 + 의미를 합쳐 점수와 오답 이름 |
| `scripts/calibrate-type2.mjs` | 손 라벨 14건으로 프롬프트 검증 |

### 다음

M10 학생 세션 + 3축 이력. 자습은 누적이 전부라 이력 없이는 M12(적응형 출제)를 못 만든다.

---

## 14. M10 — 학습자 · 세션 · 3축 이력

2026-08-15. 자습은 누적이 전부라, 이력 없이는 M12(적응형 출제)를 만들 수 없다.

```bash
npm run db:schema                    # 003-learners.sql 적용
npm run typed:simulate -- --local    # 킬 기준. 무료(유료 판정 안 부름)
```

### 순서를 바꾼 이유

계획서의 M10 은 "3축 이력"인데, **유형 1(M11)·유형 3(M13) 채점기가 아직 없어**
축이 하나뿐이면 킬 기준을 돌릴 수 없다. 그래서 **M11 의 무료 절반(회피 검사)을
앞당겨** 두 축을 실물로 만들고 킬 기준을 실제로 돌렸다. 유형 3 은 M13 까지 빈칸이다.

### 킬 기준 — 통과

축마다 다르게 잘하는 합성 학습자 3명을 7일 × 4문항으로 돌렸다.

| 페르소나 | 유형1 | 유형2 | 유형3 | 축 간 간격 |
|---|---|---|---|---|
| 어휘강·구조약 | 85.7 | 17.9 | — | **67.9** |
| 어휘약·구조강 | 21.4 | 78.6 | — | **57.1** |
| 둘 다 중간 | 60.7 | 53.6 | — | 7.1 |

"둘 다 중간"의 간격이 **작게** 나온 것이 중요하다 — 이 도구가 아무 입력에나 큰 간격을
만드는 것이 아님을 보인다. 가장 약한 축도 페르소나마다 갈렸다.

⚠ **이 시뮬레이션이 증명하는 것과 못 하는 것.**
증명: 측정 도구가 축의 차이를 **보존한다**(채점·집계가 차이를 뭉개지 않는다).
증명 못 함: 실제 학생의 축이 다른가. 답안을 내가 만들었으므로 여기서는 알 수 없다.
그건 실사용 데이터로만 확인된다.

### 설계에서 알아야 할 것

- **교실 테이블과 섞지 않았다.** 교실은 방이 단위(1회성 라운드), 자습은 학습자가
  단위(누적)다. 한 테이블에 밀어 넣으면 `room_id` 가 NULL 인 행이 늘고 질의가 엉킨다.
- **총점 칼럼이 없다.** 자습에는 순위가 없어 총점 압력 자체가 없고, 총점으로 뭉뚱그리면
  "무엇이 안 되는가"가 사라진다. 스키마에서 유혹을 없앴다.
- **`pc_attempts` 는 append-only.** 같은 태스크를 다시 만나는 것이 정상 동작(간격 반복)이라
  두 번째 시도가 첫 번째를 덮으면 성장 곡선이 사라진다.
- **`axisSeparation` 은 축이 하나뿐이면 `null` 을 준다 — `0` 이 아니다.**
  채점기가 없는 축을 "차이 없음"으로 세면 **킬 기준이 거짓 통과**한다.
  유형 3 이 M13 까지 비어 있으므로 실제로 마주치는 상황이다.
- **추세는 시도 수가 아니라 날짜 수로 가드한다.** 시도 수로 걸면 하루에 몰아친
  학습자에게 이틀치로 만든 가짜 추세를 보여준다. (변이 검사로 잡은 실제 누락이다.)
- **유형 1 의 두 축은 곱한다.** 합으로 하면 "뜻은 틀렸는데 단어만 바꾼 답"이 절반을
  가져간다 — 오답 5종의 "비슷하지만 다른 말"이 정확히 그 상태다.
- **굴절형은 회피가 아니다.** `vary` 를 `varies` 로 쓴 것은 다른 낱말로 말한 것이
  아니라 같은 낱말을 굴린 것이라 어간으로 비교한다.

### 파일

| 경로 | 역할 |
|---|---|
| `scripts/003-learners.sql` | `pc_learners` · `pc_sessions` · `pc_attempts` |
| `lib/learners/history.ts` | 3축 집계 · 축 간 간격 · 오답 분포 (순수 함수) |
| `lib/learners/attempts.ts` | 시도 기록 · 학생 리포트 조회 |
| `lib/scoring/typed/type1.ts` | 유형 1 의 무료 1단(회피 검사). M11 에서 의미 판정을 붙인다 |
| `scripts/simulate-learners.mjs` | 킬 기준 시뮬레이션 |

### 다음 (M11 잔여)

유형 1 의 2단 — 의미 판정. `verdict2.ts` 의 다섯 갈래를 그대로 쓰되 form 축이 없다.
그다음 M12 적응형 출제(`weakestAxis` 와 `errorDistribution` 이 이미 준비돼 있다).

---

## 15. M11 · M12 · M13 — 나머지 두 축과 적응형 출제

2026-08-15. 자습 확장의 마지막 세 단계.

```bash
npm run typed:calibrate1   # 유형1 의미 판정. 실 API 1콜
npm run typed:calibrate    # 유형2 의미 판정. 실 API 2콜
```

### M11 — 유형 1 (같은 개념, 다른 단어)

2단 구조는 유형 2 와 같다. **의미 × 회피 = 곱**이다. 합으로 하면 뜻이 틀렸는데
낱말만 바꾼 답이 절반을 가져가고, 그게 학생이 가장 많이 하는 실패다
(오답 5종의 "비슷하지만 다른 말"이 정확히 그 상태).

무료 1단은 채굴 때 저장한 `avoid_words` 재사용률이다. **굴절형도 재사용으로 본다** —
`vary` 를 `varies` 로 쓴 것은 다른 낱말로 말한 게 아니라 같은 낱말을 굴린 것이다.
`guards.ts` 의 `surfaceOverlap` 을 쓰지 않은 이유: 그건 자카드(대칭)라 "겹치는가"만
재는데, 여기 필요한 것은 방향이 있는 **회피율**이다.

캘리브레이션 **8/8 (100%)** · 낱말 교체 판정 8/8 · 치명적 0.

### M12 — 적응형 출제

교실의 "교사가 다음 문항을 정한다"를 대체하는 자리다. 세 가지를 함께 본다:
약한 축 가중 · 간격 반복 · 최근 본 것 뒤로.

- **결정론적이다.** 무작위를 쓰면 "왜 이걸 줬는가"를 설명할 수 없다.
- **안 재본 축에 가장 큰 가중치를 준다.** 모르면 재보는 것이 먼저다.
  유형 3 이 M13 전까지 비어 있었으므로 실제로 필요한 규칙이다.
- **SM-2 같은 정교한 스케줄러를 쓰지 않았다.** 실사용 데이터가 없어 파라미터를
  맞출 근거가 없다. 근거가 생기기 전에 복잡한 것을 넣지 않는다.
- 복습할 것이 없으면 새 문항이라도 준다 — 빈손으로 돌려보내지 않는다.

### M13 — 유형 3 (되받는 이름)

**경계가 먼저다.** 범위가 틀렸으면 이름은 채점하지 않는다(유료 호출도 아낀다).
채점은 문자 오프셋 겹침(IoU)이라 **무료**이고, LLM 은 이름 적절성에만 쓴다.

되받는 표현보다 **뒤**를 가리키면 겹침을 재기 전에 방향부터 말해 준다 — 앞의 것을
받는 장치이므로 방향이 어긋난 것은 개념을 잘못 이해한 것이다.
경계가 어긋났을 때는 짧은지 넓은지를 구분해 알려 준다.

### 판정기에서 실측으로 고친 것

- **`broader` 를 모델이 잘 안 쓴다.** `some -> every` 같은 순수한 수량어 확대를
  `changed` 로 불렀다. "수량어·헤지 확대는 broader 이며, 화제가 통째로 다를 때만
  changed 다"를 명시해 고쳤다. 유형1 75% → **100%**.
- **명사화된 속성의 부정도 reversed 다.** `the controllability of X` → `X cannot be
  controlled` 를 `changed` 로 부르던 것을 규칙으로 못 박았다.
- ⚠ **temperature 0 인데도 실행마다 흔들린다.** 같은 14건 세트에서 92.9% / 85.7% /
  85.7% 가 나왔고, 흔들리는 항목이 매번 달랐다. 14건이라 **한 항목이 7pp** 다.
  기준(80%)은 매번 넘지만 **이 세트에 더 맞추면 과적합**이라 여기서 멈췄다.
  판정 결과를 캐시해야 하는 실용적 이유이기도 하다(같은 답안에 다른 점수가 나오면 안 된다).
- ⚠ **모델이 수능보다 엄격하다.** 헤지·빈도 부사를 빠뜨리면 `narrower` 로 본다.
  2025·40 의 실제 정답 쌍도 그렇게 판정된다. 운영에서 `narrower` 가 과다 발생하면
  이 지점을 의심할 것.

### 파일

| 경로 | 역할 |
|---|---|
| `lib/scoring/typed/verdict1.ts` | 유형 1 의미 판정. 유형 2 와 **같은 다섯 갈래** |
| `lib/scoring/typed/type1.ts` | 회피 검사 + `finalizeType1`(의미 × 회피) |
| `lib/learners/pick.ts` | 적응형 출제. 결정론적 |
| `lib/scoring/typed/type3.ts` | 범위 겹침 채점. 무료 |
| `scripts/calibrate-type1.mjs` | 유형 1 판정 검증 |

### 남은 일

1. **태스크 검수 UI** — 478건이 전부 `raw` 다. 사람이 눌러야 학생에게 나간다.
   유형 2 부터 부분 검수(자습은 간격 반복이라 수십 건이면 시작된다).
2. **학생 화면** — 채점기·출제기·이력은 다 있고 UI 가 없다.
3. **판정 캐시** — `pc_score_cache` 를 유형별 판정에도 연결(위의 흔들림 때문에 필수).
4. **프로덕션 적재** — 태스크는 아직 로컬만. `npm run tasks:mine` 을 Turso 로.
