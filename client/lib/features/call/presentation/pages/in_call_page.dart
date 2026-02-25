import 'dart:async';
import 'package:flutter/material.dart';
import 'package:o8m_marketplace/features/call/data/agora_service.dart';
import 'package:o8m_marketplace/features/call/data/call_socket_service.dart';
import 'package:o8m_marketplace/features/call/presentation/pages/call_ended_page.dart';

/// In-call screen — shown to both CALLER and HOST during an active call.
class InCallPage extends StatefulWidget {
  final String sessionId;
  final String otherUserId;
  final String otherUserName;
  final double ratePerMinute;
  final bool isCaller;
  final String answeredAt;
  final String agoraToken;
  final String agoraAppId;

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
  });

  @override
  State<InCallPage> createState() => _InCallPageState();
}

class _InCallPageState extends State<InCallPage> {
  Timer? _durationTimer;
  int _durationSeconds = 0;
  double _costSoFar = 0;
  bool _muted = false;
  bool _speaker = false;
  bool _lowBalance = false;
  double _remainingBalance = 0;
  bool _callEnded = false;
  final AgoraService _agora = AgoraService();

  @override
  void initState() {
    super.initState();
    _startTimer();
    _setupListeners();
    _initAgora();
  }

  void _initAgora() {
    try {
      _agora.join(
        appId: widget.agoraAppId,
        channel: widget.sessionId,
        token: widget.agoraToken,
        isCaller: widget.isCaller,
      );
      debugPrint('Agora joined (isCaller: ${widget.isCaller})');
    } catch (e) {
      debugPrint('Agora join error: $e');
    }
  }

  void _startTimer() {
    // Calculate elapsed since answered
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
        // Estimate cost based on elapsed minutes
        final minutes = (_durationSeconds / 60).ceil();
        _costSoFar = minutes * widget.ratePerMinute;
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
          ratePerMinute: widget.ratePerMinute,
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
    _agora.dispose();
    CallSocketService.instance.offBillingUpdate();
    CallSocketService.instance.offLowBalanceWarning();
    CallSocketService.instance.offCallEnded();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: IntrinsicHeight(
                  child: Column(
                    children: [
                      const SizedBox(height: 16),
                      // Low balance warning
                      if (_lowBalance && widget.isCaller)
                        Container(
                          margin: const EdgeInsets.symmetric(horizontal: 24),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.orange.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: Colors.orange.withValues(alpha: 0.4),
                            ),
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
                                  style: TextStyle(
                                    color: Colors.orange[300],
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      const Spacer(flex: 2),
                      // Avatar
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
                              color: const Color(
                                0xFF6C63FF,
                              ).withValues(alpha: 0.3),
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
                      // Duration timer
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
                      // Cost / Earnings display
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.06),
                          borderRadius: BorderRadius.circular(20),
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
                      Text(
                        '${widget.ratePerMinute.toStringAsFixed(1)} credits/min',
                        style: TextStyle(color: Colors.grey[600], fontSize: 12),
                      ),
                      const Spacer(flex: 3),
                      // Call controls
                      Padding(
                        padding: const EdgeInsets.only(bottom: 32),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            // Mute
                            _ControlButton(
                              icon: _muted ? Icons.mic_off : Icons.mic,
                              label: _muted ? 'Unmute' : 'Mute',
                              active: _muted,
                              onTap: () {
                                setState(() => _muted = !_muted);
                                _agora.setMicMuted(_muted);
                              },
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
                            // Speaker
                            _ControlButton(
                              icon: _speaker
                                  ? Icons.volume_up
                                  : Icons.volume_down,
                              label: 'Speaker',
                              active: _speaker,
                              onTap: () => setState(() => _speaker = !_speaker),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
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
