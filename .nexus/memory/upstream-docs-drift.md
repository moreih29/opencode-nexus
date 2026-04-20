# upstream nexus-core docs drift (v0.16.2 기준)

> `.nexus/memory/` — nexus-core upstream 문서와 SSOT 간 불일치 관측 기록.

## 배경

nexus-core v0.16.0 에서 OpenCode 계약이 재정렬되었다:
- `opencode.json.fragment` 파일 생성 중단
- plugin 자동 등록이 canonical (`plugin: ["<name>"]`)
- consumer config의 `agents: [...]` 배열은 invalid

그러나 upstream 패키지의 튜토리얼/템플릿 문서가 여전히 구 방식을 서술하고 있어 새 consumer가 오해할 수 있다. 본 문서는 이러한 불일치를 기록하고 향후 upstream 갱신 시 참조한다.

## SSOT (Single Source of Truth)

- `docs/contract/harness-io.md` (v0.16.2): §4-2 OpenCode 가 canonical 계약이다.
- 핵심 요약:
  - OpenCode sync 출력: package.json (Template), src/plugin.ts (Template), src/index.ts (Managed), src/agents/<name>.ts (Managed), .opencode/skills/<name>/SKILL.md (Managed)
  - `opencode.json.fragment` **제거**
  - canonical registration = `plugin: ["<name>"]`
  - consumer config의 `agents: [...]` 는 **invalid**

## 관측된 불일치

### 1) docs/plugin-guide.md

- **위치**: lines 211-242 (v0.16.2 기준)
- **내용**: fragment-기반 agents 배열 등록 예시 + handlerPath 가 `../assets/hooks/.../handler.js` 로 표기.
- **실제 상태**: v0.16.2 sync 는 fragment 를 생성하지 않으며, 실제 manifest handlerPath 는 `../hooks/*.js` 로 해석됨.
- **영향**: 새 consumer가 deprecated 패턴을 따라 plugin 등록을 시도할 수 있음.

### 2) docs/plugin-template/opencode/README.md

- **위치**: lines 23-31, 50-60, 76-103, 121 (v0.16.2 기준)
- **내용**:
  - fragment 를 managed output 으로 서술
  - agents 배열 예시 포함
  - src/plugin.ts 가 optional 로 서술
- **실제 상태**: §4-2 에서 fragment 삭제, agents 배열은 invalid, src/plugin.ts 는 Template 필수 entry.
- **영향**: 템플릿 기반 개발 시 기대와 실제 sync 출력이 달라 혼란 발생 가능.

## 우리 쪽 조치

- opencode-nexus 코드/테스트는 v0.16.2 SSOT 에 정합.
- Tier A 감사 (architect Task 7): subpath 3개 PASS, manifest handlerPath 4/4 resolve (prompt-router 포함), src/plugin.ts tsc PASS. Critical/warning 없음.
- Tier B 감사 (architect Task 8): SSOT 매칭 PASS. 위 불일치 두 건은 warning 으로 분류.
- e2e 회귀 (Task 10): manifest resolves + prompt-router self-contained + fragment-absence assertion 추가.

## 후속 조치 후보 (우리 cycle 밖)

- nexus-core repo 에 issue 제출 (지금 cycle 에서는 제출하지 않음).
- 다음 nexus-core bump 때 재확인.
- upstream 쪽에서 tutorial/template 문서를 SSOT 에 맞춰 갱신하면 본 파일은 deprecated 처리 가능.

## 참조

- plan #59 Issue #3 결정 (committed 감사 항목 9개)
- `.nexus/context/architecture.md` — v0.16.0 수용 섹션
- `.nexus/memory/anti-patterns.md` §9.5 — legacy fragment 원칙
