/**
 * WebRTC Audio Helper — called from Dart via js_util.
 * All audio playback is done entirely in JS to avoid Dart↔JS type-bridging.
 */
function playWebRTCStream(stream) {
    console.log('[WebRTC-JS] playWebRTCStream called');
    console.log('[WebRTC-JS] stream:', stream);
    console.log('[WebRTC-JS] stream type:', typeof stream);
    console.log('[WebRTC-JS] is MediaStream:', stream instanceof MediaStream);

    // Remove any existing WebRTC audio element
    var existing = document.getElementById('webrtc-remote-audio');
    if (existing) {
        existing.pause();
        existing.srcObject = null;
        existing.remove();
        console.log('[WebRTC-JS] Removed previous audio element');
    }

    // Log stream tracks
    var tracks = stream.getAudioTracks();
    console.log('[WebRTC-JS] Audio tracks in stream: ' + tracks.length);
    tracks.forEach(function (track, i) {
        console.log('[WebRTC-JS] Track ' + i + ': id=' + track.id +
            ' enabled=' + track.enabled +
            ' muted=' + track.muted +
            ' readyState=' + track.readyState);
    });

    // Create and configure audio element
    var audio = document.createElement('audio');
    audio.id = 'webrtc-remote-audio';
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1.0;

    // Set the stream as the source
    audio.srcObject = stream;
    document.body.appendChild(audio);

    console.log('[WebRTC-JS] Audio element created, srcObject set');
    console.log('[WebRTC-JS] audio.srcObject === stream:', audio.srcObject === stream);
    console.log('[WebRTC-JS] audio.paused:', audio.paused);

    // Force play
    var playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.then(function () {
            console.log('[WebRTC-JS] play() SUCCEEDED');
            console.log('[WebRTC-JS] paused=' + audio.paused +
                ' readyState=' + audio.readyState +
                ' volume=' + audio.volume +
                ' muted=' + audio.muted +
                ' currentTime=' + audio.currentTime);
        }).catch(function (error) {
            console.error('[WebRTC-JS] play() FAILED:', error);
        });
    }
}

function stopWebRTCStream() {
    var existing = document.getElementById('webrtc-remote-audio');
    if (existing) {
        existing.pause();
        existing.srcObject = null;
        existing.remove();
        console.log('[WebRTC-JS] Audio stopped and removed');
    }
}
