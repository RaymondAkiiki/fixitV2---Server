const express = require('express');
const { sendInvite, acceptInvite, getAllInvites, verifyInviteToken} = require('../controllers/inviteController');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getAllInvites);
router.post('/send', protect, sendInvite);
router.post('/accept', acceptInvite);
router.get('/verify/:token', verifyInviteToken);

module.exports = router;