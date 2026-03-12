<<<<<<< HEAD
# STUDY:U Frontend

문서 기반 AI 학습 코치 — Next.js + Supabase

---

## 🚀 처음 세팅하기 (따라하기)

### 사전 준비물

- **Node.js 18+** 설치 확인: `node -v`
- **Supabase 프로젝트** 생성 완료 (supabase_guide.md 참고)
- **Google OAuth** 설정 완료 (supabase_guide.md 6번 참고)
- **migration SQL** 실행 완료 (supabase_guide.md 5번 참고)

### Step 1: 프로젝트 클론 & 패키지 설치

```bash
# 프로젝트 폴더로 이동
cd studyu-frontend

# 패키지 설치 (처음 한 번만)
npm install
```

### Step 2: 환경 변수 설정

```bash
# 템플릿 파일 복사
cp .env.example .env.local
```

`.env.local` 파일을 열어서 수정:

```env
# Supabase 대시보드 → Settings → API에서 복사
NEXT_PUBLIC_SUPABASE_URL=https://여기에-프로젝트-url.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=여기에-anon-key-붙여넣기

# 개발 서버 URL (그대로 두면 됨)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### Step 3: Supabase에서 Redirect URL 추가

Google Cloud Console → Credentials → OAuth 2.0 Client에서
**Authorized redirect URIs**에 다음을 추가했는지 확인:

```
https://여기에-프로젝트-url.supabase.co/auth/v1/callback
```

### Step 4: 개발 서버 실행!

```bash
npm run dev
```

브라우저에서 **http://localhost:3000** 접속

### Step 5: 테스트 흐름

```
1. http://localhost:3000 접속
   → 랜딩 페이지가 보임

2. "로그인" 또는 "Google로 시작하기" 클릭
   → 로그인 페이지로 이동

3. "Google로 계속하기" 클릭
   → Google 로그인 팝업이 뜸

4. Google 계정 선택 & 로그인
   → /auth/callback을 거쳐 /dashboard로 자동 이동

5. 대시보드에서 확인:
   - 이름, 이메일, 프로필 사진이 표시되는지
   - "개발자 정보 보기"를 열어서:
     - User ID가 있는지
     - public.users 존재: ✅ Yes 인지
   
6. 로그아웃 클릭
   → 로그인 페이지로 이동
```

---

## 📁 폴더 구조 설명

```
studyu-frontend/
├── app/                    ← Next.js App Router (페이지들)
│   ├── layout.tsx          ← 전체 레이아웃 (html, body)
│   ├── page.tsx            ← 랜딩 페이지 (/)
│   ├── globals.css         ← 전역 CSS + Tailwind
│   ├── login/
│   │   └── page.tsx        ← 로그인 페이지 (/login)
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts    ← OAuth 콜백 처리 (/auth/callback)
│   └── dashboard/
│       └── page.tsx        ← 대시보드 (/dashboard) - 로그인 필요
│
├── components/             ← 재사용 가능한 컴포넌트
│   └── auth/
│       └── LogoutButton.tsx
│
├── lib/                    ← 유틸리티, 설정
│   └── supabase/
│       ├── client.ts       ← 브라우저용 Supabase 클라이언트
│       └── server.ts       ← 서버용 Supabase 클라이언트
│
├── middleware.ts            ← 세션 갱신 + 인증 체크 미들웨어
│
├── .env.example            ← 환경 변수 템플릿
├── .env.local              ← 실제 환경 변수 (git 제외!)
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── next.config.js
```

---

## 🔑 핵심 개념: 파일별 역할

### Supabase 클라이언트가 2개인 이유

| 파일 | 어디서 쓰는지 | 설명 |
|------|------------|------|
| `lib/supabase/client.ts` | `'use client'` 컴포넌트 | 브라우저에서 실행되는 코드용. 로그인 버튼, 데이터 fetch 등 |
| `lib/supabase/server.ts` | Server Component, API Route | 서버에서 실행되는 코드용. 쿠키로 세션 관리 |

Next.js에서는 **서버에서 렌더링되는 코드**와 **브라우저에서 실행되는 코드**가 나뉘어 있기 때문에
Supabase 클라이언트도 2개가 필요합니다.

### middleware.ts가 하는 일

1. **모든 요청**에서 Supabase 세션(쿠키)을 확인하고 갱신
2. 로그인 안 한 사용자가 `/dashboard`에 접근하면 → `/login`으로 리다이렉트
3. 이미 로그인한 사용자가 `/login`에 접근하면 → `/dashboard`로 리다이렉트

### auth/callback/route.ts가 하는 일

Google 로그인 흐름:
```
사용자가 "Google로 계속하기" 클릭
    ↓
Google 로그인 페이지로 이동
    ↓
Google에서 로그인 성공
    ↓
Supabase가 /auth/callback?code=xxx 로 리다이렉트
    ↓
route.ts에서 code를 세션으로 교환
    ↓
/dashboard로 이동
```

---

## ⚠️ 문제 해결

### "Google 로그인 버튼을 눌렀는데 아무 일도 안 일어남"
→ `.env.local`에 Supabase URL과 anon key가 제대로 들어갔는지 확인
→ 브라우저 콘솔(F12)에서 에러 메시지 확인

### "Google 로그인은 됐는데 /auth/callback에서 에러"
→ Supabase 대시보드 → Authentication → URL Configuration에서
   Site URL이 `http://localhost:3000`으로 설정되어 있는지 확인

### "대시보드에서 public.users 존재: ❌ No"
→ migration SQL의 `handle_new_user` 트리거가 제대로 실행되지 않은 것
→ SQL Editor에서 해당 트리거 부분만 다시 실행

### "로그인 후 /login으로 계속 돌아감"
→ middleware.ts가 제대로 동작하지 않는 것
→ Supabase 대시보드 → Authentication → URL Configuration에서
   Redirect URLs에 `http://localhost:3000/**` 추가

---

## 🔜 다음 단계 (2주차)

- [ ] 노트북 생성/삭제 UI
- [ ] 2패널 레이아웃 (좌: 소스, 우: 대화)
- [ ] FastAPI 백엔드 프로젝트 세팅
- [ ] 파일 업로드 UI 시작
=======
# mobile-capstone
STUDY:U - 문서 기반 AI 학습 코치
>>>>>>> 017c80093065fd62518a496e42d29f39f94d7a7f
