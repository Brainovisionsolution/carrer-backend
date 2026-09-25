import { query, memoryStore, isDbConnected } from '../config/db.js';
import { evaluateAttempt } from '../services/scoringService.js';

// Helper to sanitize questions: NEVER send correct_option or explanation to candidate
function sanitizeQuestions(questions) {
  return questions.map((q) => ({
    id: q.id,
    section: q.section,
    sectionTitle:
      q.section === 'aptitude'
        ? 'Quantitative Aptitude'
        : q.section === 'reasoning'
        ? 'Logical Reasoning'
        : q.section === 'verbal'
        ? 'Verbal Ability'
        : 'Technical Core',
    difficulty: q.difficulty,
    text: q.question_text,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    marks: q.marks || 1,
  }));
}

export async function startAssessment(req, res) {
  try {
    const candidateId = req.candidate.id;

    // 1. Enforce ONE ATTEMPT ONLY
    let existingAttempt = null;
    if (isDbConnected()) {
      const rows = await query(
        `SELECT * FROM attempts WHERE candidate_id = ? ORDER BY id DESC LIMIT 1`,
        [candidateId]
      );
      if (rows && rows.length > 0) existingAttempt = rows[0];
    } else {
      existingAttempt = memoryStore.attempts.find((a) => a.candidate_id === candidateId);
    }

    if (existingAttempt) {
      // If already finished or terminated
      if (['COMPLETED', 'CLEARED', 'NOT_QUALIFIED', 'TERMINATED'].includes(existingAttempt.status)) {
        return res.status(200).json({
          success: true,
          isFinished: true,
          status: existingAttempt.status,
          message: 'Assessment attempt has already concluded.',
        });
      }

      // Check if time has expired on server
      const now = new Date();
      const expiresAt = new Date(existingAttempt.expires_at);
      if (now > expiresAt) {
        const result = await evaluateAttempt(existingAttempt.id);
        return res.status(200).json({
          success: true,
          isFinished: true,
          status: result.status,
          message: 'Assessment timer expired.',
          result,
        });
      }

      // Resume existing active attempt
      const attemptDetails = await getAttemptDetails(existingAttempt.id);
      return res.status(200).json({
        success: true,
        isResume: true,
        ...attemptDetails,
      });
    }

    // 2. Create NEW authoritative assessment attempt
    const config = memoryStore.assessmentConfig || {};
    const attemptCode = `ATT-2026-0926-${String(Math.floor(100000 + Math.random() * 900000))}`;
    const durationMinutes = config.durationMinutes || 45;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);


    let attemptId = null;

    if (isDbConnected()) {
      const insRes = await query(
        `INSERT INTO attempts (attempt_code, candidate_id, assessment_id, started_at, expires_at, last_heartbeat_at, status)
         VALUES (?, ?, 1, ?, ?, ?, 'IN_PROGRESS')`,
        [attemptCode, candidateId, now, expiresAt, now]
      );
      attemptId = insRes.insertId;

      // Update candidate status to IN_PROGRESS
      await query(`UPDATE candidates SET status = 'IN_PROGRESS' WHERE id = ?`, [candidateId]);

      // Server-side question selection (15 Aptitude, 10 Reasoning, 10 Verbal, 5 Technical)
      const aptitudeQs = await query(`SELECT * FROM questions WHERE section = 'aptitude' AND status = 'ACTIVE' ORDER BY RAND() LIMIT 15`);
      const reasoningQs = await query(`SELECT * FROM questions WHERE section = 'reasoning' AND status = 'ACTIVE' ORDER BY RAND() LIMIT 10`);
      const verbalQs = await query(`SELECT * FROM questions WHERE section = 'verbal' AND status = 'ACTIVE' ORDER BY RAND() LIMIT 10`);
      const techQs = await query(`SELECT * FROM questions WHERE section = 'technical' AND status = 'ACTIVE' ORDER BY RAND() LIMIT 5`);

      const selectedQuestions = [...aptitudeQs, ...reasoningQs, ...verbalQs, ...techQs];

      // Save question order for this attempt
      for (let i = 0; i < selectedQuestions.length; i++) {
        await query(
          `INSERT INTO attempt_questions (attempt_id, question_id, question_order) VALUES (?, ?, ?)`,
          [attemptId, selectedQuestions[i].id, i + 1]
        );
      }

      const sanitized = sanitizeQuestions(selectedQuestions);
      const remainingSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000));

      return res.status(201).json({
        success: true,
        attemptId,
        attemptCode,
        startedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        remainingSeconds,
        durationMinutes,
        questions: sanitized,
        answers: {},
        markedForReview: [],
      });
    } else {
      // Memory store fallback
      attemptId = memoryStore.attempts.length + 1;
      const memoryAttempt = {
        id: attemptId,
        attempt_code: attemptCode,
        candidate_id: candidateId,
        assessment_id: 1,
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        last_heartbeat_at: now.toISOString(),
        status: 'IN_PROGRESS',
        score: 0,
        total_marks: 40,
        percentage: 0,
      };
      memoryStore.attempts.push(memoryAttempt);

      const candidate = memoryStore.candidates.find((c) => c.id === candidateId);
      if (candidate) candidate.status = 'IN_PROGRESS';

      const sanitized = sanitizeQuestions(memoryStore.questions);

      return res.status(201).json({
        success: true,
        attemptId,
        attemptCode,
        startedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        remainingSeconds: durationMinutes * 60,
        durationMinutes,
        questions: sanitized,
        answers: {},
        markedForReview: [],
      });
    }
  } catch (err) {
    console.error('startAssessment error:', err);
    return res.status(500).json({ success: false, message: 'Failed to start assessment.', error: err.message });
  }
}

// Helper to fetch sanitized attempt details
async function getAttemptDetails(attemptId) {
  const attempts = await query(`SELECT * FROM attempts WHERE id = ?`, [attemptId]);
  const attempt = attempts[0];

  const now = new Date();
  const expiresAt = new Date(attempt.expires_at);
  const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

  // Fetch ordered questions
  const qRows = await query(
    `SELECT q.*, aq.question_order
     FROM attempt_questions aq
     JOIN questions q ON aq.question_id = q.id
     WHERE aq.attempt_id = ?
     ORDER BY aq.question_order ASC`,
    [attemptId]
  );

  // Fetch current answers
  const ansRows = await query(
    `SELECT question_id, selected_option, is_marked_for_review FROM answers WHERE attempt_id = ?`,
    [attemptId]
  );

  const answersMap = {};
  const markedList = [];
  ansRows.forEach((r) => {
    answersMap[r.question_id] = r.selected_option;
    if (r.is_marked_for_review) markedList.push(r.question_id);
  });

  return {
    attemptId: attempt.id,
    attemptCode: attempt.attempt_code,
    startedAt: attempt.started_at,
    expiresAt: attempt.expires_at,
    remainingSeconds,
    durationMinutes: 45,
    questions: sanitizeQuestions(qRows),
    answers: answersMap,
    markedForReview: markedList,
  };
}

export async function getAttempt(req, res) {
  try {
    const { id } = req.params;
    if (isDbConnected()) {
      const details = await getAttemptDetails(id);
      return res.status(200).json({ success: true, ...details });
    }
    return res.status(200).json({ success: true, attemptId: id });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Server-authoritative auto-save
export async function saveAnswer(req, res) {
  try {
    const { id } = req.params;
    const { questionId, selectedOption, isMarkedForReview } = req.body;

    if (!questionId || !selectedOption) {
      return res.status(400).json({ success: false, message: 'Question ID and option are required.' });
    }

    if (isDbConnected()) {
      // Validate that attempt is still valid and within server timer
      const attempts = await query(`SELECT * FROM attempts WHERE id = ?`, [id]);
      if (!attempts || attempts.length === 0) {
        return res.status(404).json({ success: false, message: 'Attempt not found.' });
      }

      const attempt = attempts[0];
      const now = new Date();
      if (now > new Date(attempt.expires_at)) {
        return res.status(400).json({ success: false, message: 'Assessment timer has expired.' });
      }

      if (attempt.status !== 'IN_PROGRESS') {
        return res.status(400).json({ success: false, message: 'Attempt is no longer in progress.' });
      }

      // Upsert answer
      await query(
        `INSERT INTO answers (attempt_id, question_id, selected_option, is_marked_for_review, saved_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           selected_option = VALUES(selected_option),
           is_marked_for_review = VALUES(is_marked_for_review),
           saved_at = NOW()`,
        [id, questionId, selectedOption.toUpperCase(), Boolean(isMarkedForReview)]
      );

      return res.status(200).json({
        success: true,
        message: 'Answer saved on server.',
        savedAt: now.toISOString(),
      });
    }

    // Memory store fallback
    const attempt = memoryStore.attempts.find((a) => a.id === Number(id));
    if (!attempt) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }
    const now = new Date();
    if (now > new Date(attempt.expires_at)) {
      return res.status(400).json({ success: false, message: 'Assessment timer has expired.' });
    }
    if (attempt.status !== 'IN_PROGRESS') {
      return res.status(400).json({ success: false, message: 'Attempt is no longer in progress.' });
    }

    let ans = memoryStore.answers.find((a) => a.attempt_id === Number(id) && a.question_id === Number(questionId));
    if (ans) {
      ans.selected_option = selectedOption.toUpperCase();
      ans.is_marked_for_review = Boolean(isMarkedForReview);
      ans.saved_at = now.toISOString();
    } else {
      const question = memoryStore.questions.find((q) => q.id === Number(questionId));
      memoryStore.answers.push({
        attempt_id: Number(id),
        question_id: Number(questionId),
        selected_option: selectedOption.toUpperCase(),
        is_marked_for_review: Boolean(isMarkedForReview),
        saved_at: now.toISOString(),
        section: question?.section || 'aptitude',
        correct_option: question?.correct_option || '',
        marks: question?.marks || 1,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Answer saved on server.',
      savedAt: now.toISOString(),
    });
  } catch (err) {
    console.error('saveAnswer error:', err);
    return res.status(500).json({ success: false, message: 'Server error saving answer.', error: err.message });
  }
}

// Server heartbeat
export async function heartbeat(req, res) {
  try {
    const { id } = req.params;
    if (isDbConnected()) {
      await query(`UPDATE attempts SET last_heartbeat_at = NOW() WHERE id = ?`, [id]);
      const attempts = await query(`SELECT expires_at, status FROM attempts WHERE id = ?`, [id]);
      if (attempts && attempts.length > 0) {
        const remainingSeconds = Math.max(0, Math.floor((new Date(attempts[0].expires_at) - new Date()) / 1000));
        return res.status(200).json({ success: true, remainingSeconds, status: attempts[0].status });
      }
    } else {
      const attempt = memoryStore.attempts.find((a) => a.id === Number(id));
      if (attempt) {
        attempt.last_heartbeat_at = new Date().toISOString();
        const remainingSeconds = Math.max(0, Math.floor((new Date(attempt.expires_at) - new Date()) / 1000));
        return res.status(200).json({ success: true, remainingSeconds, status: attempt.status });
      }
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Submit & auto-evaluate attempt
export async function submitAssessmentAttempt(req, res) {
  try {
    const { id } = req.params;
    const result = await evaluateAttempt(id);
    return res.status(200).json({
      success: true,
      message: 'Assessment evaluated successfully.',
      result,
    });
  } catch (err) {
    console.error('submitAssessment error:', err);
    return res.status(500).json({ success: false, message: 'Evaluation failed.', error: err.message });
  }
}

// Security events logger & violation escalation
export async function recordSecurityEvent(req, res) {
  try {
    const candidateId = req.candidate.id;
    const { attemptId, eventType, severity = 'WARNING', metadata = '' } = req.body;

    if (!attemptId || !eventType) {
      return res.status(400).json({ success: false, message: 'Attempt ID and event type are required.' });
    }

    let violationsCount = 0;
    let isTerminated = false;

    if (isDbConnected()) {
      // 1. Record event
      await query(
        `INSERT INTO security_events (candidate_id, attempt_id, event_type, severity, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [candidateId, attemptId, eventType, severity, metadata]
      );

      // 2. Count major violations (Tab switch, fullscreen exit, copy/paste, shortcuts)
      const majorEvents = ['TAB_SWITCH', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY_ATTEMPT', 'PASTE_ATTEMPT', 'RESTRICTED_KEY'];
      if (majorEvents.includes(eventType)) {
        await query(`UPDATE candidates SET violations_count = violations_count + 1 WHERE id = ?`, [candidateId]);
        const candRows = await query(`SELECT violations_count FROM candidates WHERE id = ?`, [candidateId]);
        violationsCount = candRows[0]?.violations_count || 1;
      }

      // 3. Check termination threshold (3 violations)
      if (violationsCount >= 3) {
        isTerminated = true;
        await query(
          `UPDATE attempts 
           SET status = 'TERMINATED', termination_reason = 'Exceeded maximum permitted security violations (3 consecutive alerts).'
           WHERE id = ?`,
          [attemptId]
        );
        await query(`UPDATE candidates SET status = 'TERMINATED' WHERE id = ?`, [candidateId]);

        // Evaluate and lock result as TERMINATED
        await evaluateAttempt(attemptId);
      }
    } else {
      const cand = memoryStore.candidates.find((c) => c.id === candidateId);
      const majorEvents = ['TAB_SWITCH', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY_ATTEMPT', 'PASTE_ATTEMPT', 'RESTRICTED_KEY'];
      if (cand && majorEvents.includes(eventType)) {
        cand.violations_count = (cand.violations_count || 0) + 1;
        violationsCount = cand.violations_count;
      } else {
        violationsCount = cand?.violations_count || 1;
      }

      memoryStore.securityEvents.push({
        candidate_id: candidateId,
        attempt_id: Number(attemptId),
        event_type: eventType,
        severity,
        metadata,
        created_at: new Date().toISOString(),
      });

      if (violationsCount >= 3) {
        isTerminated = true;
        const attempt = memoryStore.attempts.find((a) => a.id === Number(attemptId));
        if (attempt) {
          attempt.status = 'TERMINATED';
          attempt.termination_reason = 'Exceeded maximum permitted security violations (3 consecutive alerts).';
        }
        if (cand) cand.status = 'TERMINATED';
        await evaluateAttempt(Number(attemptId));
      }
    }

    return res.status(200).json({
      success: true,
      violationsCount,
      isTerminated,
      action: isTerminated ? 'TERMINATE' : violationsCount === 2 ? 'FINAL_WARNING' : 'WARN',
      message: isTerminated
        ? 'Assessment terminated due to repeated security policy violations.'
        : `Security violation recorded. Warning ${violationsCount} of 3.`,
    });
  } catch (err) {
    console.error('recordSecurityEvent error:', err);
    return res.status(500).json({ success: false, message: 'Failed to record security event.', error: err.message });
  }
}

// Public or candidate-accessible config for rules, timing, and cutoffs
export async function getCandidateAssessmentConfig(req, res) {
  try {
    const config = memoryStore.assessmentConfig || {
      title: 'Brainovision Campus Recruitment Assessment — 2026',
      durationMinutes: 45,
      passingPercentage: 60,
      totalQuestions: 40,
      maxTabSwitches: 2,
      maxFullscreenExits: 2,
      securityLevel: 'strict',
    };
    return res.status(200).json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

