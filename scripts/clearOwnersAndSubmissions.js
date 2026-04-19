import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'readysetleague',
};

async function main() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    await connection.beginTransaction();

    const [submissionResult] = await connection.execute(
      'DELETE FROM submissions',
    );

    const [ownerResult] = await connection.execute(
      "DELETE FROM users WHERE role = 'owner'",
    );

    await connection.commit();

    console.log(`Deleted submissions: ${submissionResult.affectedRows}`);
    console.log(`Deleted owners: ${ownerResult.affectedRows}`);
    console.log('Cleanup completed successfully.');
  } catch (error) {
    await connection.rollback();
    console.error('Cleanup failed. Rolled back transaction.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main();
