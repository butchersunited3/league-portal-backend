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
          label:
            "Managing Star Egos & Team Chemistry: Your top-performing player is a highly skilled but arrogant athlete. They are consistently winning their matches but are verbally berating their doubles partner on the court and ignoring the strategic game plans you've set. The partner is losing confidence fast. How do you intervene?",
          options: [
            'A. Bench the star player for the next match to send a clear message that team culture and respect trump individual talent',
            'B. Pull the star player aside privately and tell them to tone it down, but ultimately let them keep playing their way as long as they are securing wins',
            "C. Call a meeting with both players, mediate the conflict, and adjust the strategy to better suit the star player's aggressive style so they feel supported",
            "D. Present the star player with match data showing how their behavior is negatively impacting their partner's shot percentage, and task them with explicitly elevating their partner in the next game",
          ],
          required: true,
        },
        {
          id: 'mcq2',
          type: 'radio',
          label:
            "Managing Up and Handling Ownership: The team ownership strongly suggests drafting a specific player because they have a massive social media following and will sell a lot of merchandise. However, you have scouted this player and believe their playstyle is a terrible fit for the aggressive, fast-paced identity you are trying to build. What is your response?",
          options: [
            "A. Accept the ownership's decision without argument; they write the checks, and it's your job to figure out how to make the player work on the court",
            "B. Push back hard in the meeting, explicitly stating that drafting for marketing over winning will ruin the team's competitive credibility",
            'C. Acknowledge the marketing value, but privately present ownership with a detailed breakdown of the player\'s tactical flaws alongside a counter-proposal of three alternative players who offer both competitive edge and brand potential',
            'D. Leak your dissatisfaction to your trusted players so they are prepared to carry the extra weight on the court',
          ],
          required: true,
        },
        {
          id: 'mcq3',
          type: 'radio',
          label:
            'Crisis Management and Momentum: The team has suffered three brutal, narrow losses in a row. Morale is at rock bottom, practices are quiet and tense, and players are starting to point fingers in the locker room. You have one day of practice before a crucial tournament. How do you structure that day?',
          options: [
            'A. Cancel practice entirely and take the team out for an off-site dinner or activity to force them to bond and decompress',
            'B. Run the hardest, most physically grueling conditioning practice of the year so they are too exhausted to argue and remember what hard work feels like',
            'C. Hold a "clear the air" film session where everyone must state one thing they did wrong and one thing a teammate needs to do better',
            "D. Keep the practice light, high-energy, and completely focused on fundamental drills they excel at, ending with a fun, low-stakes competitive game to get them feeling what it's like to win again",
          ],
          required: true,
        },
        {
          id: 'mcq4',
          type: 'radio',
          label:
            'In-Game Tactical Flexibility: You are in the semi-finals. Your starting duo is playing an unorthodox team that is exploiting a strange weakness in your defense. Your team looks confused and drops the first game 11-3. You call a timeout. What is your primary message?',
          options: [
            'A. Reiterate the original game plan loudly and tell them to execute it with more intensity and better focus',
            'B. Ask the players what they are seeing on the court and let them dictate the adjustments for Game 2',
            'C. Give them one specific, concrete tactical adjustment (e.g., "Shift your baseline positioning two feet left and force them to hit inside-out") and tell them to execute only that',
            'D. Swap out one of the players immediately, sending in a substitute to drastically change the rhythm of the game',
          ],
          required: true,
        },
      ],
    },
    {
      title: 'Preview',
      id: 'review-step',
      fields: [
        {
          id: 'reviewInfo',
          type: 'info',
          content: 'Please preview your details before submitting.',
        },
      ],
    },
  ],
};

const playerFormSchema = {
  steps: [
    {
      title: 'League Rules & Guidelines',
      fields: [
        {
          id: 'guidelinesText',
          type: 'info',
          content:
            'League Rules & Guidelines\n\n' +
            '- Deadline Compliance: All required submissions must be completed on time.\n' +
            '- Fair Play: Any form of cheating, manipulation, or unfair advantage will result in immediate disqualification.\n' +
            '- Communication: Players must stay active and respond promptly in the official league group.\n' +
            '- Match Scheduling: Matches must be played within the scheduled time. Delays without valid reason may lead to penalties.\n' +
            '- Respect and Conduct: Maintain respectful behavior towards other players and organizers at all times.\n' +
            '- No Last-Minute Withdrawals: Once registered, players cannot withdraw without valid reason. Entry fee is non-refundable.\n' +
            '- Organizer Decisions: All decisions made by the organizers are final and binding.\n' +
            '- Technical Issues: Any disputes or technical issues must be reported immediately with proof.\n' +
            '- Rule Updates: Organizers reserve the right to update rules if necessary. Players will be informed.\n' +
            '- Timely Payments: All team payments must be completed before the given deadline. No exceptions.\n' +
            '- Payment value: A non-refundable fee of INR 250 + gst for registering for the auction. Once picked in the auction by a team, player needs to pay a non-refundable amount of INR 2500 + gst.',
        },
      ],
    },
    {
      title: 'Player Information',
      fields: [
        { id: 'playerPhoto', type: 'text', label: 'Player Photo (URL or drive link)', required: true },
        { id: 'fullName', type: 'text', label: 'Full Name', required: true },
        { id: 'emailId', type: 'email', label: 'Email ID', required: true },
        { id: 'mobileNumber', type: 'tel', label: 'Mobile Number', required: true },
        { id: 'dateOfBirth', type: 'text', label: 'Date of Birth', required: true },
        {
          id: 'gender',
          type: 'radio',
          label: 'Gender',
          options: ['Male', 'Female', 'Other', 'Prefer not to say'],
          required: true,
        },
        { id: 'duprId', type: 'text', label: 'DUPR ID', required: true },
        { id: 'doublesRating', type: 'text', label: 'Doubles Rating', required: true },
        { id: 'singlesRating', type: 'text', label: 'Singles Rating', required: true },
        {
          id: 'dominantHand',
          type: 'radio',
          label: 'Dominant Hand',
          options: ['Right', 'Left', 'Ambidextrous'],
          required: true,
        },
        {
          id: 'backhandStyle',
          type: 'radio',
          label: 'Backhand Style',
          options: ['One-handed', 'Two-handed', 'Not sure'],
          required: true,
        },
        {
          id: 'experienceLevel',
          type: 'select',
          label: 'Experience Level',
          options: ['Beginner', 'Intermediate', 'Advanced', 'Professional'],
          required: true,
        },
        { id: 'playingStyle', type: 'textarea', label: 'Playing Style', required: true },
        { id: 'pickleballJourney', type: 'textarea', label: 'Pickleball Journey', required: true },
        { id: 'medicalConditions', type: 'textarea', label: 'Medical Conditions', required: false },
        {
          id: 'preferredCategories',
          type: 'checkbox',
          label: 'Preferred Categories',
          options: ['Singles', 'Doubles', 'Mixed Doubles'],
          required: true,
        },
        {
          id: 'gameDayAvailability',
          type: 'textarea',
          label: 'Game Day Availability',
          required: true,
        },
        {
          id: 'declaration',
          type: 'checkbox',
          label: 'Declaration',
          options: ['I hereby declare that the information provided is true and correct.'],
          required: true,
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
      auth_provider VARCHAR(20) NOT NULL DEFAULT 'password',
      google_sub VARCHAR(255) NULL,
      email_verified_at TIMESTAMP NULL DEFAULT NULL,
      email_verification_token_hash VARCHAR(255) NULL,
      email_verification_expires_at DATETIME NULL DEFAULT NULL,
      reset_password_token_hash VARCHAR(255) NULL,
      reset_password_expires_at DATETIME NULL DEFAULT NULL,
      role ENUM('admin', 'owner', 'player') NOT NULL DEFAULT 'owner',
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
      target_role ENUM('owner', 'player', 'all') NOT NULL DEFAULT 'owner',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id CHAR(36) PRIMARY KEY,
      form_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      data_json LONGTEXT NOT NULL,
      status ENUM('submitted', 'in_review', 'approved', 'rejected') NOT NULL DEFAULT 'submitted',
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
    await pool.query(
      "ALTER TABLE submissions ADD COLUMN status ENUM('submitted', 'in_review', 'approved', 'rejected') NOT NULL DEFAULT 'submitted'",
    );
  } else {
    await pool.query(
      "ALTER TABLE submissions MODIFY COLUMN status ENUM('submitted', 'in_review', 'approved', 'rejected') NOT NULL DEFAULT 'submitted'",
    );
  }

  if (!columnNames.has('approved_at')) {
    await pool.query('ALTER TABLE submissions ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL');
  }

  if (!columnNames.has('approved_by')) {
    await pool.query('ALTER TABLE submissions ADD COLUMN approved_by CHAR(36) NULL');
  }
}

async function ensureUserColumns() {
  const [columns] = await pool.query('SHOW COLUMNS FROM users');
  const columnNames = new Set(columns.map((column) => column.Field));

  if (!columnNames.has('auth_provider')) {
    await pool.query("ALTER TABLE users ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'password' AFTER password_hash");
  }

  if (!columnNames.has('google_sub')) {
    await pool.query('ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) NULL AFTER auth_provider');
  }

  if (!columnNames.has('email_verified_at')) {
    await pool.query('ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL AFTER google_sub');
    await pool.query('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE email_verified_at IS NULL');
  }

  if (!columnNames.has('email_verification_token_hash')) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN email_verification_token_hash VARCHAR(255) NULL AFTER email_verified_at',
    );
  }

  if (!columnNames.has('email_verification_expires_at')) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN email_verification_expires_at DATETIME NULL DEFAULT NULL AFTER email_verification_token_hash',
    );
  }

  if (!columnNames.has('reset_password_token_hash')) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN reset_password_token_hash VARCHAR(255) NULL AFTER email_verification_expires_at',
    );
  }

  if (!columnNames.has('reset_password_expires_at')) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN reset_password_expires_at DATETIME NULL DEFAULT NULL AFTER reset_password_token_hash',
    );
  }

  await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'owner', 'player') NOT NULL DEFAULT 'owner'");
}

async function ensureFormColumns() {
  const [columns] = await pool.query('SHOW COLUMNS FROM forms');
  const columnNames = new Set(columns.map((column) => column.Field));

  if (!columnNames.has('target_role')) {
    await pool.query("ALTER TABLE forms ADD COLUMN target_role ENUM('owner', 'player', 'all') NOT NULL DEFAULT 'owner'");
  } else {
    await pool.query("ALTER TABLE forms MODIFY COLUMN target_role ENUM('owner', 'player', 'all') NOT NULL DEFAULT 'owner'");
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
      'INSERT INTO users (id, name, email, phone, password_hash, role, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
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
    await pool.query(
      'INSERT INTO forms (id, title, description, schema_json, is_published, target_role) VALUES (?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        'Player Expression of Interest Form',
        'Player registration and profile form.',
        JSON.stringify(playerFormSchema),
        1,
        'player',
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
        const existingQuestionnaire = steps.find((step) => step?.title === 'Pre-Registration Questionnaire');
        const starterQuestionnaire = starterFormSchema.steps.find((step) => step.title === 'Pre-Registration Questionnaire');
        const existingQuestionFields = Array.isArray(existingQuestionnaire?.fields) ? existingQuestionnaire.fields : [];
        const starterQuestionFields = Array.isArray(starterQuestionnaire?.fields) ? starterQuestionnaire.fields : [];
        const hasMatchingQuestionnaire =
          existingQuestionFields.length === starterQuestionFields.length &&
          starterQuestionFields.every((starterField, index) => {
            const existingField = existingQuestionFields[index];

            return (
              existingField?.id === starterField.id &&
              existingField?.label === starterField.label &&
              JSON.stringify(existingField?.options || []) === JSON.stringify(starterField.options || [])
            );
          });

        needsRepair =
          steps.length < starterFormSchema.steps.length ||
          !hasAllRequiredSteps ||
          !hasAllRequiredFields ||
          !hasMatchingQuestionnaire;
      } catch {
        needsRepair = true;
      }
    }

    if (needsRepair) {
      await pool.query("UPDATE forms SET schema_json = ?, target_role = 'owner' WHERE id = ?", [
        JSON.stringify(starterFormSchema),
        flagship.id,
      ]);
    }

    if (flagship && !needsRepair) {
      await pool.query("UPDATE forms SET target_role = 'owner' WHERE id = ?", [flagship.id]);
    }
  }

  const [playerRows] = await pool.query(
    "SELECT id FROM forms WHERE title = 'Player Expression of Interest Form' LIMIT 1",
  );
  if (playerRows.length === 0) {
    await pool.query(
      'INSERT INTO forms (id, title, description, schema_json, is_published, target_role) VALUES (?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        'Player Expression of Interest Form',
        'Player registration and profile form.',
        JSON.stringify(playerFormSchema),
        1,
        'player',
      ],
    );
  } else {
    await pool.query("UPDATE forms SET target_role = 'player' WHERE id = ?", [playerRows[0].id]);
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
  await ensureUserColumns();
  await ensureFormColumns();
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
