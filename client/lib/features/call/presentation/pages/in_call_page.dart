import 'dart:async';
import 'dart:html' as html;
import 'package:flutter/material.dart';
import 'package:o8m_marketplace/features/call/data/agora_service.dart';
import 'package:o8m_marketplace/features/call/data/call_socket_service.dart';
import 'package:o8m_marketplace/features/call/presentation/pages/call_ended_page.dart';

/// In-call screen — shown to both CALLER and HOST during an active call.
/// Supports audio-only and video calls, plus audio→video upgrade.
///
/// Remote video container is ALWAYS in the widget tree (behind an opaque
/// overlay in audio mode) so `document.getElementById('agora-remote-video')`
/// succeeds when the JS SDK fires user-published before Flutter switches UI.
class InCallPage extends StatefulWidget {
  final String sessionId;
  final String otherUserId;
  final String otherUserName;
  final double ratePerMinute;
  final bool isCaller;
  final String answeredAt;
  final String agoraToken;
  final String agoraAppId;
  final String callType; // 'AUDIO' or 'VIDEO'

  const InCallPage({
    super.key,
    required this.sessionId,
    required this.otherUserId,
    required this.otherUserName,
    required this.ratePerMinute,
    required this.isCaller,
    required this.answeredAt,
    required this.agoraToken,
    required this.agoraAppId,
    this.callType = 'AUDIO',
  });

  @override
  State<InCallPage> createState() => _InCallPageState();
}

class _InCallPageState extends State<InCallPage> {
  Timer? _durationTimer;
  int _durationSeconds = 0;
  double _costSoFar = 0;
  double _activeRate = 0;
  bool _muted = false;
  bool _cameraOff = false;
  bool _speaker = false;
  bool _lowBalance = false;
  double _remainingBalance = 0;
  bool _callEnded = false;
  bool _peerReconnecting = false;
  bool _isVideo = false;
  bool _upgradeRequested = false;
  final AgoraService _agora = AgoraService();
  StreamSubscription<html.Event>? _cameraErrorSub;

  @override
  void initState() {
    super.initState();
    _isVideo = widget.callType == 'VIDEO';
    _activeRate = widget.ratePerMinute;
    _startTimer();
    _setupListeners();
    _listenCameraError();

    // Wait one frame so the HtmlElementViews are in the DOM
    WidgetsBinding.instance.addPostFrameCallback((_) => _initAgora());
  }

  /// Listen for camera errors dispatched by agora_video.js
  void _listenCameraError() {
    _cameraErrorSub = html.window.on['agora-camera-error'].listen((event) {
      if (!mounted) return;
      final detail = (event as html.CustomEvent).detail;
      final reason =
          (detail is Map ? detail['reason'] : null) ?? 'Camera unavailable';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Camera error: $reason'),
          backgroundColor: Colors.orange,
          behavior: SnackBarBehavior.floating,
        ),
      );
    });
  }

  void _initAgora() {
    try {
      if (_isVideo) {
        _agora.joinVideo(
          appId: widget.agoraAppId,
          channel: widget.sessionId,
          token: widget.agoraToken,
          isCaller: widget.isCaller,
        );
      } else {
        _agora.join(
          appId: widget.agoraAppId,
          channel: widget.sessionId,
          token: widget.agoraToken,
          isCaller: widget.isCaller,
        );
      }
      debugPrint(
        'Agora joined (isCaller: ${widget.isCaller}, video: $_isVideo)',
      );
    } catch (e) {
      debugPrint('Agora join error: $e');
    }
  }

  void _startTimer() {
    final answered = DateTime.tryParse(widget.answeredAt);
    if (answered != null) {
      _durationSeconds = DateTime.now()
          .difference(answered)
          .inSeconds
          .clamp(0, 99999);
    }

    _durationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _callEnded) return;
      setState(() {
        _durationSeconds++;
        final minutes = (_durationSeconds / 60).ceil();
        _costSoFar = minutes * _activeRate;
      });
    });
  }

  void _setupListeners() {
    final socket = CallSocketService.instance;

    socket.onBillingUpdate((data) {
      if (!mounted) return;
      setState(() {
        _costSoFar = (data['costSoFar'] as num?)?.toDouble() ?? _costSoFar;
        _remainingBalance =
            (data['remainingBalance'] as num?)?.toDouble() ?? _remainingBalance;
        if (data['durationSeconds'] != null) {
          _durationSeconds = data['durationSeconds'] as int;
        }
      });
    });

    socket.onLowBalanceWarning((data) {
      if (!mounted) return;
      setState(() {
        _lowBalance = true;
        _remainingBalance =
            (data['remainingBalance'] as num?)?.toDouble() ?? _remainingBalance;
      });
    });

    socket.onCallEnded((data) {
      if (!mounted || _callEnded) return;
      _callEnded = true;
      _durationTimer?.cancel();
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => CallEndedPage(
            otherUserName: widget.otherUserName,
            durationSeconds: data['durationSeconds'] ?? _durationSeconds,
            totalCost: (data['totalCost'] as num?)?.toDouble() ?? _costSoFar,
            ratePerMinute:
                (data['ratePerMinute'] as num?)?.toDouble() ??
                widget.ratePerMinute,
            reason: data['reason'] ?? 'ENDED',
            isCaller: widget.isCaller,
          ),
        ),
      );
    });

    socket.onPeerReconnecting((data) {
      if (!mounted) return;
      setState(() => _peerReconnecting = true);
    });

    socket.onCallReconnected((data) {
      if (!mounted) return;
      setState(() => _peerReconnecting = false);
    });

    socket.onUpgradeRequested((data) {
      if (!mounted) return;
      _showUpgradeRequestDialog();
    });

    socket.onUpgradeAccepted((data) {
      if (!mounted) return;
      final newRate = (data['ratePerMinute'] as num?)?.toDouble();
      setState(() {
        _isVideo = true;
        _upgradeRequested = false;
        if (newRate != null && newRate > 0) _activeRate = newRate;
      });
      _agora.upgradeToVideo();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Upgrade accepted — video enabled'),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
        ),
      );
    });

    socket.onUpgradeDeclined((data) {
      if (!mounted) return;
      setState(() => _upgradeRequested = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Upgrade to video was declined'),
          backgroundColor: Colors.orange,
          behavior: SnackBarBehavior.floating,
        ),
      );
    });

    socket.onTokenRefreshed((data) {
      debugPrint('Agora token refreshed');
    });
  }

  void _showUpgradeRequestDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text(
          'Video Upgrade Request',
          style: TextStyle(color: Colors.white),
        ),
        content: Text(
          '${widget.otherUserName} wants to upgrade to a video call.',
          style: TextStyle(color: Colors.grey[300]),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              CallSocketService.instance.declineUpgrade(widget.sessionId);
            },
            child: const Text('Decline', style: TextStyle(color: Colors.red)),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              CallSocketService.instance.acceptUpgrade(widget.sessionId);
              setState(() => _isVideo = true);
              _agora.upgradeToVideo();
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Accept'),
          ),
        ],
      ),
    );
  }

  void _requestUpgrade() {
    setState(() => _upgradeRequested = true);
    CallSocketService.instance.requestUpgrade(widget.sessionId);
  }

  void _endCall() {
    if (_callEnded) return;
    _callEnded = true;
    CallSocketService.instance.endCall(widget.sessionId);
    _durationTimer?.cancel();

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => CallEndedPage(
          otherUserName: widget.otherUserName,
          durationSeconds: _durationSeconds,
          totalCost: _costSoFar,
          ratePerMinute: _activeRate,
          reason: widget.isCaller ? 'CALLER_ENDED' : 'HOST_ENDED',
          isCaller: widget.isCaller,
        ),
      ),
    );
  }

  String _formatDuration(int seconds) {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    _cameraErrorSub?.cancel();
    _agora.dispose();
    final socket = CallSocketService.instance;
    socket.offBillingUpdate();
    socket.offLowBalanceWarning();
    socket.offCallEnded();
    socket.offPeerReconnecting();
    socket.offCallReconnected();
    socket.offUpgradeRequested();
    socket.offUpgradeAccepted();
    socket.offUpgradeDeclined();
    socket.offTokenRefreshed();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // The remote video HtmlElementView is ALWAYS in the tree so its <div>
    // exists when the JS SDK fires user-published.  In audio mode an opaque
    // overlay covers it.
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      body: Stack(
        children: [
          // ── Remote video — always present ──────────────────────────────
          const Positioned.fill(
            child: HtmlElementView(viewType: 'agora-remote-video'),
          ),

          // ── Audio mode: opaque overlay over the remote video ──────────
          if (!_isVideo)
            Positioned.fill(
              child: Container(
                color: const Color(0xFF0D0D1A),
                child: _buildAudioCallUI(),
              ),
            ),

          // ── Video mode: local PIP + overlays ──────────────────────────
          if (_isVideo) ..._buildVideoOverlays(),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIDEO OVERLAYS — WhatsApp-style: remote already fullscreen, PIP local
  // ─────────────────────────────────────────────────────────────────────────
  List<Widget> _buildVideoOverlays() {
    return [
      // ── Local video PIP (top-right) ───────────────────────────────────
      Positioned(
        top: MediaQuery.of(context).padding.top + 12,
        right: 16,
        child: Container(
          width: 110,
          height: 150,
          decoration: BoxDecoration(
            color: Colors.black,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white24, width: 1.5),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.5),
                blurRadius: 10,
                spreadRadius: 2,
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: const HtmlElementView(viewType: 'agora-local-video'),
        ),
      ),

      // ── Top info bar ──────────────────────────────────────────────────
      Positioned(
        top: MediaQuery.of(context).padding.top + 8,
        left: 16,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: Colors.greenAccent,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                widget.otherUserName,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 12),
              Text(
                _formatDuration(_durationSeconds),
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 13,
                  fontFamily: 'monospace',
                ),
              ),
            ],
          ),
        ),
      ),

      // ── Peer reconnecting banner ──────────────────────────────────────
      if (_peerReconnecting)
        Positioned(
          top: MediaQuery.of(context).padding.top + 56,
          left: 16,
          right: 16,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.blue.withValues(alpha: 0.8),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '${widget.otherUserName} is reconnecting…',
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                ),
              ],
            ),
          ),
        ),

      // ── Low balance warning ───────────────────────────────────────────
      if (_lowBalance && widget.isCaller)
        Positioned(
          top:
              MediaQuery.of(context).padding.top +
              (_peerReconnecting ? 96 : 56),
          left: 16,
          right: 16,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.orange.withValues(alpha: 0.85),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Row(
              children: [
                Icon(
                  Icons.warning_amber_rounded,
                  color: Colors.white,
                  size: 18,
                ),
                SizedBox(width: 8),
                Text(
                  'Low balance — call will end soon',
                  style: TextStyle(color: Colors.white, fontSize: 13),
                ),
              ],
            ),
          ),
        ),

      // ── Bottom controls overlay ───────────────────────────────────────
      Positioned(
        left: 0,
        right: 0,
        bottom: 0,
        child: Container(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 16,
            bottom: MediaQuery.of(context).padding.bottom + 24,
          ),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Colors.transparent,
                Colors.black.withValues(alpha: 0.7),
                Colors.black.withValues(alpha: 0.85),
              ],
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Cost pill
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      widget.isCaller
                          ? Icons.arrow_upward
                          : Icons.arrow_downward,
                      color: widget.isCaller
                          ? Colors.redAccent
                          : Colors.greenAccent,
                      size: 14,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      widget.isCaller
                          ? '${_costSoFar.toStringAsFixed(1)} credits'
                          : '${(_costSoFar * 0.7).toStringAsFixed(1)} earned',
                      style: TextStyle(
                        color: widget.isCaller
                            ? Colors.redAccent
                            : Colors.greenAccent,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '• ${_activeRate.toStringAsFixed(1)}/min',
                      style: TextStyle(color: Colors.grey[400], fontSize: 11),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              // Control buttons
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _ControlButton(
                    icon: _muted ? Icons.mic_off : Icons.mic,
                    label: _muted ? 'Unmute' : 'Mute',
                    active: _muted,
                    onTap: () {
                      setState(() => _muted = !_muted);
                      _agora.setMicMuted(_muted);
                    },
                  ),
                  _ControlButton(
                    icon: _cameraOff ? Icons.videocam_off : Icons.videocam,
                    label: _cameraOff ? 'Cam On' : 'Cam Off',
                    active: _cameraOff,
                    onTap: () {
                      setState(() => _cameraOff = !_cameraOff);
                      _agora.setCameraDisabled(_cameraOff);
                    },
                  ),
                  // End Call
                  GestureDetector(
                    onTap: _endCall,
                    child: Container(
                      width: 62,
                      height: 62,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.redAccent,
                      ),
                      child: const Icon(
                        Icons.call_end,
                        color: Colors.white,
                        size: 30,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIO CALL — classic centered layout
  // ─────────────────────────────────────────────────────────────────────────
  Widget _buildAudioCallUI() {
    return SafeArea(
      child: Column(
        children: [
          const SizedBox(height: 16),

          // Peer reconnecting banner
          if (_peerReconnecting)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 24),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.blue.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.blue.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.blue,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${widget.otherUserName} is reconnecting…',
                      style: const TextStyle(color: Colors.blue, fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),

          // Low balance warning
          if (_lowBalance && widget.isCaller)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 24, vertical: 4),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.orange.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.orange.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.warning_amber_rounded,
                    color: Colors.orangeAccent,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Low balance — call will end soon',
                      style: TextStyle(color: Colors.orange[300], fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),

          const Spacer(flex: 2),

          // Audio-only avatar
          Container(
            width: 90,
            height: 90,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                colors: [Color(0xFF6C63FF), Color(0xFF4A42D1)],
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF6C63FF).withValues(alpha: 0.3),
                  blurRadius: 24,
                  spreadRadius: 4,
                ),
              ],
            ),
            child: Center(
              child: Text(
                widget.otherUserName.isNotEmpty
                    ? widget.otherUserName[0].toUpperCase()
                    : '?',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 36,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),

          const SizedBox(height: 16),
          Text(
            widget.otherUserName,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          // Duration
          Text(
            _formatDuration(_durationSeconds),
            style: const TextStyle(
              color: Colors.greenAccent,
              fontSize: 36,
              fontWeight: FontWeight.w300,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(height: 12),
          // Cost pill
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  widget.isCaller ? Icons.arrow_upward : Icons.arrow_downward,
                  color: widget.isCaller
                      ? Colors.redAccent
                      : Colors.greenAccent,
                  size: 16,
                ),
                const SizedBox(width: 6),
                Text(
                  widget.isCaller
                      ? '${_costSoFar.toStringAsFixed(1)} credits spent'
                      : '${(_costSoFar * 0.7).toStringAsFixed(1)} credits earned',
                  style: TextStyle(
                    color: widget.isCaller
                        ? Colors.redAccent
                        : Colors.greenAccent,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.mic, color: Colors.grey[600], size: 14),
              const SizedBox(width: 4),
              Text(
                '${_activeRate.toStringAsFixed(1)} credits/min',
                style: TextStyle(color: Colors.grey[600], fontSize: 12),
              ),
            ],
          ),
          const Spacer(),

          // Controls
          Padding(
            padding: const EdgeInsets.only(bottom: 32),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _ControlButton(
                  icon: _muted ? Icons.mic_off : Icons.mic,
                  label: _muted ? 'Unmute' : 'Mute',
                  active: _muted,
                  onTap: () {
                    setState(() => _muted = !_muted);
                    _agora.setMicMuted(_muted);
                  },
                ),
                // Upgrade to video (caller only)
                if (widget.isCaller)
                  _ControlButton(
                    icon: Icons.videocam,
                    label: _upgradeRequested ? 'Pending…' : 'Video',
                    active: _upgradeRequested,
                    onTap: _upgradeRequested ? () {} : _requestUpgrade,
                  ),
                // End Call
                GestureDetector(
                  onTap: _endCall,
                  child: Container(
                    width: 64,
                    height: 64,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.redAccent,
                    ),
                    child: const Icon(
                      Icons.call_end,
                      color: Colors.white,
                      size: 32,
                    ),
                  ),
                ),
                _ControlButton(
                  icon: _speaker ? Icons.volume_up : Icons.volume_down,
                  label: 'Speaker',
                  active: _speaker,
                  onTap: () => setState(() => _speaker = !_speaker),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _ControlButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: active
                  ? Colors.white.withValues(alpha: 0.2)
                  : Colors.white.withValues(alpha: 0.08),
            ),
            child: Icon(
              icon,
              color: active ? Colors.white : Colors.grey[400],
              size: 26,
            ),
          ),
          const SizedBox(height: 6),
          Text(label, style: TextStyle(color: Colors.grey[500], fontSize: 12)),
        ],
      ),
    );
  }
}
