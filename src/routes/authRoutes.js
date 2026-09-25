import { Router } from 'express';
import { candidateLogin, adminLogin, getMe } from '../controllers/authController.js';
import { authenticateCandidate, authenticateAdmin } from '../middleware/auth.js';

const router = Router();

router.post('/candidate/login', candidateLogin);
router.post('/admin/login', adminLogin);

router.get('/candidate/me', authenticateCandidate, getMe);
router.get('/admin/me', authenticateAdmin, getMe);

export default router;
