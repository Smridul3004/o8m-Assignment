import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import 'package:o8m_marketplace/features/chat/data/chat_service.dart';
import 'package:o8m_marketplace/features/chat/data/socket_service.dart';
import 'package:o8m_marketplace/core/storage/token_storage.dart';

class ChatPage extends StatefulWidget {
  final String conversationId;
  final String otherUserId;
  final String otherUserName;
  final bool isCaller;

  const ChatPage({
    super.key,
    required this.conversationId,
    required this.otherUserId,
    required this.otherUserName,
    required this.isCaller,
  });

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final Uuid _uuid = const Uuid();

  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  String? _currentUserId;
  String? _errorMessage;
  bool _otherTyping = false;
  final Set<String> _pendingKeys = {};

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final user = await TokenStorage.getUser();
    _currentUserId = user['id'];

    // Join conversation room
    SocketService.instance.joinConversation(widget.conversationId);

    // Listen for socket events
    _setupSocketListeners();

    // Load existing messages
    await _loadMessages();
  }

  void _setupSocketListeners() {
    final socket = SocketService.instance;

    socket.onNewMessage((data) {
      if (!mounted) return;
      final msg = data['message'] as Map<String, dynamic>;
      // Skip own messages — they are handled by onMessageSent
      if (msg['senderId'] == _currentUserId) return;
      if (msg['conversationId'] == widget.conversationId) {
        setState(() {
          // Avoid duplicates
          if (!_messages.any((m) => m['_id'] == msg['_id'])) {
            _messages.add(msg);
          }
        });
        _scrollToBottom();

        // Mark as delivered
        socket.markDelivered(msg['_id']);
      }
    });

    socket.onMessageSent((data) {
      if (!mounted) return;
      final msg = data['message'] as Map<String, dynamic>;
      final key = msg['idempotencyKey'] as String?;
      setState(() {
        _pendingKeys.remove(key);
        // Replace pending message or add
        final idx = _messages.indexWhere((m) => m['idempotencyKey'] == key);
        if (idx >= 0) {
          _messages[idx] = msg;
        } else {
          _messages.add(msg);
        }
      });
      _scrollToBottom();
    });

    socket.onMessageError((data) {
      if (!mounted) return;
      final key = data['idempotencyKey'] as String?;
      setState(() {
        _pendingKeys.remove(key);
        _messages.removeWhere((m) => m['idempotencyKey'] == key);
        _errorMessage = data['error'] ?? 'Failed to send message';
      });
      // Auto-dismiss error after 4 seconds
      Future.delayed(const Duration(seconds: 4), () {
        if (mounted) setState(() => _errorMessage = null);
      });
    });

    socket.onMessageStatusUpdate((data) {
      if (!mounted) return;
      final msgId = data['messageId'];
      final status = data['status'];
      setState(() {
        final idx = _messages.indexWhere((m) => m['_id'] == msgId);
        if (idx >= 0) {
          _messages[idx]['status'] = status;
        }
      });
    });

    socket.onUserTyping((data) {
      if (!mounted) return;
      if (data['conversationId'] == widget.conversationId &&
          data['userId'] != _currentUserId) {
        setState(() => _otherTyping = true);
        Future.delayed(const Duration(seconds: 3), () {
          if (mounted) setState(() => _otherTyping = false);
        });
      }
    });

    socket.onUserStopTyping((data) {
      if (!mounted) return;
      if (data['conversationId'] == widget.conversationId) {
        setState(() => _otherTyping = false);
      }
    });
  }

  Future<void> _loadMessages() async {
    final data = await ChatService.getMessages(widget.conversationId);
    if (mounted) {
      setState(() {
        _messages = List<Map<String, dynamic>>.from(data['messages'] ?? []);
        _loading = false;
      });
      _scrollToBottom();

      // Mark incoming messages as read
      for (final msg in _messages) {
        if (msg['senderId'] != _currentUserId && msg['status'] != 'READ') {
          SocketService.instance.markRead(msg['_id']);
        }
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _sendMessage() {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    final idempotencyKey = _uuid.v4();

    // Optimistic add
    setState(() {
      _messages.add({
        '_id': 'pending_$idempotencyKey',
        'conversationId': widget.conversationId,
        'senderId': _currentUserId,
        'content': text,
        'idempotencyKey': idempotencyKey,
        'status': 'SENDING',
        'serverTimestamp': DateTime.now().toIso8601String(),
      });
      _pendingKeys.add(idempotencyKey);
      _errorMessage = null;
    });
    _messageController.clear();
    _scrollToBottom();

    // Send through socket
    SocketService.instance.sendMessage(
      conversationId: widget.conversationId,
      content: text,
      idempotencyKey: idempotencyKey,
    );
  }

  Widget _buildStatusIcon(String? status) {
    switch (status) {
      case 'SENDING':
        return const SizedBox(
          width: 12,
          height: 12,
          child: CircularProgressIndicator(
            strokeWidth: 1.5,
            color: Colors.grey,
          ),
        );
      case 'SENT':
        return const Icon(Icons.check, size: 14, color: Colors.grey);
      case 'DELIVERED':
        return const Icon(Icons.done_all, size: 14, color: Colors.grey);
      case 'READ':
        return const Icon(Icons.done_all, size: 14, color: Color(0xFF6C63FF));
      default:
        return const SizedBox.shrink();
    }
  }

  String _formatTime(String? dateStr) {
    if (dateStr == null) return '';
    try {
      final date = DateTime.parse(dateStr).toLocal();
      final h = date.hour.toString().padLeft(2, '0');
      final m = date.minute.toString().padLeft(2, '0');
      return '$h:$m';
    } catch (_) {
      return '';
    }
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    // Remove chat-specific listeners
    SocketService.instance.offNewMessage();
    SocketService.instance.offMessageSent();
    SocketService.instance.offMessageError();
    SocketService.instance.offMessageStatusUpdate();
    SocketService.instance.offUserTyping();
    SocketService.instance.offUserStopTyping();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.otherUserName, style: const TextStyle(fontSize: 16)),
            if (_otherTyping)
              const Text(
                'typing...',
                style: TextStyle(
                  fontSize: 12,
                  color: Color(0xFF6C63FF),
                  fontStyle: FontStyle.italic,
                ),
              ),
          ],
        ),
        backgroundColor: const Color(0xFF1A1A2E),
        elevation: 0,
      ),
      body: Column(
        children: [
          // Error banner
          if (_errorMessage != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              color: Colors.red.withValues(alpha: 0.15),
              child: Row(
                children: [
                  const Icon(
                    Icons.error_outline,
                    color: Colors.redAccent,
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _errorMessage!,
                      style: const TextStyle(
                        color: Colors.redAccent,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => setState(() => _errorMessage = null),
                    child: const Icon(
                      Icons.close,
                      color: Colors.redAccent,
                      size: 18,
                    ),
                  ),
                ],
              ),
            ),
          // Messages
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.waving_hand,
                          size: 48,
                          color: Colors.grey[600],
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'Say hello!',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey[400],
                          ),
                        ),
                        if (widget.isCaller)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              'Each message costs 1 credit',
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.grey[600],
                              ),
                            ),
                          ),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final msg = _messages[index];
                      final isMe = msg['senderId'] == _currentUserId;
                      return _MessageBubble(
                        content: msg['content'] ?? '',
                        time: _formatTime(msg['serverTimestamp'] as String?),
                        isMe: isMe,
                        statusWidget: isMe
                            ? _buildStatusIcon(msg['status'] as String?)
                            : null,
                      );
                    },
                  ),
          ),
          // Input
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A2E),
              border: Border(
                top: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
              ),
            ),
            child: SafeArea(
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2A2A3E),
                        borderRadius: BorderRadius.circular(24),
                      ),
                      child: TextField(
                        controller: _messageController,
                        decoration: const InputDecoration(
                          hintText: 'Type a message...',
                          hintStyle: TextStyle(color: Colors.grey),
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.symmetric(vertical: 12),
                        ),
                        style: const TextStyle(color: Colors.white),
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _sendMessage(),
                        onChanged: (val) {
                          if (val.isNotEmpty) {
                            SocketService.instance.sendTyping(
                              widget.conversationId,
                            );
                          } else {
                            SocketService.instance.sendStopTyping(
                              widget.conversationId,
                            );
                          }
                        },
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: _sendMessage,
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: LinearGradient(
                          colors: [Color(0xFF6C63FF), Color(0xFF4A42D1)],
                        ),
                      ),
                      child: const Icon(
                        Icons.send,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final String content;
  final String time;
  final bool isMe;
  final Widget? statusWidget;

  const _MessageBubble({
    required this.content,
    required this.time,
    required this.isMe,
    this.statusWidget,
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isMe ? const Color(0xFF6C63FF) : const Color(0xFF2A2A3E),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isMe ? 16 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 16),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              content,
              style: const TextStyle(color: Colors.white, fontSize: 15),
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  time,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6),
                    fontSize: 11,
                  ),
                ),
                if (statusWidget != null) ...[
                  const SizedBox(width: 4),
                  statusWidget!,
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
