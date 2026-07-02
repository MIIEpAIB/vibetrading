# Vibe Trading Admin

独立的 Next.js 后台管理应用，和主站 `frontend/` 分开维护。

## 开发

```bash
cd admin
npm install
VIBE_API_URL=http://127.0.0.1:8899 npm run dev
```

默认端口是 `8787`。后台通过 `app/api/vibe/[...path]` 代理调用现有 FastAPI，因此浏览器不需要直接跨域访问后端。

## 编译打包

```bash
cd admin
npm install
npm run build
```

## 生产启动

```bash
cd admin
VIBE_API_URL=http://127.0.0.1:8899 npm run start
```

## 环境变量

- `VIBE_API_URL`: FastAPI 后端地址，默认 `http://127.0.0.1:8899`
