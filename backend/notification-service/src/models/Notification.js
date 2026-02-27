const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipientId: { type: String, required: true, index: true },
    type: {
        type: String,
        enum: ['INCOMING_CALL', 'MISSED_CALL', 'NEW_MESSAGE', 'CALL_ENDED', 'LOW_BALANCE', 'SYSTEM'],
        required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
    delivered: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ recipientId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
