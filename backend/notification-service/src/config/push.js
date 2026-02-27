/**
 * Push notification delivery via Firebase Cloud Messaging.
 * 
 * If FIREBASE_SERVICE_ACCOUNT_PATH is not set, push is logged but not sent.
 * This allows the service to work in development without Firebase credentials.
 */
const PushToken = require('../models/PushToken');

let admin = null;

try {
    const firebaseAdmin = require('firebase-admin');
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath) {
        const serviceAccount = require(serviceAccountPath);
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(serviceAccount),
        });
        admin = firebaseAdmin;
        console.log('Firebase Admin initialized for push notifications');
    } else {
        console.log('No Firebase credentials — push notifications will be logged only');
    }
} catch (err) {
    console.warn('Firebase Admin init failed:', err.message);
}

/**
 * Send a push notification to all devices registered for a user.
 */
async function sendPushToUser(userId, { title, body, data }) {
    const tokens = await PushToken.find({ userId });
    if (!tokens.length) {
        console.log(`No push tokens for user ${userId}`);
        return;
    }

    if (!admin) {
        console.log(`[Push-Log] → ${userId}: ${title} — ${body}`);
        return;
    }

    const messaging = admin.messaging();
    const results = await Promise.allSettled(
        tokens.map(t =>
            messaging.send({
                token: t.token,
                notification: { title, body },
                data: Object.fromEntries(
                    Object.entries(data || {}).map(([k, v]) => [k, String(v)])
                ),
            })
        )
    );

    // Clean up invalid tokens
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
            const err = results[i].reason;
            if (
                err?.code === 'messaging/registration-token-not-registered' ||
                err?.code === 'messaging/invalid-registration-token'
            ) {
                await PushToken.deleteOne({ _id: tokens[i]._id });
                console.log(`Removed invalid push token for user ${userId}`);
            }
        }
    }
}

module.exports = { sendPushToUser };
