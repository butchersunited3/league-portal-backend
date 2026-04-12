import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { execute, initDatabase, queryAll, queryOne } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());

function createToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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
      'INSERT INTO users (id, name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
      [id, String(name).trim(), normalizedEmail, String(phone).trim(), passwordHash, role],
    );

    const user = { id, name: String(name).trim(), email: normalizedEmail, role };
    return res.json({ token: createToken(user), user });
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

    const isMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
    return res.json({ token: createToken(payload), user: payload });
  }),
);

app.get(
  '/api/auth/me',
  authenticateToken,
  asyncRoute(async (req, res) => {
    const user = await queryOne('SELECT id, name, email, phone, role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(user);
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
    const approvedOwners = await queryAll(
      `
        SELECT 
          s.id AS submission_id,
          s.form_id,
          s.created_at AS submitted_at,
          s.approved_at,
          u.id AS user_id,
          u.name,
          u.email,
          u.phone,
          f.title AS form_title,
          s.data_json
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        JOIN forms f ON s.form_id = f.id
        WHERE s.status = 'approved'
        ORDER BY s.approved_at DESC, s.created_at DESC
      `,
    );
    return res.json(
      approvedOwners.map((owner) => ({
        ...owner,
        data: parseJsonField(owner.data_json, {}),
      })),
    );
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
    const allowedStatuses = new Set(['submitted', 'in_review', 'approved']);
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
