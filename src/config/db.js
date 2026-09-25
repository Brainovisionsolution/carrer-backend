import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

let pool = null;
let isConnected = false;

import { SEED_QUESTIONS } from '../data/questionsData.js';

// Initial clean store - No sample or dummy records. All candidate data and questions are dynamically managed by administrators.
let memoryStore = {
  candidates: [],
  questions: [...SEED_QUESTIONS],
  attempts: [],
  answers: [],
  securityEvents: [],
  emailLogs: [],
  interviews: [],
  assessmentConfig: {
    id: 'campus-2026-phase1',
    title: 'Brainovision Campus Recruitment Assessment — 2026',
    durationMinutes: 45,
    passingPercentage: 60,
    totalQuestions: 40,
    marksPerQuestion: 1,
    negativeMarking: false,
    negativeMarkPenalty: 0.25,
    maxTabSwitches: 2,
    maxFullscreenExits: 2,
    securityLevel: 'strict',
    sections: [
      { id: 'aptitude', title: 'Quantitative Aptitude', count: 15 },
      { id: 'reasoning', title: 'Logical Reasoning', count: 10 },
      { id: 'verbal', title: 'Verbal Ability', count: 10 },
      { id: 'technical', title: 'Technical Core', count: 5 },
    ],
  },
  admins: [
    {
      id: 1,
      email: 'admin@brainovision.in',
      password_hash: '$2b$10$w6K2Jq2QW39r3Zz0bY0Y8.aK1p4K6O0L2W5e8R1T4y7u0I3o6p9s2', // Admin@Bv2026!
      full_name: 'Brainovision Talent Acquisition',
      role: 'SUPER_ADMIN',
    },
  ],
};


try {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'brainovision_careers',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });

  // Test connection
  pool.getConnection()
    .then((conn) => {
      isConnected = true;
      console.log('[OK] MySQL 8.0 connection pool successfully established to database:', process.env.DB_NAME || 'brainovision_careers');
      conn.release();
    })
    .catch((err) => {
      console.warn('[WARN] MySQL Connection Notice:', err.message);
      console.warn('  Ensure MySQL80 is running and credentials in backend/.env match.');
    });
} catch (err) {
  console.warn('MySQL pool initialization error:', err.message);
}

export async function query(sql, params = []) {
  if (pool && isConnected) {
    try {
      const [results] = await pool.query(sql, params);
      return results;
    } catch (err) {
      console.error('MySQL query execution error:', err.message, 'SQL:', sql);
      throw err;
    }
  }
  return null;
}

export function isDbConnected() {
  return isConnected;
}

export { pool, memoryStore };
