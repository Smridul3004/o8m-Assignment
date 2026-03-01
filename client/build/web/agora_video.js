/**
 * Agora Video Call Manager
 * Handles Agora RTC video operations: join with camera, toggle, play remote video.
 *
 * With Flutter's HTML renderer (forced in index.html), HtmlElementView divs
 * live directly in document so getElementById() works reliably.
 *
 * CDN dependency: AgoraRTC_N-4.23.1.js must be loaded before this file.
 */

let _videoClient = null;
let _localVideoTrack = null;
let _localVideoAudioTrack = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for an element with the given id to appear in the DOM.
 * Returns the element, or null after timeout.
 */
function _waitForElement(id, maxMs = 15000) {
    return new Promise(resolve => {
        // Immediate check
        let el = document.getElementById(id);
        if (el) { resolve(el); return; }

        const start = Date.now();
        const iv = setInterval(() => {
            el = document.getElementById(id);
            if (el || Date.now() - start > maxMs) {
                clearInterval(iv);
                if (el) {
                    console.log('[AgoraVideo] Found #' + id + ' after ' + (Date.now() - start) + 'ms');
                } else {
                    console.warn('[AgoraVideo] #' + id + ' not found within ' + maxMs + 'ms');
                }
                resolve(el);
            }
        }, 100);
    });
}

/**
 * Try to create a camera video track.  On NOT_READABLE ("device in use")
 * we enumerate all cameras and try each one – handles the case where two
 * browser tabs on the same machine are sharing a multi-camera setup.
 * Returns the track, or null if every attempt fails.
 */
async function _tryCreateCameraTrack() {
    // 1st attempt – default camera
    try {
        const track = await AgoraRTC.createCameraVideoTrack();
        console.log('[AgoraVideo] Camera track created (default)');
        return track;
    } catch (e) {
        console.warn('[AgoraVideo] Default camera failed:', e.code || '', e.message);
    }

    // Wait – the camera might still be releasing from a previous call
    await new Promise(r => setTimeout(r, 1500));

    // 2nd attempt – default camera again after delay
    try {
        const track = await AgoraRTC.createCameraVideoTrack();
        console.log('[AgoraVideo] Camera track created (retry)');
        return track;
    } catch (e) {
        console.warn('[AgoraVideo] Default camera retry failed:', e.code || '', e.message);
    }

    // 3rd attempt – try every available camera by deviceId
    try {
        const cameras = await AgoraRTC.getCameras();
        console.log('[AgoraVideo] Trying ' + cameras.length + ' camera(s)…');
        for (const cam of cameras) {
            try {
                const track = await AgoraRTC.createCameraVideoTrack({ cameraId: cam.deviceId });
                console.log('[AgoraVideo] Camera track created via device:', cam.label);
                return track;
            } catch (ce) {
                console.warn('[AgoraVideo] Camera "' + cam.label + '" failed:', ce.code || '', ce.message);
            }
        }
    } catch (enumErr) {
        console.warn('[AgoraVideo] getCameras() failed:', enumErr.message);
    }

    // All attempts failed – fire DOM event so Flutter can show a message
    console.error('[AgoraVideo] ✖ Camera unavailable (all attempts failed)');
    window.dispatchEvent(new CustomEvent('agora-camera-error', {
        detail: { reason: 'Camera is being used by another application or tab' }
    }));
    return null;
}

/**
 * Create local mic + camera tracks.
 */
async function _createTracks() {
    // Attempt 1 – combined (fastest path)
    try {
        console.log('[AgoraVideo] Creating mic+camera tracks (combined)…');
        const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
        _localVideoAudioTrack = tracks[0];
        _localVideoTrack = tracks[1];
        console.log('[AgoraVideo] Mic+camera tracks created');
        return;
    } catch (e) {
        console.warn('[AgoraVideo] Combined create failed:', e.message);
    }

    // Separate: mic first (almost always succeeds)
    try {
        _localVideoAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        console.log('[AgoraVideo] Mic track OK');
    } catch (e) { console.error('[AgoraVideo] Mic fail:', e.message); }

    // Camera with retries + alternative devices
    _localVideoTrack = await _tryCreateCameraTrack();
}

// ---------------------------------------------------------------------------
// Reconnection helper
// ---------------------------------------------------------------------------

/**
 * Re-publish local tracks after a reconnection event.
 * Called when connection state goes from RECONNECTING/DISCONNECTED -> CONNECTED
 */
async function _republishTracksAfterReconnect() {
    if (!_videoClient) return;
    
    try {
        // Check if tracks still exist and are valid
        const tracksToPublish = [];
        
        if (_localVideoAudioTrack && !_localVideoAudioTrack.isClosed) {
            tracksToPublish.push(_localVideoAudioTrack);
        }
        if (_localVideoTrack && !_localVideoTrack.isClosed) {
            tracksToPublish.push(_localVideoTrack);
        }
        
        if (tracksToPublish.length > 0) {
            // Only republish if not already published
            const published = _videoClient.localTracks || [];
            const needsRepublish = tracksToPublish.filter(t => !published.includes(t));
            
            if (needsRepublish.length > 0) {
                await _videoClient.publish(needsRepublish);
                console.log('[AgoraVideo] Re-published ' + needsRepublish.length + ' track(s) after reconnect');
            }
        }
        
        // Re-play local preview if needed
        if (_localVideoTrack && !_localVideoTrack.isClosed) {
            const localEl = document.getElementById('agora-local-video');
            if (localEl && localEl.innerHTML === '') {
                _localVideoTrack.play(localEl);
                console.log('[AgoraVideo] Re-played local preview after reconnect');
            }
        }
    } catch (err) {
        console.error('[AgoraVideo] Re-publish after reconnect error:', err.message || err);
    }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function _cleanup() {
    if (_localVideoTrack) { try { _localVideoTrack.close(); } catch (_) { } _localVideoTrack = null; }
    if (_localVideoAudioTrack) { try { _localVideoAudioTrack.close(); } catch (_) { } _localVideoAudioTrack = null; }
    if (_videoClient) {
        try { await _videoClient.leave(); } catch (e) { console.warn('[AgoraVideo] leave:', e.message || e); }
        _videoClient = null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Join an Agora channel with camera + mic (video call).
 * @param {string} appId
 * @param {string} channel   – sessionId
 * @param {string} token
 * @param {number} uid       – 1 = caller, 2 = host
 */
async function agoraVideoJoin(appId, channel, token, uid) {
    console.log('[AgoraVideo] JOIN  channel=' + channel + '  uid=' + uid);

    try {
        // ── 1. Clean up any previous session ────────────────────────────
        await _cleanup();

        // ── 2. Create Agora client ──────────────────────────────────────
        _videoClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

        // ── 3. Register event handlers BEFORE joining ───────────────────

        _videoClient.on('user-published', async (user, mediaType) => {
            console.log('[AgoraVideo] user-published  uid=' + user.uid + '  type=' + mediaType);
            try {
                await _videoClient.subscribe(user, mediaType);

                if (mediaType === 'audio') {
                    const t = user.audioTrack;
                    if (t) { t.play(); console.log('[AgoraVideo] Remote AUDIO playing  uid=' + user.uid); }
                }

                if (mediaType === 'video') {
                    const remoteTrack = user.videoTrack;
                    if (!remoteTrack) return;

                    const container = await _waitForElement('agora-remote-video');
                    if (container) {
                        container.innerHTML = '';
                        remoteTrack.play(container);
                        console.log('[AgoraVideo] Remote VIDEO playing  uid=' + user.uid);
                    } else {
                        console.error('[AgoraVideo] Remote video container NOT found');
                    }
                }
            } catch (err) {
                console.error('[AgoraVideo] subscribe error:', err);
            }
        });

        _videoClient.on('user-unpublished', (u, t) =>
            console.log('[AgoraVideo] user-unpublished  uid=' + u.uid + '  type=' + t));
        _videoClient.on('user-joined', (u) =>
            console.log('[AgoraVideo] user-joined  uid=' + u.uid));
        _videoClient.on('user-left', (u, r) =>
            console.log('[AgoraVideo] user-left  uid=' + u.uid + '  reason=' + r));
        
        // Handle connection state changes for reconnection
        _videoClient.on('connection-state-change', (cur, prev) => {
            console.log('[AgoraVideo] conn-state  ' + prev + ' -> ' + cur);
            // Notify Flutter of connection state changes
            window.dispatchEvent(new CustomEvent('agora-connection-state', {
                detail: { current: cur, previous: prev }
            }));
            
            // Handle reconnection scenarios
            if (cur === 'DISCONNECTED' && prev === 'CONNECTED') {
                console.warn('[AgoraVideo] Connection lost, Agora will auto-reconnect');
            } else if (cur === 'CONNECTED' && (prev === 'RECONNECTING' || prev === 'DISCONNECTED')) {
                console.log('[AgoraVideo] Reconnected successfully');
                // Re-publish local tracks after reconnection
                _republishTracksAfterReconnect();
            }
        });

        // ── 4. Join the channel ─────────────────────────────────────────
        const resolvedToken = (token && !token.startsWith('demo_')) ? token : null;
        const joinedUid = await _videoClient.join(appId, channel, resolvedToken, Number(uid));
        console.log('[AgoraVideo] Joined  uid=' + joinedUid);

        // ── 5. Create local tracks ──────────────────────────────────────
        await _createTracks();

        // ── 6. Play local camera preview ────────────────────────────────
        if (_localVideoTrack) {
            const localEl = await _waitForElement('agora-local-video');
            if (localEl) {
                localEl.innerHTML = '';
                _localVideoTrack.play(localEl);
                console.log('[AgoraVideo] Local VIDEO preview playing');
            } else {
                console.warn('[AgoraVideo] Local video container not found');
            }
        }

        // ── 7. Publish tracks ───────────────────────────────────────────
        const toPublish = [_localVideoAudioTrack, _localVideoTrack].filter(Boolean);
        if (toPublish.length > 0) {
            await _videoClient.publish(toPublish);
            console.log('[AgoraVideo] Published ' + toPublish.length + ' track(s)');
        } else {
            console.error('[AgoraVideo] Nothing to publish');
        }

    } catch (err) {
        console.error('[AgoraVideo] agoraVideoJoin ERROR:', err.message || err);
    }
}

/**
 * Upgrade an existing audio call to include video.
 * Uses _agoraClient (from agora_audio.js) which is already in a channel.
 */
async function agoraUpgradeToVideo() {
    console.log('[AgoraVideo] Upgrading to video…');
    try {
        if (!_agoraClient) {
            console.error('[AgoraVideo] No audio client');
            return;
        }

        // Try to get a camera track (with retries + alternative devices)
        _localVideoTrack = await _tryCreateCameraTrack();

        if (!_localVideoTrack) {
            console.error('[AgoraVideo] Cannot upgrade — no camera available');
            return;
        }

        const el = await _waitForElement('agora-local-video');
        if (el) {
            el.innerHTML = '';
            _localVideoTrack.play(el);
            console.log('[AgoraVideo] Local preview (upgrade)');
        }

        await _agoraClient.publish([_localVideoTrack]);
        console.log('[AgoraVideo] Video published (upgrade)');

        // If agora_audio.js saved a pending remote video track (because the
        // container wasn't available when user-published first fired), play it now.
        if (window._pendingRemoteVideoTrack) {
            const remoteEl = document.getElementById('agora-remote-video');
            if (remoteEl) {
                remoteEl.innerHTML = '';
                window._pendingRemoteVideoTrack.play(remoteEl);
                console.log('[AgoraVideo] Played pending remote video track');
            }
            window._pendingRemoteVideoTrack = null;
        }
    } catch (err) {
        console.error('[AgoraVideo] upgrade error:', err.message || err);
        // Fire event so Flutter UI can notify the user
        window.dispatchEvent(new CustomEvent('agora-camera-error', {
            detail: { reason: err.message || 'Camera upgrade failed' }
        }));
    }
}

/**
 * Mute / unmute the local microphone in a video call.
 */
async function agoraVideoMuteMic(muted) {
    if (_localVideoAudioTrack) { await _localVideoAudioTrack.setMuted(muted); }
    else if (_localAudioTrack) { await _localAudioTrack.setMuted(muted); }
    else { console.warn('[AgoraVideo] No audio track to mute'); return; }
    console.log('[AgoraVideo] Mic muted:', muted);
}

/**
 * Enable / disable the local camera.
 */
async function agoraVideoToggleCamera(disabled) {
    if (_localVideoTrack) {
        await _localVideoTrack.setMuted(disabled);
        console.log('[AgoraVideo] Camera disabled:', disabled);
    }
}

/**
 * Leave the video channel and clean up.
 */
async function agoraVideoLeave() {
    console.log('[AgoraVideo] LEAVE');
    try {
        if (_localVideoTrack) {
            const client = _videoClient || _agoraClient;
            if (client) { try { await client.unpublish([_localVideoTrack]); } catch (_) { } }
        }
        await _cleanup();
        console.log('[AgoraVideo] Left channel');
    } catch (err) {
        console.error('[AgoraVideo] leave error:', err);
    }
}
