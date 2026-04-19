import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { execute, initDatabase, queryAll, queryOne } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const PAYMENT_CURRENCY = (process.env.PAYMENT_CURRENCY || 'INR').toUpperCase();
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RESEND_EMAIL_API = process.env.RESEND_EMAIL_API || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'ReadySetLeague <onboarding@resend.dev>';
const GOOGLE_CLIENT_IDS = String(process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const EMAIL_VERIFICATION_OTP_TTL_MINUTES = Number(process.env.EMAIL_VERIFICATION_OTP_TTL_MINUTES || 10);

const allowedOrigins = process.env.FRONTEND_URL.split(',');

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
	callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
)
app.use(express.json());

function createToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    authProvider: user.auth_provider || 'password',
    emailVerified: Boolean(user.email_verified_at),
  };
}

function parseJsonField(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function normalizeCurrency(currency) {
  return String(currency || PAYMENT_CURRENCY).trim().toUpperCase();
}

function parseAmount(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function formatAmount(amount) {
  return Number(Number(amount || 0).toFixed(2));
}

function toMinorUnits(amount) {
  return Math.round(formatAmount(amount) * 100);
}

function requireRazorpayConfig(res) {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    res.status(500).json({ error: 'Razorpay is not configured on the server' });
    return false;
  }
  return true;
}

async function createRazorpayOrder({ amount, currency, receipt, notes }) {
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: toMinorUnits(amount),
      currency,
      receipt,
      notes,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.description || 'Failed to create Razorpay order');
  }

  return data;
}

function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const digest = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return digest === signature;
}

function statusLabel(status) {
  return status || 'pending';
}

function validatePassword(password) {
  if (!password) {
    return 'Password is required';
  }

  if (String(password).length < 6) {
    return 'Password must be at least 6 characters';
  }

  return null;
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function createEmailVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationEmail({ email, name, code }) {
  if (!RESEND_EMAIL_API) {
    throw new Error('Resend email API is not configured on the server');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_EMAIL_API}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [email],
      subject: 'Your ReadySetLeague verification code',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
          <h2 style="margin-bottom: 12px;">Verify your email address</h2>
          <p>Hello ${String(name || 'there')},</p>
          <p>Thanks for registering with ReadySetLeague. Enter this one-time code to activate your account:</p>
          <div style="margin: 24px 0; font-size: 32px; letter-spacing: 8px; font-weight: 700; color: #059669;">
            ${code}
          </div>
          <p>This code expires in ${EMAIL_VERIFICATION_OTP_TTL_MINUTES} minutes.</p>
        </div>
      `,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || 'Failed to send verification email');
  }

  return data;
}

async function issueEmailVerification(user) {
  const code = createEmailVerificationCode();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_OTP_TTL_MINUTES * 60 * 1000);
  await execute(
    'UPDATE users SET email_verification_token_hash = ?, email_verification_expires_at = ? WHERE id = ?',
    [hashVerificationCode(code), expiresAt, user.id],
  );
  await sendVerificationEmail({
    email: user.email,
    name: user.name,
    code,
  });
}

async function verifyGoogleCredential(credential) {
  if (!credential) {
    throw new Error('Google credential is required');
  }

  if (GOOGLE_CLIENT_IDS.length === 0) {
    throw new Error('Google login is not configured on the server');
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error_description || 'Invalid Google token');
  }

  if (!GOOGLE_CLIENT_IDS.includes(data.aud)) {
    throw new Error('Google token audience is invalid');
  }

  if (!['accounts.google.com', 'https://accounts.google.com'].includes(data.iss)) {
    throw new Error('Google token issuer is invalid');
  }

  if (String(data.email_verified) !== 'true') {
    throw new Error('Google account email is not verified');
  }

  if (!data.sub || !data.email) {
    throw new Error('Google account details are incomplete');
  }

  return {
    sub: String(data.sub),
    email: String(data.email).trim().toLowerCase(),
    name: String(data.name || data.email).trim(),
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post(
  '/api/auth/register',
  asyncRoute(async (req, res) => {
    const { name, email, phone, password } = req.body || {};
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'name, email, phone and password are required' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await queryOne('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const countRow = await queryOne('SELECT COUNT(*) AS count FROM users');
    const role = Number(countRow?.count || 0) === 0 ? 'admin' : 'owner';
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(String(password), 10);

    await execute(
      'INSERT INTO users (id, name, email, phone, password_hash, auth_provider, role, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, String(name).trim(), normalizedEmail, String(phone).trim(), passwordHash, 'password', role, null],
    );

    const user = { id, name: String(name).trim(), email: normalizedEmail, phone: String(phone).trim(), role, auth_provider: 'password' };
    try {
      await issueEmailVerification(user);
    } catch (error) {
      await execute('DELETE FROM users WHERE id = ?', [id]);
      throw error;
    }

    return res.status(201).json({
      requiresEmailVerification: true,
      email: normalizedEmail,
      message: 'Registration successful. We sent a verification code to your email.',
    });
  }),
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await queryOne('SELECT * FROM users WHERE email = ? LIMIT 1', [String(email).trim().toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.auth_provider === 'password' && !user.email_verified_at) {
      return res.status(403).json({
        error: 'Please verify your email with the code we sent before signing in',
        needsEmailVerification: true,
        email: user.email,
      });
    }

    const isMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const payload = serializeUser(user);
    return res.json({ token: createToken(payload), user: payload });
  }),
);

app.post(
  '/api/auth/google',
  asyncRoute(async (req, res) => {
    const { credential } = req.body || {};
    const googleUser = await verifyGoogleCredential(credential);

    let user = await queryOne('SELECT * FROM users WHERE google_sub = ? LIMIT 1', [googleUser.sub]);

    if (!user) {
      const emailMatch = await queryOne('SELECT * FROM users WHERE email = ? LIMIT 1', [googleUser.email]);

      if (emailMatch && emailMatch.google_sub && emailMatch.google_sub !== googleUser.sub) {
        return res.status(409).json({ error: 'This email is already linked to a different Google account' });
      }

      if (emailMatch) {
        await execute(
          'UPDATE users SET google_sub = ?, name = CASE WHEN TRIM(COALESCE(name, \'\')) = \'\' THEN ? ELSE name END, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = ?',
          [googleUser.sub, googleUser.name, emailMatch.id],
        );
        user = await queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [emailMatch.id]);
      } else {
        const id = randomUUID();
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        const countRow = await queryOne('SELECT COUNT(*) AS count FROM users');
        const role = Number(countRow?.count || 0) === 0 ? 'admin' : 'owner';

        await execute(
          'INSERT INTO users (id, name, email, phone, password_hash, auth_provider, google_sub, role, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [id, googleUser.name, googleUser.email, '', passwordHash, 'google', googleUser.sub, role],
        );

        user = await queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      }
    }

    const payload = serializeUser(user);
    return res.json({ token: createToken(payload), user: payload });
  }),
);

app.post(
  '/api/auth/verify-email',
  asyncRoute(async (req, res) => {
    const { email, code } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedCode = String(code || '').trim();

    if (!normalizedEmail || !normalizedCode) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    if (!/^\d{6}$/.test(normalizedCode)) {
      return res.status(400).json({ error: 'Verification code must be 6 digits' });
    }

    const user = await queryOne(
      `
        SELECT id, email, email_verified_at, email_verification_token_hash, email_verification_expires_at
        FROM users
        WHERE email = ?
        LIMIT 1
      `,
      [normalizedEmail],
    );

    if (!user) {
      return res.status(400).json({ error: 'No account found for this email' });
    }

    if (user.email_verified_at) {
      return res.json({ success: true, alreadyVerified: true, message: 'Email already verified. You can sign in now.' });
    }

    if (!user.email_verification_expires_at || new Date(user.email_verification_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    if (!user.email_verification_token_hash || user.email_verification_token_hash !== hashVerificationCode(normalizedCode)) {
      return res.status(400).json({ error: 'Verification code is invalid' });
    }

    await execute(
      `
        UPDATE users
        SET email_verified_at = CURRENT_TIMESTAMP,
            email_verification_token_hash = NULL,
            email_verification_expires_at = NULL
        WHERE id = ?
      `,
      [user.id],
    );

    return res.json({ success: true, message: 'Email verified successfully. You can sign in now.' });
  }),
);

app.post(
  '/api/auth/resend-verification',
  asyncRoute(async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await queryOne(
      'SELECT id, name, email, auth_provider, email_verified_at FROM users WHERE email = ? LIMIT 1',
      [String(email).trim().toLowerCase()],
    );

    if (!user) {
      return res.status(404).json({ error: 'No account found for this email' });
    }

    if (user.auth_provider !== 'password') {
      return res.status(400).json({ error: 'This account signs in with Google and does not need email verification' });
    }

    if (user.email_verified_at) {
      return res.status(400).json({ error: 'This email is already verified' });
    }

    await issueEmailVerification(user);
    return res.json({ success: true, message: 'Verification email sent. Please check your inbox.' });
  }),
);

app.get(
  '/api/auth/me',
  authenticateToken,
  asyncRoute(async (req, res) => {
    const user = await queryOne(
      'SELECT id, name, email, phone, role, auth_provider, email_verified_at FROM users WHERE id = ? LIMIT 1',
      [req.user.id],
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(serializeUser(user));
  }),
);

app.post(
  '/api/auth/change-password',
  authenticateToken,
  asyncRoute(async (req, res) => {
    const { current_password, new_password } = req.body || {};

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }

    const passwordError = validatePassword(new_password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const user = await queryOne('SELECT id, password_hash, auth_provider FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.auth_provider === 'google') {
      return res.status(400).json({ error: 'Password changes are unavailable for Google sign-in accounts' });
    }

    const isMatch = await bcrypt.compare(String(current_password), user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const isSamePassword = await bcrypt.compare(String(new_password), user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }

    const passwordHash = await bcrypt.hash(String(new_password), 10);
    await execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);

    return res.json({ success: true });
  }),
);

app.get(
  '/api/admin/stats',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const owners = await queryOne("SELECT COUNT(DISTINCT user_id) AS count FROM submissions WHERE status = 'approved'");
    const forms = await queryOne('SELECT COUNT(*) AS count FROM forms');
    const submissions = await queryOne('SELECT COUNT(*) AS count FROM submissions');

    return res.json({
      owners: Number(owners?.count || 0),
      forms: Number(forms?.count || 0),
      submissions: Number(submissions?.count || 0),
    });
  }),
);

app.get(
  '/api/admin/users',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const owners = await queryAll(
      `
        SELECT
          u.name,
          u.id AS user_id,
          u.email,
          u.phone,
          u.created_at AS registered_at,
          s.id AS submission_id,
          s.form_id,
          s.status AS submission_status,
          s.created_at AS submitted_at,
          s.approved_at,
          f.title AS form_title,
          s.data_json
        FROM users u
        LEFT JOIN submissions s
          ON s.id = (
            SELECT s2.id
            FROM submissions s2
            WHERE s2.user_id = u.id
            ORDER BY
              CASE WHEN s2.status = 'approved' THEN 0 ELSE 1 END,
              s2.created_at DESC
            LIMIT 1
          )
        LEFT JOIN forms f ON f.id = s.form_id
        WHERE u.role = 'owner'
        ORDER BY u.created_at DESC, u.name ASC
      `,
    );
    return res.json(
      owners.map((owner) => ({
        ...owner,
        data: parseJsonField(owner.data_json, {}),
      })),
    );
  }),
);

app.post(
  '/api/admin/users/:userId/reset-password',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { new_password } = req.body || {};

    const passwordError = validatePassword(new_password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const owner = await queryOne('SELECT id, role FROM users WHERE id = ? LIMIT 1', [req.params.userId]);
    if (!owner) {
      return res.status(404).json({ error: 'Owner not found' });
    }

    if (owner.role !== 'owner') {
      return res.status(400).json({ error: 'Only owner passwords can be reset here' });
    }

    const passwordHash = await bcrypt.hash(String(new_password), 10);
    await execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, owner.id]);

    return res.json({ success: true });
  }),
);

app.get(
  '/api/admin/payment-dues',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const dues = await queryAll(
      `
        SELECT
          pd.*,
          creator.name AS created_by_name,
          (
            SELECT COUNT(*)
            FROM payments p
            WHERE p.due_id = pd.id AND p.status = 'paid'
          ) AS paid_count
        FROM payment_dues pd
        LEFT JOIN users creator ON pd.created_by = creator.id
        ORDER BY pd.created_at DESC
      `,
    );

    return res.json(
      dues.map((due) => ({
        ...due,
        amount: formatAmount(due.amount),
        is_active: Number(due.is_active) === 1,
      })),
    );
  }),
);

app.post(
  '/api/admin/payment-dues',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { title, description, amount, currency, due_date, is_active } = req.body || {};
    const normalizedAmount = parseAmount(amount);

    if (!title || normalizedAmount === null) {
      return res.status(400).json({ error: 'title and a valid amount are required' });
    }

    const id = randomUUID();
    const normalizedCurrency = normalizeCurrency(currency);
    const normalizedDueDate = due_date ? new Date(due_date) : null;
    if (normalizedDueDate && Number.isNaN(normalizedDueDate.getTime())) {
      return res.status(400).json({ error: 'Invalid due_date' });
    }

    await execute(
      `
        INSERT INTO payment_dues (id, title, description, amount, currency, due_date, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        String(title).trim(),
        description ? String(description).trim() : '',
        normalizedAmount,
        normalizedCurrency,
        normalizedDueDate ? normalizedDueDate : null,
        is_active === false ? 0 : 1,
        req.user.id,
      ],
    );

    return res.json({ id });
  }),
);

app.put(
  '/api/admin/payment-dues/:id',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const existing = await queryOne('SELECT id FROM payment_dues WHERE id = ? LIMIT 1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Payment due not found' });
    }

    const { title, description, amount, currency, due_date, is_active } = req.body || {};
    const normalizedAmount = parseAmount(amount);
    if (!title || normalizedAmount === null) {
      return res.status(400).json({ error: 'title and a valid amount are required' });
    }

    const normalizedDueDate = due_date ? new Date(due_date) : null;
    if (normalizedDueDate && Number.isNaN(normalizedDueDate.getTime())) {
      return res.status(400).json({ error: 'Invalid due_date' });
    }

    await execute(
      `
        UPDATE payment_dues
        SET title = ?, description = ?, amount = ?, currency = ?, due_date = ?, is_active = ?
        WHERE id = ?
      `,
      [
        String(title).trim(),
        description ? String(description).trim() : '',
        normalizedAmount,
        normalizeCurrency(currency),
        normalizedDueDate ? normalizedDueDate : null,
        is_active === false ? 0 : 1,
        req.params.id,
      ],
    );

    return res.json({ success: true });
  }),
);

app.get(
  '/api/admin/payments',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const payments = await queryAll(
      `
        SELECT
          p.*,
          u.name AS owner_name,
          u.email AS owner_email,
          u.phone AS owner_phone,
          pd.title AS due_title,
          pd.description AS due_description,
          pd.due_date,
          pd.is_active AS due_is_active
        FROM payments p
        JOIN users u ON p.owner_id = u.id
        JOIN payment_dues pd ON p.due_id = pd.id
        ORDER BY p.created_at DESC
      `,
    );

    return res.json(
      payments.map((payment) => ({
        ...payment,
        amount: formatAmount(payment.amount),
        due_is_active: Number(payment.due_is_active) === 1,
      })),
    );
  }),
);

app.put(
  '/api/admin/payments/:id/status',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { status, notes } = req.body || {};
    const allowedStatuses = new Set(['pending', 'paid', 'failed', 'cancelled', 'refunded']);
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const payment = await queryOne('SELECT id FROM payments WHERE id = ? LIMIT 1', [req.params.id]);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    await execute(
      `
        UPDATE payments
        SET status = ?, notes = ?, paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END
        WHERE id = ?
      `,
      [status, notes ? String(notes).trim() : null, status, req.params.id],
    );

    return res.json({ success: true, status });
  }),
);

app.get(
  '/api/forms',
  authenticateToken,
  asyncRoute(async (req, res) => {
    const sql =
      req.user.role === 'admin'
        ? 'SELECT * FROM forms ORDER BY created_at DESC'
        : 'SELECT * FROM forms WHERE is_published = 1 ORDER BY created_at DESC';

    const forms = await queryAll(sql);
    return res.json(
      forms.map((form) => ({
        ...form,
        schema: parseJsonField(form.schema_json, { steps: [] }),
      })),
    );
  }),
);

app.get(
  '/api/owner/payments',
  authenticateToken,
  asyncRoute(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }

    const dues = await queryAll(
      `
        SELECT pd.*
        FROM payment_dues pd
        WHERE pd.is_active = 1
           OR EXISTS (
             SELECT 1 FROM payments p WHERE p.due_id = pd.id AND p.owner_id = ?
           )
        ORDER BY pd.due_date IS NULL, pd.due_date ASC, pd.created_at DESC
      `,
      [req.user.id],
    );

    const payments = await queryAll(
      `
        SELECT p.*
        FROM payments p
        WHERE p.owner_id = ?
        ORDER BY p.updated_at DESC, p.created_at DESC
      `,
      [req.user.id],
    );

    const paymentsByDue = new Map();
    for (const payment of payments) {
      const duePayments = paymentsByDue.get(payment.due_id) || [];
      duePayments.push({
        ...payment,
        amount: formatAmount(payment.amount),
      });
      paymentsByDue.set(payment.due_id, duePayments);
    }

    return res.json(
      dues.map((due) => {
        const duePayments = paymentsByDue.get(due.id) || [];
        const latestPayment = duePayments[0] || null;
        const isPaid = duePayments.some((payment) => payment.status === 'paid');

        return {
          ...due,
          amount: formatAmount(due.amount),
          is_active: Number(due.is_active) === 1,
          is_paid: isPaid,
          latest_payment: latestPayment,
          payments: duePayments,
        };
      }),
    );
  }),
);

app.post(
  '/api/owner/payments/orders',
  authenticateToken,
  asyncRoute(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }

    if (!requireRazorpayConfig(res)) {
      return undefined;
    }

    const { due_id } = req.body || {};
    if (!due_id) {
      return res.status(400).json({ error: 'due_id is required' });
    }

    const due = await queryOne(
      'SELECT id, title, amount, currency, due_date, is_active FROM payment_dues WHERE id = ? LIMIT 1',
      [due_id],
    );
    if (!due) {
      return res.status(404).json({ error: 'Payment due not found' });
    }

    if (Number(due.is_active) !== 1) {
      return res.status(400).json({ error: 'This payment due is inactive' });
    }

    const existingPaid = await queryOne(
      "SELECT id FROM payments WHERE due_id = ? AND owner_id = ? AND status = 'paid' LIMIT 1",
      [due_id, req.user.id],
    );
    if (existingPaid) {
      return res.status(400).json({ error: 'This due has already been paid' });
    }

    const paymentId = randomUUID();
    const order = await createRazorpayOrder({
      amount: due.amount,
      currency: normalizeCurrency(due.currency),
      receipt: `due_${String(paymentId).replace(/-/g, '').slice(0, 20)}`,
      notes: {
        due_id,
        owner_id: req.user.id,
      },
    });

    await execute(
      `
        INSERT INTO payments (id, due_id, owner_id, status, amount, currency, gateway, gateway_order_id)
        VALUES (?, ?, ?, 'pending', ?, ?, 'razorpay', ?)
      `,
      [paymentId, due_id, req.user.id, due.amount, normalizeCurrency(due.currency), order.id],
    );

    return res.json({
      payment_id: paymentId,
      razorpay_key_id: RAZORPAY_KEY_ID,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      due: {
        id: due.id,
        title: due.title,
        amount: formatAmount(due.amount),
        currency: normalizeCurrency(due.currency),
      },
    });
  }),
);

app.post(
  '/api/owner/payments/verify',
  authenticateToken,
  asyncRoute(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }

    if (!requireRazorpayConfig(res)) {
      return undefined;
    }

    const { payment_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!payment_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        error: 'payment_id, razorpay_order_id, razorpay_payment_id and razorpay_signature are required',
      });
    }

    const payment = await queryOne(
      `
        SELECT p.*, pd.title AS due_title
        FROM payments p
        JOIN payment_dues pd ON pd.id = p.due_id
        WHERE p.id = ? AND p.owner_id = ?
        LIMIT 1
      `,
      [payment_id, req.user.id],
    );
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status === 'paid') {
      return res.json({ success: true, status: 'paid' });
    }

    if (payment.gateway_order_id !== razorpay_order_id) {
      return res.status(400).json({ error: 'Order mismatch' });
    }

    const duplicatePaid = await queryOne(
      "SELECT id FROM payments WHERE due_id = ? AND owner_id = ? AND status = 'paid' AND id <> ? LIMIT 1",
      [payment.due_id, req.user.id, payment.id],
    );
    if (duplicatePaid) {
      return res.status(409).json({ error: 'This due has already been paid' });
    }

    const isValidSignature = verifyRazorpaySignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!isValidSignature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    await execute(
      `
        UPDATE payments
        SET status = 'paid',
            gateway_payment_id = ?,
            gateway_signature = ?,
            failure_reason = NULL,
            paid_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [razorpay_payment_id, razorpay_signature, payment_id],
    );

    return res.json({
      success: true,
      status: 'paid',
      due_title: payment.due_title,
    });
  }),
);

app.post(
  '/api/owner/payments/:id/status',
  authenticateToken,
  asyncRoute(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }

    const { status, failure_reason } = req.body || {};
    const allowedStatuses = new Set(['failed', 'cancelled']);
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const payment = await queryOne(
      'SELECT id, status FROM payments WHERE id = ? AND owner_id = ? LIMIT 1',
      [req.params.id, req.user.id],
    );
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status === 'paid') {
      return res.status(400).json({ error: 'Paid payments cannot be changed by the owner' });
    }

    await execute(
      'UPDATE payments SET status = ?, failure_reason = ? WHERE id = ?',
      [statusLabel(status), failure_reason ? String(failure_reason).trim() : null, req.params.id],
    );

    return res.json({ success: true, status: statusLabel(status) });
  }),
);

app.get(
  '/api/forms/:id',
  authenticateToken,
  asyncRoute(async (req, res) => {
    const form = await queryOne('SELECT * FROM forms WHERE id = ? LIMIT 1', [req.params.id]);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    if (req.user.role !== 'admin' && Number(form.is_published) !== 1) {
      return res.status(403).json({ error: 'Form is not published' });
    }

    return res.json({
      ...form,
      schema: parseJsonField(form.schema_json, { steps: [] }),
    });
  }),
);

app.post(
  '/api/forms',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { title, description, schema, is_published } = req.body || {};
    if (!title || !schema) {
      return res.status(400).json({ error: 'title and schema are required' });
    }

    const id = randomUUID();
    await execute(
      'INSERT INTO forms (id, title, description, schema_json, is_published) VALUES (?, ?, ?, ?, ?)',
      [id, title, description || '', JSON.stringify(schema), is_published ? 1 : 0],
    );

    return res.json({ id });
  }),
);

app.put(
  '/api/forms/:id',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { title, description, schema, is_published } = req.body || {};
    await execute(
      'UPDATE forms SET title = ?, description = ?, schema_json = ?, is_published = ? WHERE id = ?',
      [title, description || '', JSON.stringify(schema), is_published ? 1 : 0, req.params.id],
    );
    return res.json({ success: true });
  }),
);

app.delete(
  '/api/forms/:id',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    await execute('DELETE FROM forms WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  }),
);

app.post(
  '/api/submissions',
  authenticateToken,
  asyncRoute(async (req, res) => {
    const { form_id, data } = req.body || {};
    if (!form_id) {
      return res.status(400).json({ error: 'form_id is required' });
    }

    const id = randomUUID();
    await execute('INSERT INTO submissions (id, form_id, user_id, data_json, status) VALUES (?, ?, ?, ?, ?)', [
      id,
      form_id,
      req.user.id,
      JSON.stringify(data ?? {}),
      'submitted',
    ]);

    return res.json({ id });
  }),
);

app.put(
  '/api/submissions/:id/approve',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const submission = await queryOne('SELECT id, status FROM submissions WHERE id = ? LIMIT 1', [req.params.id]);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.status === 'approved') {
      return res.json({ success: true, status: 'approved' });
    }

    await execute(
      "UPDATE submissions SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?",
      [req.user.id, req.params.id],
    );
    return res.json({ success: true, status: 'approved' });
  }),
);

app.put(
  '/api/submissions/:id/status',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { status } = req.body || {};
    const allowedStatuses = new Set(['submitted', 'in_review', 'approved', 'rejected']);
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const submission = await queryOne('SELECT id FROM submissions WHERE id = ? LIMIT 1', [req.params.id]);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (status === 'approved') {
      await execute(
        "UPDATE submissions SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ? WHERE id = ?",
        [req.user.id, req.params.id],
      );
    } else {
      await execute('UPDATE submissions SET status = ?, approved_at = NULL, approved_by = NULL WHERE id = ?', [
        status,
        req.params.id,
      ]);
    }

    return res.json({ success: true, status });
  }),
);

app.delete(
  '/api/submissions/:id',
  authenticateToken,
  requireAdmin,
  asyncRoute(async (req, res) => {
    await execute('DELETE FROM submissions WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  }),
);

app.get(
  '/api/submissions',
  authenticateToken,
  asyncRoute(async (req, res) => {
    const sql =
      req.user.role === 'admin'
        ? `
          SELECT s.*, f.title AS form_title, u.name AS user_name, u.email AS user_email
          FROM submissions s
          JOIN forms f ON s.form_id = f.id
          JOIN users u ON s.user_id = u.id
          ORDER BY s.created_at DESC
        `
        : `
          SELECT s.*, f.title AS form_title
          FROM submissions s
          JOIN forms f ON s.form_id = f.id
          WHERE s.user_id = ?
          ORDER BY s.created_at DESC
        `;

    const submissions =
      req.user.role === 'admin' ? await queryAll(sql) : await queryAll(sql, [req.user.id]);

    return res.json(
      submissions.map((submission) => ({
        ...submission,
        data: parseJsonField(submission.data_json, {}),
      })),
    );
  }),
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
