1. Docker 启动（推荐先跑通）
  默认不是前后端分开启动。Dockerfile 会先构建前端，再由后端 FastAPI 服务静态文件。

  cd /opt/Vibe-Trading
  docker compose up --build

  打开：

  http://localhost:8899

  对应配置在 docker-compose.yml:1 和 Dockerfile:1。

  2. 本地开发启动（前后端分开）

  后端：

  cd /opt/Vibe-Trading
  python -m venv .venv
  source .venv/bin/activate
  pip install -e .
  vibe-trading serve --port 8899

  前端：

  cd /opt/Vibe-Trading/frontend
  npm install
  npm run dev

 # 后端
  cd /opt/Vibe-Trading
  .venv/bin/vibe-trading serve --host 127.0.0.1 --port 8899

  # 前端
  cd /opt/Vibe-Trading/frontend
  npm run dev -- --host 0.0.0.0 --port 8765 --strictPort



  前端 Vite 默认绑定 0.0.0.0:8765，并把 API 请求代理到 http://127.0.0.1:8899，见 frontend/vite.config.ts:1。

  补充：如果本地只想单服务启动，也可以先构建前端：

  cd /opt/Vibe-Trading/frontend
  npm run build
  cd ..
  vibe-trading serve --port 8899

  然后打开 http://localhost:8899。当前项目里已经有 agent/.env，启动前注意里面的 API key 不要提交或外发。
