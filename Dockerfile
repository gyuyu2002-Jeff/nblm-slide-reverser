# 使用官方輕量級 Python 3.11 映像檔
FROM python:3.11-slim

# 設定工作目錄
WORKDIR /app

# 設定環境變數
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# 安裝系統相依項（支援 PyMuPDF 與影像處理）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 複製依賴清單並安裝
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製應用程式原始碼
COPY . .

# 暴露服務埠號
EXPOSE 8000

# 啟動指令 (支援雲端平台環境變數 $PORT)
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
