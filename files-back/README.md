# STUDY:U Backend

문서 기반 AI 학습 코치 — FastAPI 백엔드 서버

## 폴더 구조

```
studyu-backend/
├── main.py                    ← 앱 진입점 (여기서 서버 시작)
├── requirements.txt           ← 패키지 목록
├── .env.example               ← 환경변수 템플릿
├── .env                       ← 실제 환경변수 (git에 안 올림)
├── .gitignore
│
├── app/
│   ├── core/                  ← 핵심 설정/유틸
│   │   ├── config.py          ← 환경변수 Settings
│   │   ├── supabase.py        ← Supabase 클라이언트
│   │   ├── auth.py            ← JWT 인증 미들웨어
│   │   └── llm.py             ← LLM 추상화 (OpenAI/Claude)
│   │
│   ├── api/routes/            ← API 엔드포인트
│   │   ├── health.py          ← GET /api/health
│   │   ├── notebooks.py       ← CRUD /api/notebooks
│   │   ├── documents.py       ← 파일 업로드 (3주차)
│   │   └── chat.py            ← RAG 질의응답 (4주차)
│   │
│   ├── schemas/               ← 요청/응답 데이터 형식 정의
│   │   └── notebooks.py
│   │
│   ├── services/              ← 비즈니스 로직 (3주차~)
│   │   └── (rag.py, quiz.py 등 추가 예정)
│   │
│   └── models/                ← 데이터 모델 (필요 시)
│
└── tests/                     ← 테스트 코드
```

## 처음 세팅하기

```bash
# 1. 가상환경 만들기
python -m venv venv

# 2. 가상환경 활성화
#    Windows:
venv\Scripts\activate
#    Mac/Linux:
source venv/bin/activate

# 3. 패키지 설치
pip install -r requirements.txt

# 4. 환경변수 설정
cp .env.example .env
# .env 파일을 열어서 Supabase 키 등을 입력

# 5. 서버 실행
uvicorn main:app --reload
```

## 서버 실행 후 확인

- 서버: http://localhost:8000
- API 문서 (Swagger): http://localhost:8000/docs
- API 문서 (ReDoc): http://localhost:8000/redoc
- 헬스 체크: http://localhost:8000/api/health

## API 엔드포인트 목록

| 메서드 | 경로 | 설명 | 상태 |
|--------|------|------|------|
| GET | `/` | 루트 안내 | ✅ 완료 |
| GET | `/api/health` | 헬스 체크 | ✅ 완료 |
| GET | `/api/notebooks` | 노트북 목록 | ✅ 완료 |
| POST | `/api/notebooks` | 노트북 생성 | ✅ 완료 |
| GET | `/api/notebooks/{id}` | 노트북 상세 | ✅ 완료 |
| PATCH | `/api/notebooks/{id}` | 노트북 수정 | ✅ 완료 |
| DELETE | `/api/notebooks/{id}` | 노트북 삭제 | ✅ 완료 |
| POST | `/api/documents/upload` | 문서 업로드 | 🔜 3주차 |
| POST | `/api/chat` | RAG 질의응답 | 🔜 4주차 |
