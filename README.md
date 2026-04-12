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

For payments, also set:

- `PAYMENT_CURRENCY`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

## 4) API endpoints used by frontend

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/admin/payment-dues`
- `POST /api/admin/payment-dues`
- `PUT /api/admin/payment-dues/:id`
- `GET /api/admin/payments`
- `PUT /api/admin/payments/:id/status`
- `GET /api/forms`
- `GET /api/forms/:id`
- `POST /api/forms`
- `PUT /api/forms/:id`
- `DELETE /api/forms/:id`
- `GET /api/owner/payments`
- `POST /api/owner/payments/orders`
- `POST /api/owner/payments/verify`
- `POST /api/owner/payments/:id/status`
- `POST /api/submissions`
- `GET /api/submissions`
