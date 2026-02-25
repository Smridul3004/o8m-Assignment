/**
 * Agora RTC Token Generation (AccessToken2 format)
 * Generates tokens server-side so credentials never reach the client.
 * 
 * Uses RtcTokenBuilder2 which produces AccessToken2 (007 prefix),
 * compatible with Agora Web SDK v4.x and all modern Agora SDKs.
 * 
 * Requires AGORA_APP_ID and AGORA_APP_CERTIFICATE in environment.
 * If not configured, returns a placeholder token (for demo/development).
 */

const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

function generateAgoraToken(channelName, uid) {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate || appCertificate === 'your_agora_app_certificate') {
        console.warn('Agora credentials not configured — returning demo token');
        return {
            token: `demo_token_${channelName}_${uid}`,
            appId: appId || 'demo_app_id',
            channel: channelName,
            uid,
            isDemo: true,
        };
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + TOKEN_EXPIRY_SECONDS;

    console.log(`[AgoraToken] Generating token for channel=${channelName} uid=${uid} appId=${appId.substring(0, 8)}...`);

    const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        uid,
        RtcRole.PUBLISHER,
        privilegeExpiredTs
    );

    console.log(`[AgoraToken] Token generated, length=${token.length}, prefix=${token.substring(0, 3)}`);

    return {
        token,
        appId,
        channel: channelName,
        uid,
        isDemo: false,
    };
}

module.exports = { generateAgoraToken };
