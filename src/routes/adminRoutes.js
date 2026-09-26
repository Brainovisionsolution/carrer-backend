import { Router } from 'express';
import multer from 'multer';
import {
  getDashboardKpis,
  getCandidates,
  getCandidateDossier,
  importCandidates,
  sendCredentials,
  getQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  clearAllQuestions,
  scheduleInterview,
  exportResultsCsv,
  deduplicateCandidates,
  deleteCandidate,
  clearAllCandidates,
  deduplicateQuestions,
  getAssessmentConfig,
  updateAssessmentConfig,
  togglePublishAssessment,
  importQuestionsBatch,
} from '../controllers/adminController.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// All administrative endpoints require admin authentication
router.use(authenticateAdmin);

router.get('/dashboard/kpis', getDashboardKpis);
router.get('/config', getAssessmentConfig);
router.put('/config', updateAssessmentConfig);
router.post('/assessment/publish', togglePublishAssessment);

router.get('/candidates', getCandidates);
router.post('/candidates/deduplicate', deduplicateCandidates);
router.post('/candidates/clear-all', clearAllCandidates);
router.delete('/candidates/clear-all', clearAllCandidates);
router.get('/candidates/:id', getCandidateDossier);
router.delete('/candidates/:id', deleteCandidate);
router.post('/candidates/import', upload.single('file'), importCandidates);
router.post('/candidates/send-credentials', sendCredentials);

router.get('/questions', getQuestions);
router.post('/questions', createQuestion);
router.post('/questions/import', importQuestionsBatch);
router.post('/questions/deduplicate', deduplicateQuestions);
router.put('/questions/:id', updateQuestion);
router.delete('/questions/:id', deleteQuestion);
router.post('/questions/clear', clearAllQuestions);

router.post('/interviews', scheduleInterview);
router.get('/export/results', exportResultsCsv);


export default router;

