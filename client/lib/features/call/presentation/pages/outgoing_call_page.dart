import 'dart:async';
import 'package:flutter/material.dart';
import 'package:o8m_marketplace/features/call/data/call_socket_service.dart';
import 'package:o8m_marketplace/features/call/presentation/pages/in_call_page.dart';

/// Outgoing call screen — shown to the CALLER after initiating a call.
class OutgoingCallPage extends StatefulWidget {
  final String sessionId;
  final String hostId;
  final String hostName;
  final double ratePerMinute;

  const OutgoingCallPage({
    super.key,
    required this.sessionId,
    required this.hostId,
    required this.hostName,
    required this.ratePerMinute,
  });

  @override
  State<OutgoingCallPage> createState() => _OutgoingCallPageState();
}

class _OutgoingCallPageState extends State<OutgoingCallPage>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  String _status = 'Calling...';
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _setupListeners();
  }

  void _setupListeners() {
    final socket = CallSocketService.instance;

    socket.onCallAccepted((data) {
      if (_disposed || !mounted) return;
      // agoraToken is an object: {token, appId, channel, uid}
      final agoraData = data['agoraToken'] as Map? ?? {};
      final token = agoraData['token']?.toString() ?? '';
      final appId = agoraData['appId']?.toString() ?? '';
      // Navigate to in-call screen
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => InCallPage(
            sessionId: data['sessionId'] ?? widget.sessionId,
            otherUserId: widget.hostId,
            otherUserName: widget.hostName,
            ratePerMinute: widget.ratePerMinute,
            isCaller: true,
            answeredAt: data['answeredAt'] ?? DateTime.now().toIso8601String(),
            agoraToken: token,
            agoraAppId: appId,
          ),
        ),
      );
    });

    socket.onCallDeclined((data) {
      if (_disposed || !mounted) return;
      setState(() => _status = 'Call declined');
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) Navigator.pop(context);
      });
    });

    socket.onCallExpired((data) {
      if (_disposed || !mounted) return;
      setState(() => _status = 'No answer');
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) Navigator.pop(context);
      });
    });

    socket.onCallError((data) {
      if (_disposed || !mounted) return;
      final error = data['error'] ?? 'Call failed';
      final message = data['message'] ?? error;
      setState(() => _status = message);
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) Navigator.pop(context);
      });
    });
  }

  void _cancelCall() {
    CallSocketService.instance.cancelCall(widget.sessionId);
    Navigator.pop(context);
  }

  @override
  void dispose() {
    _disposed = true;
    _pulseController.dispose();
    CallSocketService.instance.offCallAccepted();
    CallSocketService.instance.offCallDeclined();
    CallSocketService.instance.offCallExpired();
    CallSocketService.instance.offCallError();
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
            // Pulsing avatar
            AnimatedBuilder(
              animation: _pulseController,
              builder: (context, child) {
                final scale = 1.0 + (_pulseController.value * 0.08);
                return Transform.scale(
                  scale: scale,
                  child: Container(
                    width: 120,
                    height: 120,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [
                          const Color(0xFF6C63FF).withValues(alpha: 0.8),
                          const Color(0xFF4A42D1).withValues(alpha: 0.6),
                        ],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF6C63FF).withValues(
                            alpha: 0.3 + _pulseController.value * 0.2,
                          ),
                          blurRadius: 30 + _pulseController.value * 20,
                          spreadRadius: 5 + _pulseController.value * 10,
                        ),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        widget.hostName.isNotEmpty
                            ? widget.hostName[0].toUpperCase()
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
              widget.hostName,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 28,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _status,
              style: TextStyle(
                color: _status == 'Calling...'
                    ? Colors.grey[400]
                    : Colors.orangeAccent,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${widget.ratePerMinute.toStringAsFixed(1)} credits/min',
              style: TextStyle(color: Colors.grey[500], fontSize: 14),
            ),
            const Spacer(flex: 3),
            // Cancel button
            GestureDetector(
              onTap: _cancelCall,
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
            const SizedBox(height: 12),
            const Text(
              'Cancel',
              style: TextStyle(color: Colors.grey, fontSize: 14),
            ),
            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }
}
