# GitHub Town

[English](README.en.md) · **한국어**

**라이브: https://jihoo12.github.io/github-town/** (`?user=<이름>`으로 다른 사용자의 도시도 볼 수 있습니다)

배포 워크플로가 빌드할 때 jihoo12의 도시를 미리 받아 `snapshots/jihoo12.json`으로 함께 올리므로, 방문자의 API 한도를 쓰지 않습니다. 저장소 Secret `GH_API_TOKEN`에 토큰을 넣으면 그 토큰으로 받아옵니다 (없으면 Actions 기본 토큰 사용).
스냅샷은 매일 한 번 다시 받아오고, 방문자의 API 한도가 떨어지거나 GitHub에 연결할 수 없을 때는 데모 대신 이 jihoo12 마을을 보여줍니다.

GitHub 사용자의 리포지토리를 3D 도시로 지어주는 웹 앱입니다.
최근에 관리되는 리포지토리는 불 켜진 빌딩이 되고, 잊힌 리포지토리는 같은 거리의
서쪽 끝, 불 꺼진 안개 낀 **고스트 타운**이 됩니다. 1인칭으로 그 사이를 걸어 다닐 수 있습니다.

- 건물 높이 = 스타 수 (로그 스케일)
- 건물 색 = 주 언어
- 활성 리포지토리 → downtown, 90일 넘게 푸시가 없는 리포지토리 → 폐허,
  아카이브된 리포지토리 → 묘비
- 포크 리포지토리는 도시에서 제외됩니다

기본 사용자는 [`jihoo12`](https://github.com/jihoo12)이고, `?user=<이름>` 또는
검색창으로 다른 사용자의 마을을 지을 수 있습니다. `?user=demo`는 API 없이
둘러볼 수 있는 데모 타운입니다.

인터페이스는 한국어와 영어를 지원합니다. 헤더의 **KO/EN** 버튼을 누르거나
`?lang=en` / `?lang=ko`로 지정할 수 있습니다. 선택한 언어는 `localStorage`에
저장되고, 전환할 때는 API를 다시 호출하지 않고 화면 문구만 즉시 바꿉니다.

## 실행

Nix flake로 개발 환경을 고정했습니다 (Node.js 24 + git).

```bash
nix develop          # devShell 진입
npm install
npm run dev          # http://localhost:5173
```

빌드와 타입 검사:

```bash
npm run build        # tsc --noEmit + vite build → dist/
npm run preview      # 빌드 결과 미리보기
npm run typecheck
```

## GitHub API

브라우저에서 [GitHub REST API](https://docs.github.com/rest)를 직접 호출합니다.
서버나 백엔드는 없습니다.

- 토큰이 없으면 IP당 **시간당 60회**만 호출할 수 있습니다. 리포지토리가 100개를
  넘으면 페이지마다 1회씩 추가로 사용합니다.
- 우측 상단 열쇠 버튼에서 personal access token을 넣으면 **시간당 5,000회**까지
  늘어납니다. 토큰은 `localStorage`에만 저장되고 외부로 전송되지 않습니다.
  공개 리포지토리를 읽기만 하므로 추가 scope는 필요 없습니다.
- 성공한 응답은 사용자별로 10분간 캐시되어 새로고침해도 호출을 아낍니다.
  새로고침 버튼은 캐시를 무시하고 다시 불러옵니다.
- 호출 한도, 404, 잘못된 토큰, 네트워크 오류는 각각 안내 카드로 처리합니다.

## 고스트 타운 판정

`pushed_at`(마지막 실제 푸시)을 기준으로 계산합니다.

| 상태 | 조건 | 도시에서의 모습 |
| --- | --- | --- |
| 활성 | 90일 이내 푸시 | downtown의 불 켜진 빌딩 |
| 고스트 (stale) | 90일 넘게 푸시 없음 | 같은 거리 서쪽의 불 꺼진 폐허 |
| 고스트 (archived) | `archived: true` | 고스트 타운 안의 묘비 |

공간과 성능을 위해 활성/고스트 각각 최대 150개까지만 렌더링하고, 잘린 개수는
좌측 패널에 표시합니다.

## 구조

```
index.html          UI 마크업 (검색, 프로필 패널, 범례, 툴팁, 토큰 다이얼로그)
src/main.ts         앱 진입점: 로드 흐름, 캐시, 토큰, URL/localStorage 상태
src/github.ts       GitHub API 호출, 포크 제외, 고스트 판정, 통계
src/i18n.ts         한국어/영어 사전과 언어 전환
src/town.ts         배치 계산과 3D 지오메트리 (섬, 빌딩, 묘비, 가로등, 차)
src/world.ts        렌더러, 하늘/별/달, 조명, 1인칭 이동/충돌, 블룸, 조준/클릭
src/textures.ts     Canvas로 생성하는 창문/간판/라벨/지면/안개 텍스처
src/theme.ts        언어 색상, 숫자/날짜 포맷, 시드 기반 난수
src/ui.ts           DOM 렌더링과 로딩/에러/토스트 상태
src/demo.ts         오프라인 데모 타운 데이터
src/style.css       전체 스타일과 반응형 레이아웃
```

## 조작

- 1인칭으로 마을을 걷습니다. 화면을 클릭하면 마우스가 잠기고 시점을 돌릴 수 있습니다
- `WASD`/방향키로 이동, `Shift`로 달리기, `Space`로 점프, `Esc`로 마우스 해제
- 건물을 조준하면 리포지토리 정보, 그 상태에서 클릭하면 GitHub로 이동
- 터치 화면에서는 왼쪽 아래 스틱으로 이동, 드래그로 둘러보기, 건물을 탭하면 이동
- `/` 키로 검색창 포커스

## 기술 메모

- three.js 0.187 + Vite 8 + TypeScript 5.9
- 건물은 `BoxGeometry`의 UV를 월드 크기에 맞춰 반복시켜 창문 타일이 늘어나지
  않게 했고, 재질은 언어 색상별로 공유합니다.
- 잎/바위/도로 점선/잔해는 `InstancedMesh`로 묶어 draw call을 줄였습니다.
- 렌더링 결과는 `EffectComposer` + `UnrealBloomPass`로 후처리합니다.
