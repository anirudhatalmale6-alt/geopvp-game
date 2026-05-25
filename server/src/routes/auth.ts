import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  signup,
  verifyEmail,
  resendCode,
  login,
  refreshToken,
  forgotPassword,
  resetPassword,
  changePassword,
  getProfile,
  updateProfile,
  deleteAccount,
  savePushToken,
  acceptWaiver,
} from '../controllers/authController';

const router = Router();

// Public routes
router.post('/signup', signup);
router.post('/verify-email', verifyEmail);
router.post('/resend-code', resendCode);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected routes (require auth)
router.post('/change-password', authenticate, changePassword);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.post('/push-token', authenticate, savePushToken);
router.delete('/account', authenticate, deleteAccount);
router.post('/accept-waiver', authenticate, acceptWaiver);

export default router;
