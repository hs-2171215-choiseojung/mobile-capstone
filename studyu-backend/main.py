"""
STUDY:U 백엔드 메인 애플리케이션.

이 파일이 FastAPI 앱의 진입점(entry point)입니다.
uvicorn main:app --reload 로 실행합니다.

이 파일이 하는 일:
1. FastAPI 앱 인스턴스 생성
2. CORS 설정 (프론트엔드가 API를 호출할 수 있도록 허용)
3. 라우터 등록 (각 기능별 API 엔드포인트 연결)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routes import stt
from app.api.routes import tts

# ─────────────────────────────────────────────
# 1. FastAPI 앱 생성
# ─────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="STUDY:U - 문서 기반 AI 학습 코치 API",
    docs_url="/docs",       # Swagger UI: http://localhost:8000/docs
    redoc_url="/redoc",     # ReDoc UI:   http://localhost:8000/redoc
)

# ─────────────────────────────────────────────
# 2. CORS 설정
# ─────────────────────────────────────────────
#
# CORS(Cross-Origin Resource Sharing)란?
# → 브라우저가 "다른 주소"에 있는 서버에 요청하는 것을 허용하는 설정.
#
# 예를 들어:
#   프론트엔드: http://localhost:3000 (Next.js)
#   백엔드:    http://localhost:8000 (FastAPI)
#
# 주소가 다르므로 브라우저가 기본적으로 차단합니다.
# CORS 설정을 해줘야 프론트에서 API 호출이 가능합니다.
#
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,          # http://localhost:3000 (개발)
        "http://localhost:3000",         # 확실하게 하드코딩도 추가
        "http://localhost:3001",         # 혹시 포트가 바뀔 때 대비
        # 배포 후에는 여기에 실제 도메인 추가:
        # "https://studyu.vercel.app",
    ],
    allow_credentials=True,              # 쿠키/인증 헤더 허용
    allow_methods=["*"],                 # GET, POST, PUT, DELETE 등 모두 허용
    allow_headers=["*"],                 # Authorization 등 모든 헤더 허용
)

# ─────────────────────────────────────────────
# 3. 라우터 등록
# ─────────────────────────────────────────────
#
# 각 기능별 라우터를 /api 경로 아래에 모읍니다.
# 예: /api/health, /api/notebooks, /api/documents/upload ...
#
from app.api.routes import health, notebooks, documents, chat, generate

app.include_router(health.router,    prefix="/api", tags=["Health"])
app.include_router(notebooks.router, prefix="/api", tags=["Notebooks"])
app.include_router(documents.router, prefix="/api", tags=["Documents"])
app.include_router(chat.router,      prefix="/api", tags=["Chat"])
app.include_router(generate.router,  prefix="/api", tags=["Generate"])
app.include_router(stt.router, prefix="/api/stt", tags=["STT"])
app.include_router(tts.router, prefix="/api/tts", tags=["TTS"])


# ─────────────────────────────────────────────
# 4. 루트 엔드포인트
# ─────────────────────────────────────────────
@app.get("/")
async def root():
    """
    루트 경로. 서버가 돌아가는지 빠르게 확인하는 용도.
    브라우저에서 http://localhost:8000 접속하면 이게 보임.
    """
    return {
        "message": "STUDY:U API 서버가 실행 중입니다.",
        "docs": "http://localhost:8000/docs 에서 API 문서를 확인하세요.",
    }