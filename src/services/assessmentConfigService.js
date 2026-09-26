import { query, memoryStore, isDbConnected } from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_FILE = path.join(__dirname, '../data/assessment_config_backup.json');

// Helper to save config to local backup file to survive restarts if DB is offline
function saveBackupConfig(config) {
  try {
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Config Service] Backup file write warning:', e.message);
  }
}

// Helper to load backup config from disk
function loadBackupConfig() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const data = fs.readFileSync(BACKUP_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('[Config Service] Backup file read warning:', e.message);
  }
  return null;
}

// Initialize memoryStore with backup if exists
const diskBackup = loadBackupConfig();
if (diskBackup && (!memoryStore.assessmentConfig || Object.keys(memoryStore.assessmentConfig).length === 0)) {
  memoryStore.assessmentConfig = diskBackup;
}

/**
 * Get the currently active/published assessment and its sections.
 * Single source of truth from MySQL assessments & assessment_sections tables.
 */
export async function getActiveAssessment() {
  if (isDbConnected()) {
    try {
      // 1. Find active assessment (is_active = TRUE)
      let rows = await query(
        `SELECT * FROM assessments WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`
      );

      // If no active assessment, look for the most recent one
      if (!rows || rows.length === 0) {
        rows = await query(`SELECT * FROM assessments ORDER BY id DESC LIMIT 1`);
      }

      // If assessments table is completely empty, bootstrap the default assessment
      if (!rows || rows.length === 0) {
        const ins = await query(
          `INSERT INTO assessments (
            title, description, duration_minutes, total_questions,
            passing_percentage, negative_marking, max_tab_switches,
            max_fullscreen_exits, security_level, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            'Campus Recruitment Assessment — 2026',
            'Phase 1 Technical & Aptitude Online Screening Assessment for Graduate Engineering Trainee Program',
            45,
            40,
            60.00,
            false,
            2,
            2,
            'STRICT',
          ]
        );

        const newId = ins.insertId || 1;
        const defaultSections = [
          { key: 'aptitude', title: 'Quantitative Aptitude', count: 15, marks: 1, order: 1 },
          { key: 'reasoning', title: 'Logical Reasoning', count: 10, marks: 1, order: 2 },
          { key: 'verbal', title: 'Verbal Ability', count: 10, marks: 1, order: 3 },
          { key: 'technical', title: 'Technical Core', count: 5, marks: 1, order: 4 },
        ];

        for (const sec of defaultSections) {
          await query(
            `INSERT INTO assessment_sections (assessment_id, section_key, title, question_count, marks_per_question, display_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [newId, sec.key, sec.title, sec.count, sec.marks, sec.order]
          );
        }

        rows = await query(`SELECT * FROM assessments WHERE id = ?`, [newId]);
      }

      const assessment = rows[0];

      // 2. Fetch configured sections for this assessment
      const sections = await query(
        `SELECT * FROM assessment_sections WHERE assessment_id = ? ORDER BY display_order ASC`,
        [assessment.id]
      );

      const formattedSections = (sections || []).map((s) => ({
        id: s.section_key,
        section_key: s.section_key,
        title: s.title,
        count: s.question_count,
        marksPerQuestion: s.marks_per_question || 1,
        displayOrder: s.display_order,
      }));

      const fullConfig = {
        id: assessment.id,
        title: assessment.title,
        description: assessment.description || '',
        durationMinutes: assessment.duration_minutes,
        totalQuestions: assessment.total_questions,
        passingPercentage: parseFloat(assessment.passing_percentage),
        negativeMarking: Boolean(assessment.negative_marking),
        negativeMarkPenalty: 0.25,
        maxTabSwitches: assessment.max_tab_switches,
        maxFullscreenExits: assessment.max_fullscreen_exits,
        securityLevel: (assessment.security_level || 'STRICT').toLowerCase(),
        isActive: Boolean(assessment.is_active),
        sections: formattedSections,
        createdAt: assessment.created_at,
        updatedAt: assessment.updated_at,
      };

      // Keep in-memory cache in sync
      memoryStore.assessmentConfig = fullConfig;
      saveBackupConfig(fullConfig);

      return fullConfig;
    } catch (err) {
      console.error('[Config Service] Error fetching active assessment from MySQL:', err.message);
    }
  }

  // In-Memory store fallback
  const fallback = memoryStore.assessmentConfig || {
    id: 1,
    title: 'Campus Recruitment Assessment — 2026',
    description: 'Phase 1 Technical & Aptitude Online Screening Assessment for Graduate Engineering Trainee Program',
    durationMinutes: 45,
    passingPercentage: 60,
    totalQuestions: 40,
    marksPerQuestion: 1,
    negativeMarking: false,
    negativeMarkPenalty: 0.25,
    maxTabSwitches: 2,
    maxFullscreenExits: 2,
    securityLevel: 'strict',
    isActive: true,
    sections: [
      { id: 'aptitude', section_key: 'aptitude', title: 'Quantitative Aptitude', count: 15, marksPerQuestion: 1 },
      { id: 'reasoning', section_key: 'reasoning', title: 'Logical Reasoning', count: 10, marksPerQuestion: 1 },
      { id: 'verbal', section_key: 'verbal', title: 'Verbal Ability', count: 10, marksPerQuestion: 1 },
      { id: 'technical', section_key: 'technical', title: 'Technical Core', count: 5, marksPerQuestion: 1 },
    ],
  };

  return fallback;
}

/**
 * Save assessment configuration and sections to MySQL permanently.
 */
export async function saveAssessmentConfig(configData) {
  const {
    id,
    title,
    description,
    durationMinutes,
    passingPercentage,
    totalQuestions,
    negativeMarking,
    negativeMarkPenalty,
    maxTabSwitches,
    maxFullscreenExits,
    securityLevel,
    isActive,
    sections,
    scheduleStart,
    scheduleEnd,
  } = configData;

  // Determine section array and calculate total questions dynamically if not supplied
  const sectionList = Array.isArray(sections) && sections.length > 0
    ? sections
    : [
        { id: 'aptitude', title: 'Quantitative Aptitude', count: 15 },
        { id: 'reasoning', title: 'Logical Reasoning', count: 10 },
        { id: 'verbal', title: 'Verbal Ability', count: 10 },
        { id: 'technical', title: 'Technical Core', count: 5 },
      ];

  const calculatedTotalQs = sectionList.reduce((acc, s) => acc + (Number(s.count) || 0), 0);
  const finalTotalQuestions = totalQuestions ? Number(totalQuestions) : calculatedTotalQs;

  if (isDbConnected()) {
    try {
      // Find target assessment
      let targetId = id;
      if (!targetId) {
        const existing = await query(`SELECT id FROM assessments ORDER BY id DESC LIMIT 1`);
        if (existing && existing.length > 0) {
          targetId = existing[0].id;
        }
      }

      const secLevel = (securityLevel || 'STRICT').toUpperCase();
      const validSecLevel = ['STRICT', 'STANDARD', 'LENIENT'].includes(secLevel) ? secLevel : 'STRICT';

      if (targetId) {
        // Update existing assessment
        await query(
          `UPDATE assessments SET
            title = COALESCE(?, title),
            description = COALESCE(?, description),
            duration_minutes = COALESCE(?, duration_minutes),
            total_questions = COALESCE(?, total_questions),
            passing_percentage = COALESCE(?, passing_percentage),
            negative_marking = COALESCE(?, negative_marking),
            max_tab_switches = COALESCE(?, max_tab_switches),
            max_fullscreen_exits = COALESCE(?, max_fullscreen_exits),
            security_level = ?,
            is_active = COALESCE(?, is_active),
            updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            title !== undefined ? title : null,
            description !== undefined ? description : null,
            durationMinutes !== undefined ? Number(durationMinutes) : null,
            finalTotalQuestions,
            passingPercentage !== undefined ? Number(passingPercentage) : null,
            negativeMarking !== undefined ? Boolean(negativeMarking) : null,
            maxTabSwitches !== undefined ? Number(maxTabSwitches) : null,
            maxFullscreenExits !== undefined ? Number(maxFullscreenExits) : null,
            validSecLevel,
            isActive !== undefined ? Boolean(isActive) : null,
            targetId,
          ]
        );
      } else {
        // Insert new assessment
        const ins = await query(
          `INSERT INTO assessments (
            title, description, duration_minutes, total_questions,
            passing_percentage, negative_marking, max_tab_switches,
            max_fullscreen_exits, security_level, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            title || 'Campus Recruitment Assessment — 2026',
            description || 'Phase 1 Technical & Aptitude Online Screening Assessment for Graduate Engineering Trainee Program',
            durationMinutes ? Number(durationMinutes) : 45,
            finalTotalQuestions,
            passingPercentage ? Number(passingPercentage) : 60.00,
            Boolean(negativeMarking),
            maxTabSwitches !== undefined ? Number(maxTabSwitches) : 2,
            maxFullscreenExits !== undefined ? Number(maxFullscreenExits) : 2,
            validSecLevel,
            isActive !== undefined ? Boolean(isActive) : true,
          ]
        );
        targetId = ins.insertId;
      }

      // Synchronize sections
      if (Array.isArray(sections) && sections.length > 0) {
        // Delete old sections for this assessment
        await query(`DELETE FROM assessment_sections WHERE assessment_id = ?`, [targetId]);

        // Insert updated sections with proper ordering and counts
        for (let i = 0; i < sections.length; i++) {
          const s = sections[i];
          const secKey = (s.id || s.section_key || s.section || 'aptitude').toLowerCase();
          const secTitle = s.title || (secKey.charAt(0).toUpperCase() + secKey.slice(1));
          const qCount = Number(s.count ?? s.question_count ?? 10);
          const marks = Number(s.marksPerQuestion ?? s.marks_per_question ?? 1);

          await query(
            `INSERT INTO assessment_sections (assessment_id, section_key, title, question_count, marks_per_question, display_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [targetId, secKey, secTitle, qCount, marks, i + 1]
          );
        }
      }

      // Return the updated assessment
      return await getActiveAssessment();
    } catch (err) {
      console.error('[Config Service] Error updating assessment in MySQL:', err.message);
      throw err;
    }
  }

  // In-Memory store update fallback
  const current = memoryStore.assessmentConfig || {};
  const updatedConfig = {
    ...current,
    id: id || current.id || 1,
    title: title || current.title || 'Campus Recruitment Assessment — 2026',
    description: description !== undefined ? description : current.description,
    durationMinutes: durationMinutes !== undefined ? Number(durationMinutes) : (current.durationMinutes || 45),
    passingPercentage: passingPercentage !== undefined ? Number(passingPercentage) : (current.passingPercentage || 60),
    totalQuestions: finalTotalQuestions,
    negativeMarking: negativeMarking !== undefined ? Boolean(negativeMarking) : Boolean(current.negativeMarking),
    negativeMarkPenalty: negativeMarkPenalty !== undefined ? Number(negativeMarkPenalty) : (current.negativeMarkPenalty || 0.25),
    maxTabSwitches: maxTabSwitches !== undefined ? Number(maxTabSwitches) : (current.maxTabSwitches || 2),
    maxFullscreenExits: maxFullscreenExits !== undefined ? Number(maxFullscreenExits) : (current.maxFullscreenExits || 2),
    securityLevel: securityLevel || current.securityLevel || 'strict',
    isActive: isActive !== undefined ? Boolean(isActive) : (current.isActive !== undefined ? current.isActive : true),
    sections: sectionList.map((s, idx) => ({
      id: s.id || s.section_key,
      section_key: s.id || s.section_key,
      title: s.title,
      count: Number(s.count) || 0,
      marksPerQuestion: Number(s.marksPerQuestion) || 1,
      displayOrder: idx + 1,
    })),
    scheduleStart: scheduleStart || current.scheduleStart,
    scheduleEnd: scheduleEnd || current.scheduleEnd,
    updatedAt: new Date().toISOString(),
  };

  memoryStore.assessmentConfig = updatedConfig;
  saveBackupConfig(updatedConfig);
  return updatedConfig;
}

/**
 * Toggle Publish / Active status for an assessment.
 */
export async function toggleAssessmentPublish(isActive, assessmentId = null) {
  if (isDbConnected()) {
    try {
      let targetId = assessmentId;
      if (!targetId) {
        const rows = await query(`SELECT id FROM assessments ORDER BY id DESC LIMIT 1`);
        if (rows && rows.length > 0) targetId = rows[0].id;
      }

      if (targetId) {
        await query(`UPDATE assessments SET is_active = ? WHERE id = ?`, [Boolean(isActive), targetId]);
      }
    } catch (err) {
      console.error('[Config Service] Error updating publish state in MySQL:', err.message);
    }
  }

  if (memoryStore.assessmentConfig) {
    memoryStore.assessmentConfig.isActive = Boolean(isActive);
    saveBackupConfig(memoryStore.assessmentConfig);
  }

  return await getActiveAssessment();
}
