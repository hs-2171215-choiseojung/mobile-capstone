# STUDY:U
강의 자료와 학습 문서를 바탕으로 AI가 학생 맞춤형 학습을 도와주는 문서 기반 학습 플랫폼입니다.

[![Backend](https://img.shields.io/badge/backend-FastAPI-009688?logo=fastapi&logoColor=white)](#기술-스택)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2014-000000?logo=nextdotjs&logoColor=white)](#기술-스택)
[![Database](https://img.shields.io/badge/database-Supabase-3ECF8E?logo=supabase&logoColor=white)](#기술-스택)


## 프로젝트 소개
STUDY:U는 강의 자료, 동영상, URL, 학습 문서를 바탕으로 학생 수준에 맞는 학습 경험을 제공하는 **AI 학습 워크스페이스**입니다.

- 강사는 노트북을 만들고 다양한 형식의 학습 자료를 업로드한 뒤 학생을 초대할 수 있습니다.
- 학생은 초대 코드를 통해 노트북에 참여하고, 난이도에 맞는 AI 질의응답과 맞춤형 학습 계획을 바탕으로 자기주도 학습을 진행할 수 있습니다.
- 질의응답, 요약, 퀴즈, 마인드맵, 오디오 등 다양한 학습 콘텐츠를 하나의 플랫폼에서 통합적으로 활용할 수 있습니다.
- 프론트엔드는 **Next.js**, 백엔드는 **FastAPI**, 인증과 데이터 저장은 **Supabase**를 사용합니다.


## 프로젝트 구조
```text
mobile-capstone/
├─ .github/workflows/          # 배포 워크플로우
├─ studyu-frontend/            # Next.js 프론트엔드
├─ studyu-backend/             # FastAPI 백엔드
├─ uploads/                    # 로컬 업로드/생성 파일 디렉터리
├─ DATABASE_SCHEMA.md          # 데이터베이스 구조 문서
└─ supabase_migration.sql      # Supabase 마이그레이션 참고 파일
```


## 기술 스택

### 프론트엔드
- Next.js 14
- React 18
- TypeScript
- Tailwind CSS

### 백엔드
- FastAPI
- Python

### AI 및 미디어
- OpenAI
- Anthropic
- Google Cloud Speech-to-Text
- ElevenLabs


## 환경 변수

### 프론트엔드
| 환경변수 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 프론트엔드에서 사용하는 Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 프론트엔드에서 사용하는 Supabase 공개 키 |
| `NEXT_PUBLIC_API_URL` | 프론트엔드가 호출할 백엔드 API 주소 |
| `NEXT_PUBLIC_SITE_URL` | 프론트엔드 서비스의 기준 주소 |

### 백엔드
| 환경변수 | 설명 |
| --- | --- |
| `SUPABASE_URL` | 백엔드에서 사용하는 Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | Supabase 일반 클라이언트 접근용 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | 백엔드 관리자 권한 작업에 사용하는 Supabase 서비스 키 |
| `OPENAI_API_KEY` | OpenAI 기반 생성 기능에 사용하는 API 키 |
| `ANTHROPIC_API_KEY` | Anthropic 기반 생성 기능에 사용하는 API 키 |
| `ELEVENLABS_API_KEY` | 음성 합성 기능에 사용하는 API 키 |
| `FRONTEND_URL` | CORS 허용 및 연동 기준이 되는 프론트엔드 주소 |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Cloud STT 인증용 서비스 계정 파일 경로 |
| `GCP_PROJECT_ID` | Google Cloud 프로젝트 ID |
| `PROXY_USER_ID` | 외부 프록시 또는 인증 연동용 사용자 ID |
| `PROXY_USER_PW` | 외부 프록시 또는 인증 연동용 비밀번호 |


## 실행 방법

### 준비 사항
로컬에서 실행하기 전에 아래 항목이 필요합니다.
- Node.js 18 이상
- Python 3.10 이상 권장
- Supabase 프로젝트
- 사용하려는 기능에 맞는 외부 API 키

### 1. 저장소 복제
```bash
git clone https://github.com/hs-2171215-choiseojung/mobile-capstone.git
cd mobile-capstone
```

### 2. 프론트엔드 실행
```bash
cd studyu-frontend
npm install
npm run dev
```

### 3. 백엔드 실행
```bash
cd studyu-backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### 4. 실행 확인
- 프론트엔드: `http://localhost:3000`
- 백엔드: `http://localhost:8000`
- Swagger 문서: `http://localhost:8000/docs`
- Health Check: `http://localhost:8000/api/health`


## 사용 방법

### 강사 사용 흐름
- 로그인 후 강사 대시보드로 이동합니다.
- 새 노트북을 만들고 PDF, 슬라이드, 문서, URL 등의 학습 자료를 업로드합니다.
- 초대 코드를 생성해 학생에게 공유합니다.
- 워크스페이스에서 AI를 활용해 학습 자료를 기반으로 AI 학습 콘텐츠를 생성합니다.

### 학생 사용 흐름
- 로그인 후 초대 코드를 입력해 노트북에 참여합니다.
- 학생 대시보드에서 참여 중인 노트북을 선택합니다.
- 주차별 학습 계획을 확인하고 난이도에 맞는 자료 기반 AI 채팅으로 학습합니다.
- 문서 뷰어, 학습 계획, AI 학습 콘텐츠를 함께 활용하며 자기주도 학습을 진행할 수 있습니다.


## 배포 링크
- 서비스 바로가기: [https://tutor.everyi.ai/](https://tutor.everyi.ai/)
