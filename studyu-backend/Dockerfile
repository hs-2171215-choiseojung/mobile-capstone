FROM python:3.11-slim

# 시스템 패키지 설치 (LibreOffice, ffmpeg, 기타 의존성)
RUN apt-get update && apt-get install -y \
    libreoffice \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 패키지 먼저 설치 (레이어 캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# sentence-transformers 모델 빌드 시점에 다운로드 (런타임 지연 방지)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

# 소스 코드 복사
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
