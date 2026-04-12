import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'readysetleague',
};

let pool;

const starterFormSchema = {
  steps: [
    {
      title: 'Guidelines Acceptance',
      fields: [
        {
          id: 'guidelinesText',
          type: 'info',
          content:
            'League Rules & Guidelines\n\n' +
            '- Timely Payments: All team payments must be completed before the given deadline. No exceptions.\n' +
            '- Deadline Compliance: All required submissions (team details, logos, lineups, etc.) must be completed on time.\n' +
            '- Fair Play: Any form of cheating, manipulation, or unfair advantage will result in immediate disqualification.\n' +
            '- Communication: Team owners must stay active and respond promptly in the official league group.\n' +
            '- Match Scheduling: Matches must be played within the scheduled time. Delays without valid reason may lead to penalties.\n' +
            '- Respect and Conduct: Maintain respectful behavior towards other players and organizers at all times.\n' +
            '- No Last-Minute Withdrawals: Once registered, teams cannot withdraw without valid reason. Entry fee is non-refundable.\n' +
            '- Organizer Decisions: All decisions made by the organizers are final and binding.\n' +
            '- Technical Issues: Any disputes or technical issues must be reported immediately with proof.\n' +
            '- Rule Updates: Organizers reserve the right to update rules if necessary. Participants will be informed.',
        },
        {
          id: 'acceptGuidelines',
          type: 'checkbox',
          label: 'I have read and accept the League Rules & Guidelines',
          options: ['I accept'],
          required: true,
        },
      ],
    },
    {
      title: 'Basic Details',
      fields: [
        { id: 'teamName', type: 'text', label: 'Team Name', required: true },
        { id: 'ownerName', type: 'text', label: 'Owner Name', required: true },
        { id: 'coOwnerName', type: 'text', label: 'Co-Owner Name (if any)', required: false },
        { id: 'contactNumber', type: 'tel', label: 'Contact Number', required: true },
        { id: 'whatsappNumber', type: 'tel', label: 'WhatsApp Number', required: true },
        { id: 'emailId', type: 'email', label: 'Email ID (optional)', required: false },
      ],
    },
    {
      title: 'Pre-Registration Questionnaire',
      fields: [
        {
          id: 'mcq1',
          type: 'radio',
          label: "Your team is losing badly, and you're personally having a poor game. What do you do?",
          options: [
            'A. Keep pushing myself and encourage teammates to stay focused',
            'B. Focus only on fixing my own mistakes quietly',
            'C. Feel frustrated and wait for the game to end',
            'D. Try riskier plays to quickly change the outcome',
          ],
          required: true,
        },
        {
          id: 'mcq2',
          type: 'radio',
          label: 'Your coach gives you critical feedback after a match. How do you react?',
          options: [
            'A. Listen carefully and actively work on it in training',
            'B. Accept it but only apply what I agree with',
            'C. Feel discouraged but try to improve later',
            'D. Disagree internally and stick to my style',
          ],
          required: true,
        },
        {
          id: 'mcq3',
          type: 'radio',
          label: 'A teammate blames you unfairly during a game. What is your response?',
          options: [
            'A. Stay calm and focus on the game, address it later',
            'B. Respond immediately to defend myself',
            'C. Ignore it completely and avoid the teammate',
            'D. Let it affect my performance',
          ],
          required: true,
        },
        {
          id: 'mcq4',
          type: 'radio',
          label:
            'In a doubles pickleball match, you receive a high ball that you can smash, but your partner is in a better position for an easier winner. What do you do?',
          options: [
            'A. Smash the ball to try and finish the point myself',
            'B. Let or guide the ball to my partner for a higher-percentage shot',
            'C. Decide in the moment based on positioning and opponents',
            'D. Hesitate, causing confusion and possibly losing the point',
          ],
          required: true,
        },
      ],
    },
    {
      title: 'Review & Submit',
      id: 'review-step',
      fields: [
        {
          id: 'reviewInfo',
          type: 'info',
          content: 'Please verify details before submitting.',
        },
      ],
    },
  ],
};

async function ensureDatabase() {
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.end();
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(25) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'owner') NOT NULL DEFAULT 'owner',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS forms (
      id CHAR(36) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      schema_json LONGTEXT NOT NULL,
      is_published TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id CHAR(36) PRIMARY KEY,
      form_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      data_json LONGTEXT NOT NULL,
      status ENUM('submitted', 'in_review', 'approved') NOT NULL DEFAULT 'submitted',
      approved_at TIMESTAMP NULL DEFAULT NULL,
      approved_by CHAR(36) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_submissions_form FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
      CONSTRAINT fk_submissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_dues (
      id CHAR(36) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      amount DECIMAL(10, 2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      due_date DATETIME NULL DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by CHAR(36) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_payment_dues_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id CHAR(36) PRIMARY KEY,
      due_id CHAR(36) NOT NULL,
      owner_id CHAR(36) NOT NULL,
      status ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending',
      amount DECIMAL(10, 2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay',
      gateway_order_id VARCHAR(255) NULL,
      gateway_payment_id VARCHAR(255) NULL,
      gateway_signature VARCHAR(255) NULL,
      paid_at TIMESTAMP NULL DEFAULT NULL,
      failure_reason TEXT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_payments_due FOREIGN KEY (due_id) REFERENCES payment_dues(id) ON DELETE CASCADE,
      CONSTRAINT fk_payments_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

async function ensureSubmissionColumns() {
  const [columns] = await pool.query('SHOW COLUMNS FROM submissions');
  const columnNames = new Set(columns.map((column) => column.Field));

  if (!columnNames.has('status')) {
    await pool.query("ALTER TABLE submissions ADD COLUMN status ENUM('submitted', 'in_review', 'approved') NOT NULL DEFAULT 'submitted'");
  } else {
    await pool.query(
      "ALTER TABLE submissions MODIFY COLUMN status ENUM('submitted', 'in_review', 'approved') NOT NULL DEFAULT 'submitted'",
    );
  }

  if (!columnNames.has('approved_at')) {
    await pool.query('ALTER TABLE submissions ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL');
  }

  if (!columnNames.has('approved_by')) {
    await pool.query('ALTER TABLE submissions ADD COLUMN approved_by CHAR(36) NULL');
  }
}

async function ensurePaymentDueColumns() {
  const [columns] = await pool.query('SHOW COLUMNS FROM payment_dues');
  const columnNames = new Set(columns.map((column) => column.Field));

  if (!columnNames.has('description')) {
    await pool.query('ALTER TABLE payment_dues ADD COLUMN description TEXT NULL');
  }

  if (!columnNames.has('amount')) {
    await pool.query("ALTER TABLE payment_dues ADD COLUMN amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00");
  } else {
    await pool.query('ALTER TABLE payment_dues MODIFY COLUMN amount DECIMAL(10, 2) NOT NULL');
  }

  if (!columnNames.has('currency')) {
    await pool.query("ALTER TABLE payment_dues ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'INR'");
  }

  if (!columnNames.has('due_date')) {
    await pool.query('ALTER TABLE payment_dues ADD COLUMN due_date DATETIME NULL DEFAULT NULL');
  }

  if (!columnNames.has('is_active')) {
    await pool.query('ALTER TABLE payment_dues ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
  }

  if (!columnNames.has('created_by')) {
    await pool.query('ALTER TABLE payment_dues ADD COLUMN created_by CHAR(36) NULL');
  }
}

async function ensurePaymentColumns() {
  const [columns] = await pool.query('SHOW COLUMNS FROM payments');
  const columnNames = new Set(columns.map((column) => column.Field));

  if (!columnNames.has('status')) {
    await pool.query(
      "ALTER TABLE payments ADD COLUMN status ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending'",
    );
  } else {
    await pool.query(
      "ALTER TABLE payments MODIFY COLUMN status ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending'",
    );
  }

  if (!columnNames.has('amount')) {
    await pool.query("ALTER TABLE payments ADD COLUMN amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00");
  } else {
    await pool.query('ALTER TABLE payments MODIFY COLUMN amount DECIMAL(10, 2) NOT NULL');
  }

  if (!columnNames.has('currency')) {
    await pool.query("ALTER TABLE payments ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'INR'");
  }

  if (!columnNames.has('gateway')) {
    await pool.query("ALTER TABLE payments ADD COLUMN gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay'");
  }

  if (!columnNames.has('gateway_order_id')) {
    await pool.query('ALTER TABLE payments ADD COLUMN gateway_order_id VARCHAR(255) NULL');
  }

  if (!columnNames.has('gateway_payment_id')) {
    await pool.query('ALTER TABLE payments ADD COLUMN gateway_payment_id VARCHAR(255) NULL');
  }

  if (!columnNames.has('gateway_signature')) {
    await pool.query('ALTER TABLE payments ADD COLUMN gateway_signature VARCHAR(255) NULL');
  }

  if (!columnNames.has('paid_at')) {
    await pool.query('ALTER TABLE payments ADD COLUMN paid_at TIMESTAMP NULL DEFAULT NULL');
  }

  if (!columnNames.has('failure_reason')) {
    await pool.query('ALTER TABLE payments ADD COLUMN failure_reason TEXT NULL');
  }

  if (!columnNames.has('notes')) {
    await pool.query('ALTER TABLE payments ADD COLUMN notes TEXT NULL');
  }

  if (!columnNames.has('updated_at')) {
    await pool.query(
      'ALTER TABLE payments ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
  }
}

async function seedDefaults() {
  const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@pickleball.com';
  const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

  const [adminRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [defaultAdminEmail]);
  if (adminRows.length === 0) {
    const adminId = randomUUID();
    const passwordHash = await bcrypt.hash(defaultAdminPassword, 10);
    await pool.query(
      'INSERT INTO users (id, name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
      [adminId, 'League Admin', defaultAdminEmail, '555-0100', passwordHash, 'admin'],
    );
  }

  const [formRows] = await pool.query('SELECT COUNT(*) AS count FROM forms');
  if (Number(formRows[0].count) === 0) {
    await pool.query(
      'INSERT INTO forms (id, title, description, schema_json, is_published) VALUES (?, ?, ?, ?, ?)',
      [
        randomUUID(),
        'Team Owner Expression of Interest Form',
        'Flagship multi-step form for new team owners.',
        JSON.stringify(starterFormSchema),
        1,
      ],
    );
  } else {
    // Auto-repair only if the flagship form schema is incomplete.
    const [flagshipRows] = await pool.query(
      "SELECT id, schema_json FROM forms WHERE title = 'Team Owner Expression of Interest Form' LIMIT 1",
    );
    const flagship = flagshipRows[0];
    let needsRepair = false;

    if (flagship) {
      try {
        const parsedSchema = JSON.parse(flagship.schema_json || '{}');
        const steps = Array.isArray(parsedSchema?.steps) ? parsedSchema.steps : [];
        const titles = new Set(steps.map((step) => step?.title).filter(Boolean));
        const requiredStepTitles = new Set(starterFormSchema.steps.map((step) => step.title));
        const hasAllRequiredSteps = [...requiredStepTitles].every((title) => titles.has(title));
        const fieldIds = new Set(steps.flatMap((step) => step?.fields || []).map((field) => field?.id).filter(Boolean));
        const requiredFieldIds = ['acceptGuidelines', 'teamName', 'ownerName', 'contactNumber', 'mcq1', 'mcq2', 'mcq3', 'mcq4'];
        const hasAllRequiredFields = requiredFieldIds.every((id) => fieldIds.has(id));

        needsRepair =
          steps.length < starterFormSchema.steps.length || !hasAllRequiredSteps || !hasAllRequiredFields;
      } catch {
        needsRepair = true;
      }
    }

    if (needsRepair) {
      await pool.query("UPDATE forms SET schema_json = ? WHERE id = ?", [
        JSON.stringify(starterFormSchema),
        flagship.id,
      ]);
    }
  }
}

export async function initDatabase() {
  await ensureDatabase();
  pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await createTables();
  await ensureSubmissionColumns();
  await ensurePaymentDueColumns();
  await ensurePaymentColumns();
  await seedDefaults();
}

function assertPool() {
  if (!pool) {
    throw new Error('Database pool is not initialized');
  }
}

export async function queryAll(sql, params = []) {
  assertPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

export async function execute(sql, params = []) {
  assertPool();
  const [result] = await pool.execute(sql, params);
  return result;
}
