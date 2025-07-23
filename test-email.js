import { Resend } from 'resend';

// Important: Load environment variables for local testing
import 'dotenv/config';

async function runTest() {
    console.log("Starting Resend API test...");

    const apiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.BUILDER_EMAIL_ADDRESS;

    if (!apiKey || !toEmail) {
        console.error("Error: Missing RESEND_API_KEY or BUILDER_EMAIL_ADDRESS in your environment variables.");
        return;
    }

    const resend = new Resend(apiKey);

    try {
        console.log(`Attempting to send email to ${toEmail}...`);

        const { data, error } = await resend.emails.send({
            from: 'Test Suite <calculator@loamlabsusa.com>',
            to: [toEmail],
            reply_to: 'Support <info@loamlabsusa.com>',
            subject: 'Resend API Test',
            html: '<h1>Success!</h1><p>If you received this, the Resend API connection is working correctly.</p>',
        });

        if (error) {
            console.error("\n--- TEST FAILED ---");
            console.error("Resend API returned an error object:");
            console.error(JSON.stringify(error, null, 2));
        } else {
            console.log("\n--- TEST SUCCESSFUL ---");
            console.log("Resend accepted the email for delivery.");
            console.log("Resend ID:", data.id);
        }

    } catch (e) {
        console.error("\n--- TEST FAILED ---");
        console.error("A critical error occurred during the API call:");
        console.error(e);
    }
}

runTest();
