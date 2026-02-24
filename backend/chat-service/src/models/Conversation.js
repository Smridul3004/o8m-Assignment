const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    callerId: {
        type: String,
        required: true,
        index: true,
    },
    hostId: {
        type: String,
        required: true,
        index: true,
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
    },
    lastMessagePreview: {
        type: String,
        default: '',
    },
}, {
    timestamps: true,
});

// Unique pair: one conversation per caller-host pair
conversationSchema.index({ callerId: 1, hostId: 1 }, { unique: true });

module.exports = mongoose.model('Conversation', conversationSchema);
