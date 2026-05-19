FROM python:3.11-slim

# 시스템 패키지 설치 (LibreOffice, ffmpeg, 한국어 폰트, 기타 의존성)
# fonts-nanum: 나눔고딕/나눔명조 (한국어 기본 폰트)
# fonts-noto-cjk: Noto Sans/Serif CJK (한중일 전체 커버, 폰트 깨짐 방지)
RUN apt-get update && apt-get install -y \
    libreoffice \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    fonts-nanum \
    fonts-noto-cjk \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 패키지 먼저 설치 (레이어 캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "hypercorn main:app --bind 0.0.0.0:${PORT:-8000}"]
