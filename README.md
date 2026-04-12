# ReadySetLeague Backend (MySQL)

Standalone backend for the frontend app.

## 1) Prerequisites

- Node.js 18+
- MySQL 8+

## 2) Configure environment

Copy `.env.example` to `.env` and update DB values:

```bash
cp .env.example .env
```

## 3) Install and run

```bash
npm install
npm run dev
```

Backend default URL: `http://localhost:4000`

## 4) API endpoints used by frontend

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/forms`
- `GET /api/forms/:id`
- `POST /api/forms`
- `PUT /api/forms/:id`
- `DELETE /api/forms/:id`
- `POST /api/submissions`
- `GET /api/submissions`
