import { query, memoryStore, isDbConnected } from '../config/db.js';

export async function evaluateAttempt(attemptId) {
  // 1. Fetch attempt and candidate info
  let attempt = null;
  let candidate = null;
  let assessment = null;

  if (isDbConnected()) {
    const attempts = await query(
      `SELECT a.*, c.candidate_id as cand_code, c.name as candidate_name, c.email as candidate_email,
              asm.passing_percentage
       FROM attempts a
       JOIN candidates c ON a.candidate_id = c.id
       JOIN assessments asm ON a.assessment_id = asm.id
       WHERE a.id = ? OR c.candidate_id = ? OR a.attempt_code = ?`,
      [attemptId, attemptId, attemptId]
    );
    if (!attempts || attempts.length === 0) {
      throw new Error(`Attempt with ID ${attemptId} not found`);
    }
    attempt = attempts[0];
  } else {
    attempt = memoryStore.attempts.find(a =>
      String(a.id) === String(attemptId) ||
      (a.candidate_id && String(a.candidate_id) === String(attemptId)) ||
      a.attempt_code === attemptId ||
      a.candidate_code === attemptId
    );
    if (!attempt) throw new Error(`Attempt with ID ${attemptId} not found`);
  }

  // 2. Fetch answers given by candidate
  let answersList = [];
  if (isDbConnected()) {
    answersList = await query(
      `SELECT ans.question_id, ans.selected_option, q.section, q.correct_option, q.marks
       FROM answers ans
       JOIN questions q ON ans.question_id = q.id
       WHERE ans.attempt_id = ?`,
      [attempt.id]
    );
  } else {
    answersList = (memoryStore.answers || []).filter(a =>
      String(a.attempt_id) === String(attempt.id) ||
      String(a.attempt_id) === String(attemptId)
    );
  }

  // 3. Compute score and sectional breakdowns dynamically from assessment_sections
  let totalScore = 0;
  const config = memoryStore.assessmentConfig || {};
  let sectionScores = {};

  if (isDbConnected()) {
    try {
      const asmSections = await query(
        `SELECT * FROM assessment_sections WHERE assessment_id = ? ORDER BY display_order ASC`,
        [attempt.assessment_id || 1]
      );
      if (asmSections && asmSections.length > 0) {
        for (const s of asmSections) {
          sectionScores[s.section_key] = {
            section: s.section_key,
            sectionTitle: s.title,
            score: 0,
            total: s.question_count * (s.marks_per_question || 1),
            percentage: 0,
          };
        }
      }
    } catch (e) {
      console.warn('Scoring service sections query notice:', e.message);
    }
  }

  if (Object.keys(sectionScores).length === 0) {
    const configSections = config.sections || [];
    if (configSections.length > 0) {
      for (const s of configSections) {
        const k = (s.id || s.section_key || 'aptitude').toLowerCase();
        sectionScores[k] = {
          section: k,
          sectionTitle: s.title || (k.charAt(0).toUpperCase() + k.slice(1)),
          score: 0,
          total: (s.count || 10) * (s.marksPerQuestion || 1),
          percentage: 0,
        };
      }
    } else {
      sectionScores = {
        aptitude: { section: 'aptitude', sectionTitle: 'Quantitative Aptitude', score: 0, total: 15, percentage: 0 },
        reasoning: { section: 'reasoning', sectionTitle: 'Logical Reasoning', score: 0, total: 10, percentage: 0 },
        verbal: { section: 'verbal', sectionTitle: 'Verbal Ability', score: 0, total: 10, percentage: 0 },
        technical: { section: 'technical', sectionTitle: 'Technical Core', score: 0, total: 5, percentage: 0 },
      };
    }
  }

  for (const item of answersList) {
    const isCorrect = item.selected_option && item.correct_option &&
      item.selected_option.toUpperCase() === item.correct_option.toUpperCase();

    let marksAwarded = 0;
    if (isCorrect) {
      marksAwarded = item.marks || config.marksPerQuestion || 1;
      totalScore += marksAwarded;
    } else if (item.selected_option && config.negativeMarking) {
      marksAwarded = -(config.negativeMarkPenalty || 0.25);
      totalScore += marksAwarded;
    }

    const secKey = item.section ? item.section.toLowerCase() : 'aptitude';
    if (sectionScores[secKey]) {
      sectionScores[secKey].score += marksAwarded;
    }

    // Update answer record with correctness
    if (isDbConnected()) {
      await query(
        `UPDATE answers SET is_correct = ?, marks_awarded = ? WHERE attempt_id = ? AND question_id = ?`,
        [isCorrect ? 1 : 0, marksAwarded, attemptId, item.question_id]
      );
    }
  }

  // Calculate percentages
  Object.keys(sectionScores).forEach((k) => {
    const s = sectionScores[k];
    s.percentage = s.total > 0 ? parseFloat(((s.score / s.total) * 100).toFixed(1)) : 0;
  });

  const sumSectionTotals = Object.values(sectionScores).reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const totalMarks = attempt.total_marks || (sumSectionTotals > 0 ? sumSectionTotals : (config.totalQuestions || 40));
  const percentage = totalMarks > 0 ? parseFloat(((totalScore / totalMarks) * 100).toFixed(1)) : 0;
  const passingCutoff = attempt.passing_percentage || config.passingPercentage || 60.0;

  let finalStatus = 'NOT_QUALIFIED';
  if (attempt.status === 'TERMINATED') {
    finalStatus = 'TERMINATED';
  } else {
    finalStatus = percentage >= passingCutoff ? 'CLEARED' : 'NOT_QUALIFIED';
  }


  const now = new Date();

  // 4. Update attempt in MySQL
  if (isDbConnected()) {
    await query(
      `UPDATE attempts 
       SET status = ?, score = ?, total_marks = ?, percentage = ?, submitted_at = ?
       WHERE id = ?`,
      [finalStatus, totalScore, totalMarks, percentage, now, attemptId]
    );

    // Update candidate table status
    await query(
      `UPDATE candidates SET status = ? WHERE id = ?`,
      [finalStatus, attempt.candidate_id]
    );

    // Insert or update results table
    await query(
      `INSERT INTO results (attempt_id, candidate_id, score, total_marks, percentage, status, section_scores_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         score = VALUES(score), 
         percentage = VALUES(percentage), 
         status = VALUES(status), 
         section_scores_json = VALUES(section_scores_json)`,
      [
        attemptId,
        attempt.candidate_id,
        totalScore,
        totalMarks,
        percentage,
        finalStatus,
        JSON.stringify(sectionScores),
        now,
      ]
    );
  } else {
    attempt.status = finalStatus;
    attempt.score = totalScore;
    attempt.percentage = percentage;
    attempt.submitted_at = now.toISOString();

    const cand = memoryStore.candidates.find(c => c.id === attempt.candidate_id);
    if (cand) cand.status = finalStatus;
  }

  return {
    attemptId,
    candidateId: attempt.candidate_id,
    score: totalScore,
    totalMarks,
    percentage,
    status: finalStatus,
    sectionScores,
    submittedAt: now.toISOString(),
  };
}
