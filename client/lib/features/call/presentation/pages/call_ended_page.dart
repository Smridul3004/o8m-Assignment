import 'package:flutter/material.dart';

/// Post-call summary screen — shown after a call ends.
class CallEndedPage extends StatelessWidget {
  final String otherUserName;
  final int durationSeconds;
  final double totalCost;
  final double ratePerMinute;
  final String reason;
  final bool isCaller;

  const CallEndedPage({
    super.key,
    required this.otherUserName,
    required this.durationSeconds,
    required this.totalCost,
    required this.ratePerMinute,
    required this.reason,
    required this.isCaller,
  });

  String _formatDuration(int seconds) {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  String _reasonText() {
    switch (reason) {
      case 'CALLER_ENDED':
        return isCaller ? 'You ended the call' : 'Caller ended the call';
      case 'HOST_ENDED':
        return isCaller ? 'Host ended the call' : 'You ended the call';
      case 'BALANCE_DEPLETED':
        return 'Call ended — balance depleted';
      case 'TIMEOUT':
        return 'Call expired — no answer';
      case 'DECLINED':
        return 'Call was declined';
      default:
        return 'Call ended';
    }
  }

  @override
  Widget build(BuildContext context) {
    final hostEarnings = totalCost * 0.7; // 30% platform cut

    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(flex: 2),
              // Status icon
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: 0.06),
                ),
                child: const Icon(
                  Icons.call_end_rounded,
                  color: Colors.redAccent,
                  size: 40,
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Call Ended',
                style: TextStyle(
                  color: Colors.grey[300],
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _reasonText(),
                style: TextStyle(color: Colors.grey[500], fontSize: 14),
              ),
              const SizedBox(height: 32),
              // Summary card
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.08),
                  ),
                ),
                child: Column(
                  children: [
                    _SummaryRow(label: 'With', value: otherUserName),
                    const Divider(color: Colors.white10, height: 24),
                    _SummaryRow(
                      label: 'Duration',
                      value: _formatDuration(durationSeconds),
                    ),
                    const Divider(color: Colors.white10, height: 24),
                    _SummaryRow(
                      label: 'Rate',
                      value: '${ratePerMinute.toStringAsFixed(1)} credits/min',
                    ),
                    const Divider(color: Colors.white10, height: 24),
                    _SummaryRow(
                      label: isCaller ? 'Total Cost' : 'Total Earned',
                      value: isCaller
                          ? '${totalCost.toStringAsFixed(1)} credits'
                          : '${hostEarnings.toStringAsFixed(1)} credits',
                      valueColor: isCaller
                          ? Colors.redAccent
                          : Colors.greenAccent,
                    ),
                  ],
                ),
              ),
              const Spacer(flex: 3),
              // Done button
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6C63FF),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text(
                    'Done',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _SummaryRow({
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: Colors.grey[500], fontSize: 14)),
        Text(
          value,
          style: TextStyle(
            color: valueColor ?? Colors.white,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
