// A new temporary file, e.g., testEmailAuth.js
require('dotenv').config(); // Make sure to load your .env file

const { createOAuth2Transporter } = require('./lib/nodemailerClient'); // Adjust path as needed
const logger = require('./utils/logger'); // Adjust path as needed

async function testAuth() {
    try {
        const transporter = await createOAuth2Transporter();
        logger.info('SUCCESS: Nodemailer transporter created successfully!');
        // Optional: try sending a test email
        await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: 'yourtestemail@example.com', // Use an email you can check
            subject: 'Test Email from App',
            text: 'This is a test email to check auth.',
        });
        logger.info('Test email sent successfully!');
    } catch (error) {
        logger.error('ERROR: Failed to create transporter or send test email:', error);
    }
}

testAuth();