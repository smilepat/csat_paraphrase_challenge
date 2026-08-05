---
project: csat_paraphrase_challenge
status: active
progress: 92
updated: 2026-07-27
pc: DESKTOP-A8ES4P0
wip: 1            # WIP 5 (2026-08-05 확정) — repo-ops-system/MULTI_PC_OPS.md §1-1
---

# csat_paraphrase_challenge — STATUS

## 🎯 한 줄 상태

수능 기출 지문을 **가장 짧고 쉬운 영어로 바꾸는 교실 활동 앱**.
단일 HTML 팀 대항 게임 → **Next.js 16 앱**으로 전환 완료 (학생 기기 제출 + 교사 실시간 화면).
채점을 문자열 매칭에서 **명제 단위 판정**으로 교체하고 축별 캘리브레이션으로 검증했다.
남은 건 배포 환경의 **Turso DB**와 **학생 접근 경로(Vercel SSO)** 둘뿐.

## 📊 진행 체크리스트

- [x] **M0** Next.js 16 + TS + Tailwind4 스캐폴드 · `pc_*` 스키마 6테이블 · 원본 HTML 보존(`/standalone.html`)
- [x] **M0** CSAT 지문 적재 — 565 → 유형·길이·중복 필터 → **118**(제외 사유 유형별 로그)
- [x] **M1** 지문 보강 118개(핵심 명제·모범답안, 실패 0) + `/admin/passages` 검수 UI
- [x] **M1** 검수 자동 점검(`audit.ts`) — 무지적 **115**/경고 3/오류 0 · 무지적 일괄 승인
- [x] **M2** 채점 엔진 재작성 — 의미 50(명제 판정) / 간결 25 / 쉬움 25(수능 빈도 6,266) + 복붙 가드 4종
- [x] **M2** 축별 캘리브레이션 전체 PASS — 의미 ρ**0.978** · 쉬움 ρ0.932 · 간결 ρ0.924 · 모순 9/9 · 복붙 6/6 오탐 0/84
- [x] **M3** 방 생성·6자리 조인·제출 (host token 쿠키 · 기기 신원 localStorage)
- [x] **M4** 교사 라이브 대시보드 — 2초 폴링 · 랭킹 · 팀 점수 · 플래그 확인 · 베스트3 비교
- [x] **M5** 라운드 종료 배치 판정 + `pc_score_cache` + 일일 상한 (30명 라운드 ≈ **5콜**, 재채점 0콜)
- [x] **M6** 리포트·CSV · 교사 직접 문항 입력(`/admin/passages/new`)
- [x] **M7** Playwright E2E **7개** · CI(typecheck+단위+build+E2E) · noindex · `proxy.ts` 교사 경로 Basic 인증
- [x] **플래그 제출 처리** — 교사 판단 전까지 순위·팀점수·평균에서 제외(복붙이 2위에 오르던 문제)
- [x] Vercel 프로젝트·env(prod+preview)·프리뷰 배포 · 앱 계층 보호 401 실측
- [x] **Turso DB** — 생성·스키마·지문 119개 이관·env 등록 완료
- [x] **프로덕션 가동** — 실 라운드 통과(embed 2콜/verdict 1콜), 하이드레이션 결함 1건 수정
- [x] **Vercel SSO 조정** — `preview` 전용으로 변경 완료(프로덕션 개방, 학생 입장 가능)
- [ ] 실제 수업 1회 투입 · 교사 감각 검증(사람 순위 vs 엔진 ρ)

## ⏭️ 다음에 할 일 (Next Actions)

1. **지문 승인** — https://csat-paraphrase-challenge.vercel.app/admin/passages 에서
   "지적 없는 116개 한꺼번에 승인". 승인 0개면 방을 만들 수 없다.
2. ~~학생 접근 열기~~ — 완료
3. 실제 수업 1회 투입 — 폰(학생)·PC(교사)로 한 라운드

## 🤔 결정 대기 (Decisions Needed)

- ~~학생 접근 방식~~ → **B 선택, 적용 완료**(`ssoProtection=preview`).
  프로덕션은 공개되고 `/admin`·`/host` 만 `TEACHER_PASSWORD` 가 막는다.
- **지문 유형 확대 여부** — 지금은 6유형(빈칸추론·요지·주제·제목·주장·함축)만.
  넓히면 명제 구조가 달라 임계값 재조정 필요.

## 🚀 배포

- 프리뷰: 배포됨 (Vercel 인증 + 앱 비밀번호 이중 보호, DB 없어 교사 경로 500)
- 프로덕션: **미배포** — 블로커 2개 해소 후
- ⚠ CSAT 기출 원문 포함 → **비공개 전제**. `noindex` + `/admin`·`/host` Basic 인증.
  운영에서 `TEACHER_PASSWORD` 미설정 시 교사 경로 **503**(고의적 안전 기본값)

## 🔗 Claude Code 재개 프롬프트

"HANDOFF.md 읽고 csat_paraphrase_challenge 이어서 하자"
(정본은 [HANDOFF.md](HANDOFF.md) — 재개 절차·블로커·설계 근거·함정 목록이 한 장에 있다.
 채점을 건드리기 전에는 [docs/CALIBRATION.md](docs/CALIBRATION.md) 를 반드시 먼저 읽을 것)
