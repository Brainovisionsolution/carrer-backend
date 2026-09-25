import { Router } from 'express';
import {
  startAssessment,
  getAttempt,
  saveAnswer,
  heartbeat,
  submitAssessmentAttempt,
  recordSecurityEvent,
} from '../controllers/assessmentController.js';
import { authenticateCandidate } from '../middleware/auth.js';

const router = Router();

// All candidate assessment endpoints require candidate JWT authentication
router.use(authenticateCandidate);

router.post('/start', startAssessment);
router.get('/attempt/:id', getAttempt);
router.post('/attempt/:id/answers', saveAnswer);
router.post('/attempt/:id/heartbeat', heartbeat);
router.post('/attempt/:id/submit', submitAssessmentAttempt);
router.post('/security-events', recordSecurityEvent);

export default router;
