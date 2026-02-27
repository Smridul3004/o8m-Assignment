import 'dart:async';
import 'package:flutter/material.dart';
import 'package:o8m_marketplace/features/call/data/call_socket_service.dart';
import 'package:o8m_marketplace/features/call/presentation/pages/in_call_page.dart';

/// Incoming call screen — shown to the HOST when a caller requests.
class IncomingCallPage extends StatefulWidget {
  final String sessionId;
  final String callerId;
  final String callerName;
  final String callType;
  final double ratePerMinute;

  const IncomingCallPage({
    super.key,
    required this.sessionId,
    required this.callerId,
    required this.callerName,
    required this.callType,
    required this.ratePerMinute,
  });

  @override
  State<IncomingCallPage> createState() => _IncomingCallPageState();
}

class _IncomingCallPageState extends State<IncomingCallPage>
    with SingleTickerProviderStateMixin {
  late AnimationController _ringController;
  Timer? _autoDeclineTimer;
  int _countdown = 30;
  bool _responded = false;

  @override
  void initState() {
    super.initState();
    _ringController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..repeat(reverse: true);

    // Auto-dismiss after 30s
    _autoDeclineTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _countdown--);
      if (_countdown <= 0) {
        timer.cancel();
        if (!_responded && mounted) {
          Navigator.pop(context);
        }
      }
    });

    _setupListeners();
  }

  void _setupListeners() {
    CallSocketService.instance.onCallCancelled((data) {
      if (!mounted || _responded) return;
      _responded = true;
      Navigator.pop(context);
    });

    CallSocketService.instance.onCallExpired((data) {
      if (!mounted || _responded) return;
      _responded = true;
      Navigator.pop(context);
    });
  }

  void _accept() {
    if (_responded) return;
    _responded = true;
    CallSocketService.instance.acceptCall(widget.sessionId);

    // Listen for acceptance confirmation
    CallSocketService.instance.onCallAccepted((data) {
      if (!mounted) return;
      // agoraToken is an object: {token, appId, channel, uid}
      final agoraData = data['agoraToken'] as Map? ?? {};
      final token = agoraData['token']?.toString() ?? '';
      final appId = agoraData['appId']?.toString() ?? '';
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => InCallPage(
            sessionId: data['sessionId'] ?? widget.sessionId,
            otherUserId: widget.callerId,
            otherUserName: widget.callerName,
            ratePerMinute: widget.ratePerMinute,
            isCaller: false,
            answeredAt: data['answeredAt'] ?? DateTime.now().toIso8601String(),
            agoraToken: token,
            agoraAppId: appId,
            callType: data['callType'] ?? widget.callType,
          ),
        ),
      );
    });
  }

  void _decline() {
    if (_responded) return;
    _responded = true;
    CallSocketService.instance.declineCall(widget.sessionId);
    Navigator.pop(context);
  }

  @override
  void dispose() {
    _ringController.dispose();
    _autoDeclineTimer?.cancel();
    CallSocketService.instance.offCallCancelled();
    CallSocketService.instance.offCallExpired();
    CallSocketService.instance.offCallAccepted();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),
            // Avatar with ring animation
            AnimatedBuilder(
              animation: _ringController,
              builder: (context, child) {
                return Container(
                  width: 130,
                  height: 130,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: Colors.greenAccent.withValues(
                        alpha: 0.5 + _ringController.value * 0.5,
                      ),
                      width: 3 + _ringController.value * 2,
                    ),
                  ),
                  child: Container(
                    margin: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [
                          Colors.green.withValues(alpha: 0.8),
                          Colors.teal.withValues(alpha: 0.6),
                        ],
                      ),
                    ),
                    child: Center(
                      child: Text(
                        widget.callerName.isNotEmpty
                            ? widget.callerName[0].toUpperCase()
                            : '?',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 48,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 32),
            Text(
              widget.callerName,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 28,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${widget.callType} Call • $_countdown s',
              style: TextStyle(color: Colors.grey[400], fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              '${widget.ratePerMinute.toStringAsFixed(1)} credits/min',
              style: TextStyle(color: Colors.grey[500], fontSize: 14),
            ),
            const Spacer(flex: 3),
            // Accept / Decline buttons
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                // Decline
                Column(
                  children: [
                    GestureDetector(
                      onTap: _decline,
                      child: Container(
                        width: 72,
                        height: 72,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.redAccent,
                        ),
                        child: const Icon(
                          Icons.call_end,
                          color: Colors.white,
                          size: 36,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Decline',
                      style: TextStyle(color: Colors.grey, fontSize: 14),
                    ),
                  ],
                ),
                // Accept
                Column(
                  children: [
                    GestureDetector(
                      onTap: _accept,
                      child: Container(
                        width: 72,
                        height: 72,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.green,
                        ),
                        child: const Icon(
                          Icons.call,
                          color: Colors.white,
                          size: 36,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Accept',
                      style: TextStyle(color: Colors.grey, fontSize: 14),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }
}
