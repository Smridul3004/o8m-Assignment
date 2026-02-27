import 'dart:js_interop';

// ── Audio-only bindings (agora_audio.js) ──────────────────────────────────
@JS('agoraJoin')
external void _agoraJoin(
  JSString appId,
  JSString channel,
  JSString token,
  JSNumber uid,
);

@JS('agoraMute')
external void _agoraMute(JSBoolean muted);

@JS('agoraLeave')
external void _agoraLeave();

// ── Video bindings (agora_video.js) ───────────────────────────────────────
@JS('agoraVideoJoin')
external void _agoraVideoJoin(
  JSString appId,
  JSString channel,
  JSString token,
  JSNumber uid,
);

@JS('agoraUpgradeToVideo')
external void _agoraUpgradeToVideo();

@JS('agoraVideoMuteMic')
external void _agoraVideoMuteMic(JSBoolean muted);

@JS('agoraVideoToggleCamera')
external void _agoraVideoToggleCamera(JSBoolean disabled);

@JS('agoraVideoLeave')
external void _agoraVideoLeave();

/// Thin wrapper around the JS Agora functions.
/// All calls are fire-and-forget (the JS side is async).
class AgoraService {
  bool _isVideo = false;
  bool get isVideo => _isVideo;

  /// Join an audio-only channel.
  void join({
    required String appId,
    required String channel,
    required String token,
    required bool isCaller,
  }) {
    _isVideo = false;
    final uid = isCaller ? 1 : 2;
    _agoraJoin(appId.toJS, channel.toJS, token.toJS, uid.toJS);
  }

  /// Join a video channel (camera + mic).
  void joinVideo({
    required String appId,
    required String channel,
    required String token,
    required bool isCaller,
  }) {
    _isVideo = true;
    final uid = isCaller ? 1 : 2;
    _agoraVideoJoin(appId.toJS, channel.toJS, token.toJS, uid.toJS);
  }

  /// Upgrade an existing audio call to video.
  void upgradeToVideo() {
    _isVideo = true;
    _agoraUpgradeToVideo();
  }

  /// Mute / unmute the local microphone.
  void setMicMuted(bool muted) {
    if (_isVideo) {
      _agoraVideoMuteMic(muted.toJS);
    } else {
      _agoraMute(muted.toJS);
    }
  }

  /// Enable / disable the local camera (video calls only).
  void setCameraDisabled(bool disabled) {
    if (!_isVideo) return;
    _agoraVideoToggleCamera(disabled.toJS);
  }

  /// Leave the channel and clean up.
  void dispose() {
    if (_isVideo) {
      _agoraVideoLeave();
    }
    // Always clean up the audio client:
    // - In audio-only mode this is the primary cleanup.
    // - In upgrade mode (_agoraClient was used for video too) this is essential
    //   because agoraVideoLeave() only leaves _videoClient (null in upgrade mode).
    // - In pure video mode _agoraClient is null so this is a harmless no-op.
    _agoraLeave();
  }
}
