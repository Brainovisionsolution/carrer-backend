import bcrypt from 'bcryptjs';
import xlsx from 'xlsx';
import { query, memoryStore, isDbConnected } from '../config/db.js';
import { sendCandidateCredentialsEmail } from '../services/emailService.js';

export async function getDashboardKpis(req, res) {
  try {
    let candidates = [];
    if (isDbConnected()) {
      candidates = await query(`SELECT status, violations_count FROM candidates`);
    } else {
      candidates = memoryStore.candidates;
    }

    const registered = candidates.length;
    const started = candidates.filter((c) => c.status !== 'INVITED').length;
    const cleared = candidates.filter((c) => c.status === 'CLEARED').length;
    const notQualified = candidates.filter((c) => c.status === 'NOT_QUALIFIED').length;
    const terminated = candidates.filter((c) => c.status === 'TERMINATED').length;
    const inProgress = candidates.filter((c) => c.status === 'IN_PROGRESS').length;
    const completed = candidates.filter((c) => ['COMPLETED', 'CLEARED', 'NOT_QUALIFIED', 'TERMINATED'].includes(c.status)).length;
    const invited = candidates.filter((c) => c.status === 'INVITED').length;

    return res.status(200).json({
      success: true,
      kpis: {
        registered,
        started,
        inProgress,
        completed,
        cleared,
        notQualified,
        terminated,
        invited,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getCandidates(req, res) {
  try {
    const { status, search } = req.query;

    if (isDbConnected()) {
      let sql = `
        SELECT c.*, 
               att.score, att.total_marks, att.percentage, att.id as attempt_id,
               i.status as interview_status_live, i.interview_date, i.interview_time
        FROM candidates c
        LEFT JOIN attempts att ON att.candidate_id = c.id
        LEFT JOIN interviews i ON i.candidate_id = c.id
        WHERE 1=1
      `;
      const params = [];

      if (status && status !== 'All') {
        sql += ` AND c.status = ?`;
        params.push(status.toUpperCase());
      }

      if (search) {
        sql += ` AND (c.name LIKE ? OR c.candidate_id LIKE ? OR c.college LIKE ? OR c.email LIKE ?)`;
        const q = `%${search}%`;
        params.push(q, q, q, q);
      }

      sql += ` ORDER BY c.id DESC`;

      const rows = await query(sql, params);
      return res.status(200).json({ success: true, count: rows.length, candidates: rows });
    }

    let rows = memoryStore.candidates.map((c) => {
      const att = memoryStore.attempts.find((a) => a.candidate_id === c.id);
      const intv = memoryStore.interviews.find((i) => i.candidate_id === c.id);
      return {
        ...c,
        score: att ? att.score : 0,
        total_marks: att ? att.total_marks : 40,
        percentage: att ? att.percentage : 0,
        attempt_id: att ? att.id : null,
        interview_status_live: intv ? intv.status : (c.interview_status || 'NOT_SCHEDULED'),
        interview_date: intv?.interview_date,
        interview_time: intv?.interview_time,
      };
    });

    if (status && status !== 'All') {
      rows = rows.filter((c) => c.status.toUpperCase() === status.toUpperCase());
    }

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.candidate_id.toLowerCase().includes(q) ||
          c.college.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
      );
    }

    return res.status(200).json({ success: true, count: rows.length, candidates: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getCandidateDossier(req, res) {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      const candidates = await query(`SELECT * FROM candidates WHERE id = ? OR candidate_id = ?`, [id, id]);
      if (!candidates || candidates.length === 0) {
        return res.status(404).json({ success: false, message: 'Candidate not found.' });
      }
      const candidate = candidates[0];

      // Fetch attempt and result
      const attempts = await query(
        `SELECT a.*, r.section_scores_json 
         FROM attempts a 
         LEFT JOIN results r ON r.attempt_id = a.id 
         WHERE a.candidate_id = ? 
         ORDER BY a.id DESC LIMIT 1`,
        [candidate.id]
      );
      const attempt = attempts[0] || null;

      // Fetch proctoring security events
      const securityEvents = await query(
        `SELECT * FROM security_events WHERE candidate_id = ? ORDER BY created_at ASC`,
        [candidate.id]
      );

      // Fetch email logs
      const emailLogs = await query(
        `SELECT * FROM email_logs WHERE candidate_id = ? ORDER BY sent_at DESC`,
        [candidate.id]
      );

      // Fetch interview if scheduled
      const interviews = await query(
        `SELECT * FROM interviews WHERE candidate_id = ? ORDER BY id DESC LIMIT 1`,
        [candidate.id]
      );

      return res.status(200).json({
        success: true,
        candidate,
        attempt,
        securityEvents,
        emailLogs,
        interview: interviews[0] || null,
      });
    }

    const candidate = memoryStore.candidates.find((c) => String(c.id) === String(id) || c.candidate_id === id);
    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Candidate not found.' });
    }

    const attempt = memoryStore.attempts.find((a) => a.candidate_id === candidate.id) || null;
    const securityEvents = memoryStore.securityEvents.filter((e) => e.candidate_id === candidate.id);
    const emailLogs = memoryStore.emailLogs.filter((e) => e.candidate_id === candidate.id);
    const interview = memoryStore.interviews.find((i) => i.candidate_id === candidate.id) || null;

    return res.status(200).json({
      success: true,
      candidate,
      attempt,
      securityEvents,
      emailLogs,
      interview,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Bulk student data import
export async function importCandidates(req, res) {
  try {
    let records = [];

    // Check if Excel/CSV file was uploaded via multer
    if (req.file) {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      records = xlsx.utils.sheet_to_json(sheet);
    } else if (req.body.students && Array.isArray(req.body.students)) {
      records = req.body.students;
    } else {
      return res.status(400).json({
        success: false,
        message: 'No candidate file or student records provided.',
      });
    }

    if (records.length === 0) {
      return res.status(400).json({ success: false, message: 'Empty dataset provided.' });
    }

    // Validation & duplicate detection
    const existingEmails = new Set();
    if (isDbConnected()) {
      const dbEmails = await query(`SELECT email FROM candidates`);
      dbEmails.forEach((r) => existingEmails.add(r.email.toLowerCase().trim()));
    } else {
      memoryStore.candidates.forEach((r) => existingEmails.add(r.email.toLowerCase().trim()));
    }

    const seenInBatch = new Set();
    let duplicates = 0;
    let invalid = 0;
    const validRecords = [];

    // Determine starting index for Candidate ID generation
    let nextIndex = 1;
    if (isDbConnected()) {
      const maxRow = await query(`SELECT COUNT(*) as count FROM candidates`);
      nextIndex = (maxRow[0]?.count || 0) + 1;
    } else {
      nextIndex = memoryStore.candidates.length + 1;
    }

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

    for (const row of records) {
      const name = (row.name || row.Name || '').trim();
      const email = (row.email || row.Email || '').toLowerCase().trim();
      const phone = String(row.phone || row.Phone || '').trim();
      const college = (row.college || row.College || '').trim();
      const branch = (row.branch || row.Branch || '').trim();
      const graduationYear = String(row.graduation_year || row.GraduationYear || '2026').trim();
      const position = (row.position || row.Position || 'Graduate Trainee').trim();

      if (!name || !email || !college || !branch) {
        invalid++;
        continue;
      }

      // Check duplicates
      if (existingEmails.has(email) || seenInBatch.has(email)) {
        duplicates++;
        continue;
      }

      seenInBatch.add(email);

      // Generate Candidate ID: BV26-0001
      const pad = String(nextIndex).padStart(4, '0');
      const candidateId = `BV26-${pad}`;

      // Generate secure temporary password
      let tempPassword = 'Bv@';
      for (let i = 0; i < 5; i++) {
        tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      tempPassword += '#';

      // Hash password with bcrypt
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      validRecords.push({
        candidate_id: candidateId,
        password_hash: passwordHash,
        temp_password_plain: tempPassword,
        name,
        email,
        phone,
        college,
        branch,
        graduation_year: graduationYear,
        position,
      });

      nextIndex++;
    }

    // Insert into MySQL or memory store
    if (isDbConnected() && validRecords.length > 0) {
      for (const cand of validRecords) {
        await query(
          `INSERT INTO candidates (candidate_id, password_hash, name, email, phone, college, branch, graduation_year, position, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INVITED')`,
          [
            cand.candidate_id,
            cand.password_hash,
            cand.name,
            cand.email,
            cand.phone,
            cand.college,
            cand.branch,
            cand.graduation_year,
            cand.position,
          ]
        );
      }
    } else if (validRecords.length > 0) {
      for (const cand of validRecords) {
        memoryStore.candidates.push({
          id: memoryStore.candidates.length + 1,
          candidate_id: cand.candidate_id,
          password_hash: cand.password_hash,
          temp_password_plain: cand.temp_password_plain,
          name: cand.name,
          email: cand.email,
          phone: cand.phone,
          college: cand.college,
          branch: cand.branch,
          graduation_year: cand.graduation_year,
          position: cand.position,
          status: 'INVITED',
          violations_count: 0,
          interview_status: 'NOT_SCHEDULED',
          email_sent: false,
        });
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        totalDetected: records.length,
        validImported: validRecords.length,
        duplicateEmails: duplicates,
        invalidRecords: invalid,
      },
      importedSample: validRecords.slice(0, 5).map((r) => ({
        candidateId: r.candidate_id,
        name: r.name,
        email: r.email,
        college: r.college,
        branch: r.branch,
      })),
    });
  } catch (err) {
    console.error('importCandidates error:', err);
    return res.status(500).json({ success: false, message: 'Failed to import candidates.', error: err.message });
  }
}

// Bulk credential dispatch via Nodemailer
export async function sendCredentials(req, res) {
  try {
    const { candidateIds } = req.body; // array of candidate IDs or empty for all unsent

    let candidatesToSend = [];
    if (isDbConnected()) {
      if (candidateIds && candidateIds.length > 0) {
        candidatesToSend = await query(
          `SELECT * FROM candidates WHERE candidate_id IN (?)`,
          [candidateIds]
        );
      } else {
        candidatesToSend = await query(
          `SELECT * FROM candidates WHERE email_sent = FALSE OR status = 'INVITED'`
        );
      }
    } else {
      if (candidateIds && candidateIds.length > 0) {
        candidatesToSend = memoryStore.candidates.filter((c) => candidateIds.includes(c.candidate_id));
      } else {
        candidatesToSend = memoryStore.candidates.filter((c) => !c.email_sent || c.status === 'INVITED');
      }
    }

    let sentCount = 0;
    for (const cand of candidatesToSend) {
      // Send official email with standard temporary password format
      const tempPwd = cand.temp_password_plain || `Bv@${cand.candidate_id.replace('-', '')}#`;
      await sendCandidateCredentialsEmail(cand, tempPwd);
      cand.email_sent = true;
      sentCount++;
    }

    return res.status(200).json({
      success: true,
      message: `Dispatched official credentials to ${sentCount} candidates from hiring@brainovision.in.`,
      dispatchedCount: sentCount,
    });
  } catch (err) {
    console.error('sendCredentials error:', err);
    return res.status(500).json({ success: false, message: 'Credential dispatch failed.', error: err.message });
  }
}

// Schedule interview for cleared candidate
export async function scheduleInterview(req, res) {
  try {
    const { candidateId, interviewDate, interviewTime, interviewerName, meetingLink, notes } = req.body;

    if (!candidateId || !interviewDate || !interviewTime) {
      return res.status(400).json({ success: false, message: 'Candidate, date, and time are required.' });
    }

    if (isDbConnected()) {
      const candRows = await query(`SELECT id FROM candidates WHERE id = ? OR candidate_id = ?`, [candidateId, candidateId]);
      if (!candRows || candRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Candidate not found.' });
      }
      const cId = candRows[0].id;

      await query(
        `INSERT INTO interviews (candidate_id, interview_date, interview_time, interviewer_name, meeting_link, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED')
         ON DUPLICATE KEY UPDATE
           interview_date = VALUES(interview_date),
           interview_time = VALUES(interview_time),
           interviewer_name = VALUES(interviewer_name),
           meeting_link = VALUES(meeting_link),
           notes = VALUES(notes),
           status = 'SCHEDULED'`,
        [cId, interviewDate, interviewTime, interviewerName || 'Technical Panel Lead', meetingLink || 'https://meet.google.com/bov-tech-2026', notes || '']
      );

      await query(`UPDATE candidates SET interview_status = 'SCHEDULED' WHERE id = ?`, [cId]);
    } else {
      const cand = memoryStore.candidates.find((c) => String(c.id) === String(candidateId) || c.candidate_id === candidateId);
      if (!cand) {
        return res.status(404).json({ success: false, message: 'Candidate not found.' });
      }
      cand.interview_status = 'SCHEDULED';
      const existingIntv = memoryStore.interviews.find((i) => i.candidate_id === cand.id);
      if (existingIntv) {
        existingIntv.interview_date = interviewDate;
        existingIntv.interview_time = interviewTime;
        existingIntv.interviewer_name = interviewerName || 'Technical Panel Lead';
        existingIntv.meeting_link = meetingLink || 'https://meet.google.com/bov-tech-2026';
        existingIntv.notes = notes || '';
        existingIntv.status = 'SCHEDULED';
      } else {
        memoryStore.interviews.push({
          id: memoryStore.interviews.length + 1,
          candidate_id: cand.id,
          interview_date: interviewDate,
          interview_time: interviewTime,
          interviewer_name: interviewerName || 'Technical Panel Lead',
          meeting_link: meetingLink || 'https://meet.google.com/bov-tech-2026',
          notes: notes || '',
          status: 'SCHEDULED',
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Interview successfully scheduled and candidate status updated.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Question Bank CRUD
export async function getQuestions(req, res) {
  try {
    const { section, difficulty } = req.query;
    if (isDbConnected()) {
      let sql = `SELECT * FROM questions WHERE status = 'ACTIVE'`;
      const params = [];
      if (section) {
        sql += ` AND section = ?`;
        params.push(section);
      }
      if (difficulty) {
        sql += ` AND difficulty = ?`;
        params.push(difficulty);
      }
      sql += ` ORDER BY id ASC`;
      const rows = await query(sql, params);
      return res.status(200).json({ success: true, count: rows.length, questions: rows });
    }

    let qs = [...memoryStore.questions];
    if (section) qs = qs.filter((q) => q.section === section);
    if (difficulty) qs = qs.filter((q) => q.difficulty === difficulty);
    return res.status(200).json({ success: true, count: qs.length, questions: qs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function createQuestion(req, res) {
  try {
    const { section, questionText, optionA, optionB, optionC, optionD, correctOption, difficulty, marks, explanation } = req.body;

    if (!section || !questionText || !optionA || !optionB || !correctOption) {
      return res.status(400).json({ success: false, message: 'Section, question text, options, and correct option are required.' });
    }

    if (isDbConnected()) {
      const ins = await query(
        `INSERT INTO questions (section, question_text, option_a, option_b, option_c, option_d, correct_option, difficulty, marks, explanation, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [section, questionText, optionA, optionB, optionC || '', optionD || '', correctOption.toUpperCase(), difficulty || 'medium', marks || 1, explanation || '']
      );
      return res.status(201).json({ success: true, questionId: ins.insertId });
    }

    const newQ = {
      id: memoryStore.questions.length + 1,
      section,
      question_text: questionText,
      option_a: optionA,
      option_b: optionB,
      option_c: optionC || '',
      option_d: optionD || '',
      correct_option: correctOption.toUpperCase(),
      difficulty: difficulty || 'medium',
      marks: marks || 1,
      explanation: explanation || '',
      status: 'ACTIVE',
    };
    memoryStore.questions.push(newQ);
    return res.status(201).json({ success: true, questionId: newQ.id, question: newQ });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateQuestion(req, res) {
  try {
    const { id } = req.params;
    const { section, questionText, optionA, optionB, optionC, optionD, correctOption, difficulty, marks, explanation } = req.body;

    if (!questionText || !optionA || !optionB) {
      return res.status(400).json({ success: false, message: 'Question text and options A and B are required.' });
    }

    if (isDbConnected()) {
      await query(
        `UPDATE questions 
         SET section = COALESCE(?, section),
             question_text = COALESCE(?, question_text),
             option_a = COALESCE(?, option_a),
             option_b = COALESCE(?, option_b),
             option_c = COALESCE(?, option_c),
             option_d = COALESCE(?, option_d),
             correct_option = COALESCE(?, correct_option),
             difficulty = COALESCE(?, difficulty),
             marks = COALESCE(?, marks),
             explanation = COALESCE(?, explanation)
         WHERE id = ?`,
        [section, questionText, optionA, optionB, optionC || '', optionD || '', (correctOption || 'A').toUpperCase(), difficulty || 'medium', marks || 1, explanation || '', id]
      );
    }

    // Also update in memoryStore
    const idx = memoryStore.questions.findIndex((q) => String(q.id) === String(id));
    if (idx !== -1) {
      memoryStore.questions[idx] = {
        ...memoryStore.questions[idx],
        section: section || memoryStore.questions[idx].section,
        question_text: questionText,
        option_a: optionA,
        option_b: optionB,
        option_c: optionC || '',
        option_d: optionD || '',
        correct_option: (correctOption || memoryStore.questions[idx].correct_option || 'A').toUpperCase(),
        difficulty: difficulty || memoryStore.questions[idx].difficulty,
        marks: marks ? Number(marks) : memoryStore.questions[idx].marks,
        explanation: explanation !== undefined ? explanation : memoryStore.questions[idx].explanation,
      };
    }

    return res.status(200).json({
      success: true,
      message: 'Question updated successfully.',
      question: idx !== -1 ? memoryStore.questions[idx] : null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteQuestion(req, res) {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      await query(`DELETE FROM questions WHERE id = ?`, [id]);
    }

    memoryStore.questions = memoryStore.questions.filter((q) => String(q.id) !== String(id));

    return res.status(200).json({
      success: true,
      message: 'Question deleted successfully.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function clearAllQuestions(req, res) {
  try {
    if (isDbConnected()) {
      await query(`DELETE FROM questions`);
    }

    memoryStore.questions = [];

    return res.status(200).json({
      success: true,
      message: 'All questions have been cleared from the question bank.',
      count: 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Export CSV of Results
export async function exportResultsCsv(req, res) {
  try {
    let rows = [];
    if (isDbConnected()) {
      rows = await query(`
        SELECT c.candidate_id, c.name, c.email, c.phone, c.college, c.branch, c.position,
               c.status, att.score, att.total_marks, att.percentage, c.violations_count,
               c.interview_status, att.started_at, att.submitted_at
        FROM candidates c
        LEFT JOIN attempts att ON att.candidate_id = c.id
        ORDER BY c.id ASC
      `);
    } else {
      rows = memoryStore.candidates.map((c) => {
        const att = memoryStore.attempts.find((a) => a.candidate_id === c.id);
        return {
          candidate_id: c.candidate_id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          college: c.college,
          branch: c.branch,
          position: c.position,
          status: c.status,
          score: att ? att.score : 0,
          total_marks: att ? att.total_marks : 40,
          percentage: att ? att.percentage : 0,
          violations_count: c.violations_count || 0,
          interview_status: c.interview_status || 'NOT_SCHEDULED',
          started_at: att ? att.started_at : '',
          submitted_at: att ? att.submitted_at : '',
        };
      });
    }

    let csv = 'Candidate ID,Name,Email,Phone,College,Branch,Position,Status,Score,Total Marks,Percentage,Violations,Interview Status,Started At,Submitted At\n';
    rows.forEach((r) => {
      csv += `"${r.candidate_id}","${r.name}","${r.email}","${r.phone}","${r.college}","${r.branch}","${r.position}","${r.status}",${r.score || 0},${r.total_marks || 40},${r.percentage || 0},${r.violations_count || 0},"${r.interview_status}","${r.started_at || ''}","${r.submitted_at || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="Brainovision_Assessment_Results_${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Deduplicate candidate records (by email, phone, or candidate_id)
export async function deduplicateCandidates(req, res) {
  try {
    let removedCount = 0;
    const removedDetails = [];

    if (isDbConnected()) {
      const candidates = await query(`SELECT * FROM candidates ORDER BY id ASC`);
      const seenEmails = new Set();
      const seenPhones = new Set();
      const seenCandidateIds = new Set();
      const idsToDelete = [];

      for (const cand of candidates) {
        const email = (cand.email || '').toLowerCase().trim();
        const phone = (cand.phone || '').trim();
        const cid = (cand.candidate_id || '').trim();

        const isDuplicate =
          (email && seenEmails.has(email)) ||
          (phone && seenPhones.has(phone)) ||
          (cid && seenCandidateIds.has(cid));

        if (isDuplicate) {
          idsToDelete.push(cand.id);
          removedDetails.push({ id: cand.id, candidateId: cand.candidate_id, email: cand.email, name: cand.name });
        } else {
          if (email) seenEmails.add(email);
          if (phone) seenPhones.add(phone);
          if (cid) seenCandidateIds.add(cid);
        }
      }

      if (idsToDelete.length > 0) {
        await query(`DELETE FROM candidates WHERE id IN (?)`, [idsToDelete]);
        await query(`DELETE FROM attempts WHERE candidate_id IN (?)`, [idsToDelete]);
        await query(`DELETE FROM security_events WHERE candidate_id IN (?)`, [idsToDelete]);
        await query(`DELETE FROM email_logs WHERE candidate_id IN (?)`, [idsToDelete]);
        await query(`DELETE FROM interviews WHERE candidate_id IN (?)`, [idsToDelete]);
        removedCount = idsToDelete.length;
      }

      const remaining = await query(`SELECT COUNT(*) as count FROM candidates`);
      return res.status(200).json({
        success: true,
        message: `Candidate deduplication complete. Removed ${removedCount} duplicate record(s).`,
        removedCount,
        remainingCount: remaining[0]?.count || 0,
        duplicatesRemoved: removedDetails,
      });
    }

    // In-memory deduplication
    const seenEmails = new Set();
    const seenPhones = new Set();
    const seenCandidateIds = new Set();
    const uniqueCandidates = [];

    for (const cand of memoryStore.candidates) {
      const email = (cand.email || '').toLowerCase().trim();
      const phone = (cand.phone || '').trim();
      const cid = (cand.candidate_id || '').trim();

      const isDuplicate =
        (email && seenEmails.has(email)) ||
        (phone && seenPhones.has(phone)) ||
        (cid && seenCandidateIds.has(cid));

      if (isDuplicate) {
        removedCount++;
        removedDetails.push({ id: cand.id, candidateId: cand.candidate_id, email: cand.email, name: cand.name });
      } else {
        if (email) seenEmails.add(email);
        if (phone) seenPhones.add(phone);
        if (cid) seenCandidateIds.add(cid);
        uniqueCandidates.push(cand);
      }
    }

    memoryStore.candidates = uniqueCandidates;

    return res.status(200).json({
      success: true,
      message: `Candidate deduplication complete. Removed ${removedCount} duplicate record(s).`,
      removedCount,
      remainingCount: memoryStore.candidates.length,
      duplicatesRemoved: removedDetails,
    });
  } catch (err) {
    console.error('deduplicateCandidates error:', err);
    return res.status(500).json({ success: false, message: 'Failed to deduplicate candidates.', error: err.message });
  }
}

// Delete an individual candidate
export async function deleteCandidate(req, res) {
  try {
    const { id } = req.params;

    if (isDbConnected()) {
      await query(`DELETE FROM candidates WHERE id = ? OR candidate_id = ?`, [id, id]);
      await query(`DELETE FROM attempts WHERE candidate_id = ?`, [id]);
      await query(`DELETE FROM security_events WHERE candidate_id = ?`, [id]);
      await query(`DELETE FROM email_logs WHERE candidate_id = ?`, [id]);
      await query(`DELETE FROM interviews WHERE candidate_id = ?`, [id]);
    }

    memoryStore.candidates = memoryStore.candidates.filter(
      (c) => String(c.id) !== String(id) && c.candidate_id !== id
    );

    return res.status(200).json({
      success: true,
      message: 'Candidate deleted successfully.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Clear all candidates
export async function clearAllCandidates(req, res) {
  try {
    if (isDbConnected()) {
      await query(`DELETE FROM candidates`);
      await query(`DELETE FROM attempts`);
      await query(`DELETE FROM security_events`);
      await query(`DELETE FROM email_logs`);
      await query(`DELETE FROM interviews`);
    }

    memoryStore.candidates = [];
    memoryStore.attempts = [];
    memoryStore.securityEvents = [];
    memoryStore.emailLogs = [];
    memoryStore.interviews = [];

    return res.status(200).json({
      success: true,
      message: 'All candidate records have been cleared from the assessment roster.',
      count: 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Deduplicate questions (removes duplicate question texts)
export async function deduplicateQuestions(req, res) {
  try {
    let removedCount = 0;
    const removedQuestions = [];

    if (isDbConnected()) {
      const questions = await query(`SELECT * FROM questions ORDER BY id ASC`);
      const seenTexts = new Set();
      const idsToDelete = [];

      for (const q of questions) {
        const normalized = (q.question_text || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (seenTexts.has(normalized)) {
          idsToDelete.push(q.id);
          removedQuestions.push({ id: q.id, text: q.question_text });
        } else {
          seenTexts.add(normalized);
        }
      }

      if (idsToDelete.length > 0) {
        await query(`DELETE FROM questions WHERE id IN (?)`, [idsToDelete]);
        removedCount = idsToDelete.length;
      }

      const remaining = await query(`SELECT COUNT(*) as count FROM questions`);
      return res.status(200).json({
        success: true,
        message: `Question deduplication complete. Removed ${removedCount} duplicate question(s).`,
        removedCount,
        remainingCount: remaining[0]?.count || 0,
        duplicatesRemoved: removedQuestions,
      });
    }

    const seenTexts = new Set();
    const uniqueQuestions = [];

    for (const q of memoryStore.questions) {
      const normalized = (q.question_text || q.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenTexts.has(normalized)) {
        removedCount++;
        removedQuestions.push({ id: q.id, text: q.question_text || q.text });
      } else {
        seenTexts.add(normalized);
        uniqueQuestions.push(q);
      }
    }

    memoryStore.questions = uniqueQuestions;

    return res.status(200).json({
      success: true,
      message: `Question deduplication complete. Removed ${removedCount} duplicate question(s).`,
      removedCount,
      remainingCount: memoryStore.questions.length,
      duplicatesRemoved: removedQuestions,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Get Admin Assessment Configuration
export async function getAssessmentConfig(req, res) {
  try {
    const config = memoryStore.assessmentConfig || {
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
    };
    return res.status(200).json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Update Admin Assessment Configuration (Exam duration, Cutoff %, Total Marks, Security limits)
export async function updateAssessmentConfig(req, res) {
  try {
    const {
      title,
      durationMinutes,
      passingPercentage,
      totalQuestions,
      marksPerQuestion,
      negativeMarking,
      negativeMarkPenalty,
      maxTabSwitches,
      maxFullscreenExits,
      securityLevel,
      sections,
      scheduleStart,
      scheduleEnd,
    } = req.body;

    const current = memoryStore.assessmentConfig || {};

    memoryStore.assessmentConfig = {
      ...current,
      title: title || current.title || 'Brainovision Campus Recruitment Assessment — 2026',
      durationMinutes: durationMinutes ? Number(durationMinutes) : (current.durationMinutes || 45),
      passingPercentage: passingPercentage !== undefined ? Number(passingPercentage) : (current.passingPercentage || 60),
      totalQuestions: totalQuestions ? Number(totalQuestions) : (current.totalQuestions || 40),
      marksPerQuestion: marksPerQuestion ? Number(marksPerQuestion) : (current.marksPerQuestion || 1),
      negativeMarking: negativeMarking !== undefined ? Boolean(negativeMarking) : Boolean(current.negativeMarking),
      negativeMarkPenalty: negativeMarkPenalty !== undefined ? Number(negativeMarkPenalty) : (current.negativeMarkPenalty || 0.25),
      maxTabSwitches: maxTabSwitches !== undefined ? Number(maxTabSwitches) : (current.maxTabSwitches || 2),
      maxFullscreenExits: maxFullscreenExits !== undefined ? Number(maxFullscreenExits) : (current.maxFullscreenExits || 2),
      securityLevel: securityLevel || current.securityLevel || 'strict',
      sections: Array.isArray(sections) ? sections : (current.sections || []),
      scheduleStart: scheduleStart || current.scheduleStart,
      scheduleEnd: scheduleEnd || current.scheduleEnd,
      updatedAt: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      message: 'Assessment configuration and cutoff criteria successfully updated.',
      config: memoryStore.assessmentConfig,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}


