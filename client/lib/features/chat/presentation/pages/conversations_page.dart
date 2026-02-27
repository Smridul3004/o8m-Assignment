import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:o8m_marketplace/core/constants/api_constants.dart';
import 'package:o8m_marketplace/core/storage/token_storage.dart';
import 'package:o8m_marketplace/features/chat/data/chat_service.dart';
import 'package:o8m_marketplace/features/chat/data/socket_service.dart';
import 'package:o8m_marketplace/features/chat/presentation/pages/chat_page.dart';

class ConversationsPage extends StatefulWidget {
  const ConversationsPage({super.key});

  @override
  State<ConversationsPage> createState() => _ConversationsPageState();
}

class _ConversationsPageState extends State<ConversationsPage> {
  List<dynamic> _conversations = [];
  bool _loading = true;
  String? _currentUserId;
  // userId -> displayName cache
  final Map<String, String> _displayNames = {};

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final user = await TokenStorage.getUser();
    _currentUserId = user['id'];

    // Connect socket
    if (_currentUserId != null) {
      SocketService.instance.connect(_currentUserId!);

      // Listen for new message notifications to refresh the list
      SocketService.instance.onNewMessageNotification((_) {
        _loadConversations();
      });
    }

    await _loadConversations();
  }

  Future<void> _loadConversations() async {
    final convos = await ChatService.getConversations();
    if (!mounted) return;

    // Collect all other-user IDs we don't have cached yet
    final idsToFetch = <String>{};
    for (final c in convos) {
      final convo = c as Map<String, dynamic>;
      final otherId = _currentUserId == convo['callerId']
          ? convo['hostId'] as String
          : convo['callerId'] as String;
      if (!_displayNames.containsKey(otherId)) {
        idsToFetch.add(otherId);
      }
    }

    // Batch-fetch display names in parallel
    if (idsToFetch.isNotEmpty) {
      await Future.wait(idsToFetch.map(_fetchDisplayName));
    }

    if (mounted) {
      setState(() {
        _conversations = convos;
        _loading = false;
      });
    }
  }

  Future<void> _fetchDisplayName(String userId) async {
    try {
      final res = await http.get(
        Uri.parse('${ApiConstants.userBase}/profile/public/$userId'),
      ).timeout(const Duration(seconds: 5));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final name = data['profile']?['displayName'] as String?;
        if (name != null && name.isNotEmpty) {
          _displayNames[userId] = name;
        }
      }
    } catch (_) {
      // Keep old value (or absent — fallback used below)
    }
  }

  String _getOtherUserName(Map<String, dynamic> convo) {
    final otherId = _getOtherUserId(convo);
    if (_displayNames.containsKey(otherId)) {
      return _displayNames[otherId]!;
    }
    // Fallback while loading or if name unavailable
    final isHost = _currentUserId == convo['callerId'];
    return isHost
        ? 'Host ${otherId.substring(0, 8)}...'
        : 'User ${otherId.substring(0, 8)}...';
  }

  String _getOtherUserId(Map<String, dynamic> convo) {
    return _currentUserId == convo['callerId']
        ? convo['hostId'] as String
        : convo['callerId'] as String;
  }

  String _formatTime(String? dateStr) {
    if (dateStr == null) return '';
    try {
      final date = DateTime.parse(dateStr).toLocal();
      final now = DateTime.now();
      final diff = now.difference(date);
      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inHours < 1) return '${diff.inMinutes}m ago';
      if (diff.inDays < 1) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${date.month}/${date.day}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_conversations.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.chat_bubble_outline, size: 64, color: Colors.grey[600]),
            const SizedBox(height: 16),
            Text(
              'No conversations yet',
              style: TextStyle(
                fontSize: 18,
                color: Colors.grey[400],
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Find a host in Discover to start chatting',
              style: TextStyle(fontSize: 14, color: Colors.grey[600]),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadConversations,
      child: ListView.builder(
        itemCount: _conversations.length,
        itemBuilder: (context, index) {
          final convo = _conversations[index] as Map<String, dynamic>;
          final name = _getOtherUserName(convo);
          final preview = convo['lastMessagePreview'] ?? '';
          final time = _formatTime(convo['lastMessageAt'] as String?);

          return Container(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E2E),
              borderRadius: BorderRadius.circular(12),
            ),
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 8,
              ),
              leading: CircleAvatar(
                radius: 24,
                backgroundColor: const Color(0xFF6C63FF),
                child: Text(
                  name[0].toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
              ),
              title: Text(
                name,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                ),
              ),
              subtitle: Text(
                preview.isNotEmpty ? preview : 'Start a conversation',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.grey[400], fontSize: 14),
              ),
              trailing: Text(
                time,
                style: TextStyle(color: Colors.grey[500], fontSize: 12),
              ),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatPage(
                      conversationId: convo['_id'],
                      otherUserId: _getOtherUserId(convo),
                      otherUserName: name,
                      isCaller: _currentUserId == convo['callerId'],
                    ),
                  ),
                ).then((_) => _loadConversations());
              },
            ),
          );
        },
      ),
    );
  }
}
