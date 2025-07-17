const { sendEmail } = require('./services/notificationService');
async function emailHealthCheck() {
    try {
        await sendEmail({ to: 'your@email.com', subject: 'Health Check', text: 'Hello', html: '<p>Hello</p>' });
        console.log('Email health check: OK');
    } catch (e) {
        console.error('Email health check FAILED:', e.message);
    }
}
module.exports = emailHealthCheck;