## OpenCode Instruction File

OpenCode에서 "instruction file"은 `AGENTS.md`를 가리킨다.

### 파일 경로

- 프로젝트 루트: `./AGENTS.md`
- `CLAUDE.md`는 legacy migration input으로만 취급. primary instruction path가 아님.

### 마커 형식

프로젝트 섹션은 다음 마커 사이에 작성:

```
<!-- NEXUS:START -->
... nexus orchestration section ...
<!-- NEXUS:END -->
```

기존 `AGENTS.md` 내용은 마커 밖에 보존.
마커가 이미 존재하면 내부 내용만 교체.
마커가 없으면 파일 끝에 마커 + 섹션 추가.
`AGENTS.md`가 없으면 마커와 함께 새로 생성.

### 섹션 내용

nx-init Step 4가 생성하는 프로젝트 섹션에 포함되는 내용:
- Nexus Agent Orchestration 헤더
- Agent routing 테이블 (HOW/DO/CHECK)
- Skills 테이블 (trigger, purpose)
- Tags 테이블
- Operational rules
- Coordination model
- Platform mapping (AGENTS.md primary, CLAUDE.md legacy)

### 참고

- `opencode.json`의 `instructions` 필드도 instruction path로 사용 가능하나, 구조화된 nexus section은 `AGENTS.md`에 작성.
- `templates/nexus-section.md`에 생성 가능한 섹션 템플릿이 존재.
