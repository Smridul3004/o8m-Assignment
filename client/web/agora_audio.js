/**
 * Agora Voice Call Manager
 * Handles all Agora RTC operations: join, publish mic, play remote audio, leave.
 * Called from Flutter Dart via dart:js_interop @JS() bindings.
 * 
 * Loaded via CDN: AgoraRTC_N-4.23.1.js must be loaded before this file.
 */

let _agoraClient = null;
let _localAudioTrack = null;

/**
 * Join an Agora channel and publish microphone audio.
 * @param {string} appId    - Agora App ID
 * @param {string} channel  - Channel name (= sessionId)
 * @param {string} token    - Agora RTC token from server
 * @param {number} uid      - Numeric user ID (1=caller, 2=host)
 */
async function agoraJoin(appId, channel, token, uid) {
    console.log('[Agora] agoraJoin called with appId:', appId, 'channel:', channel, 'uid:', uid, 'tokenLen:', token ? token.length : 0);

    try {
        // Clean up previous client if any
        if (_agoraClient) {
            console.log('[Agora] Cleaning up previous client');
            try {
                if (_localAudioTrack) {
                    _localAudioTrack.close();
                    _localAudioTrack = null;
                }
                await _agoraClient.leave();
            } catch (e) {
                console.warn('[Agora] Cleanup error (ok):', e);
            }
            _agoraClient = null;
        }

        // Create client in RTC mode (audio only, so codec doesn't matter much)
        _agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

        // ---- Event handlers BEFORE joining ----

        // Handle remote user publishing audio
        _agoraClient.on('user-published', async (user, mediaType) => {
            console.log('[Agora] >>> user-published event: uid=', user.uid, 'mediaType=', mediaType);
            try {
                await _agoraClient.subscribe(user, mediaType);
                console.log('[Agora] Subscribed to user:', user.uid, mediaType);

                if (mediaType === 'audio') {
                    const remoteAudioTrack = user.audioTrack;
                    if (remoteAudioTrack) {
                        remoteAudioTrack.play();
                        console.log('[Agora] ✅ Playing remote audio from uid:', user.uid);
                    } else {
                        console.warn('[Agora] ⚠️ No audioTrack on user after subscribe');
                    }
                }

                // Handle video track (published after audio→video upgrade)
                if (mediaType === 'video') {
                    const remoteVideoTrack = user.videoTrack;
                    if (remoteVideoTrack) {
                        // The remote video container should always be in the DOM now
                        // (Flutter keeps HtmlElementView in the widget tree permanently).
                        // Use _waitForElement with generous timeout as a safety net.
                        const container = (typeof _waitForElement === 'function')
                            ? await _waitForElement('agora-remote-video', 15000)
                            : document.getElementById('agora-remote-video');
                        if (container) {
                            container.innerHTML = '';
                            remoteVideoTrack.play(container);
                            console.log('[Agora] ✅ Playing remote video from uid:', user.uid);
                        } else {
                            // Store for later — agoraUpgradeToVideo can try to replay
                            window._pendingRemoteVideoTrack = remoteVideoTrack;
                            console.warn('[Agora] ⚠️ No #agora-remote-video container — track saved for later');
                        }
                    }
                }
            } catch (subErr) {
                console.error('[Agora] Subscribe error:', subErr);
            }
        });

        _agoraClient.on('user-unpublished', (user, mediaType) => {
            console.log('[Agora] user-unpublished:', user.uid, mediaType);
        });

        _agoraClient.on('user-joined', (user) => {
            console.log('[Agora] 👤 Remote user joined:', user.uid);
        });

        _agoraClient.on('user-left', (user, reason) => {
            console.log('[Agora] 👤 Remote user left:', user.uid, 'reason:', reason);
        });

        _agoraClient.on('connection-state-change', (curState, revState) => {
            console.log('[Agora] Connection state:', revState, '->', curState);
        });

        _agoraClient.on('exception', (event) => {
            console.error('[Agora] Exception event:', event.code, event.msg);
        });

        // Join channel
        const resolvedToken = (token && !token.startsWith('demo_')) ? token : null;
        const numericUid = Number(uid);
        console.log('[Agora] Calling client.join() with numericUid:', numericUid);

        const joinedUid = await _agoraClient.join(appId, channel, resolvedToken, numericUid);
        console.log('[Agora] ✅ Joined channel successfully, assigned uid:', joinedUid);

        // Create and publish local microphone track
        console.log('[Agora] Creating microphone audio track...');
        _localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        console.log('[Agora] Mic track created, publishing...');

        await _agoraClient.publish([_localAudioTrack]);
        console.log('[Agora] ✅ Microphone published successfully');

    } catch (err) {
        console.error('[Agora] ❌ Error in agoraJoin:', err.message || err);
        console.error('[Agora] Error details:', err);
    }
}

/**
 * Mute or unmute the local microphone.
 * @param {boolean} muted
 */
async function agoraMute(muted) {
    if (_localAudioTrack) {
        await _localAudioTrack.setMuted(muted);
        console.log('[Agora] Microphone muted:', muted);
    } else {
        console.warn('[Agora] Cannot mute — no local audio track');
    }
}

/**
 * Leave the Agora channel and clean up resources.
 */
async function agoraLeave() {
    console.log('[Agora] Leaving channel');
    try {
        if (_localAudioTrack) {
            _localAudioTrack.close();
            _localAudioTrack = null;
        }
        if (_agoraClient) {
            await _agoraClient.leave();
            _agoraClient = null;
        }
        console.log('[Agora] ✅ Left channel successfully');
    } catch (err) {
        console.error('[Agora] Error leaving channel:', err);
    }
}
