const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true,
        index: true,
    },
    senderId: {
        type: String,
        required: true,
    },
    content: {
        type: String,
        required: true,
        maxlength: 2000,
    },
    idempotencyKey: {
        type: String,
        required: true,
        unique: true,
    },
    status: {
        type: String,
        enum: ['SENT', 'DELIVERED', 'READ'],
        default: 'SENT',
    },
    serverTimestamp: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
});

messageSchema.index({ conversationId: 1, serverTimestamp: 1 });

module.exports = mongoose.model('Message', messageSchema);
