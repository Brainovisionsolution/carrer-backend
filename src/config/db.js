import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

let pool = null;
let isConnected = false;

// Initial seed candidate cohort for testing
const initialCandidates = [
  {
    id: 1,
    candidate_id: 'BV26-0001',
    password_hash: '$2b$10$w6K2Jq2QW39r3Zz0bY0Y8.aK1p4K6O0L2W5e8R1T4y7u0I3o6p9s2', // Bv@7Kp92
    name: 'Rahul Kumar',
    email: 'rahul@gmail.com',
    phone: '9849012345',
    college: 'ABC Engineering College',
    branch: 'CSE',
    graduation_year: '2026',
    position: 'Graduate Trainee',
    status: 'INVITED',
    violations_count: 0,
    interview_status: 'NOT_SCHEDULED',
    email_sent: true,
  },
  {
    id: 2,
    candidate_id: 'BV26-0002',
    password_hash: '$2b$10$w6K2Jq2QW39r3Zz0bY0Y8.aK1p4K6O0L2W5e8R1T4y7u0I3o6p9s2', // Bv@4Xm81
    name: 'Priya Reddy',
    email: 'priya@gmail.com',
    phone: '9701123456',
    college: 'ABC Engineering College',
    branch: 'ECE',
    graduation_year: '2026',
    position: 'Graduate Trainee',
    status: 'INVITED',
    violations_count: 0,
    interview_status: 'NOT_SCHEDULED',
    email_sent: true,
  },
  {
    id: 3,
    candidate_id: 'BV26-0003',
    password_hash: '$2b$10$w6K2Jq2QW39r3Zz0bY0Y8.aK1p4K6O0L2W5e8R1T4y7u0I3o6p9s2', // Bv@9Lt33
    name: 'Arjun Reddy',
    email: 'arjun@gmail.com',
    phone: '9988112233',
    college: 'Vasavi College of Engineering',
    branch: 'IT',
    graduation_year: '2026',
    position: 'Graduate Trainee',
    status: 'INVITED',
    violations_count: 0,
    interview_status: 'NOT_SCHEDULED',
    email_sent: true,
  },
  {
    id: 4,
    candidate_id: 'BV26-0004',
    password_hash: '$2b$10$w6K2Jq2QW39r3Zz0bY0Y8.aK1p4K6O0L2W5e8R1T4y7u0I3o6p9s2', // Bv@2Wq77
    name: 'Sneha Rao',
    email: 'sneha@gmail.com',
    phone: '9848123987',
    college: 'Chaitanya Bharathi Institute of Technology',
    branch: 'CSE',
    graduation_year: '2026',
    position: 'Graduate Trainee',
    status: 'INVITED',
    violations_count: 0,
    interview_status: 'NOT_SCHEDULED',
    email_sent: true,
  },
];

import { SEED_QUESTIONS } from '../data/questionsData.js';

let memoryStore = {
  candidates: [...initialCandidates],
  questions: [...SEED_QUESTIONS],
  attempts: [],
  answers: [],
  securityEvents: [],
  emailLogs: [],
  interviews: [],
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
      console.log('✓ MySQL 8.0 connection pool successfully established to database:', process.env.DB_NAME || 'brainovision_careers');
      conn.release();
    })
    .catch((err) => {
      console.warn('⚠ MySQL Connection Notice:', err.message);
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
