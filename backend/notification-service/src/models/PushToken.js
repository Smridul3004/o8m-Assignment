const mongoose = require('mongoose');

const pushTokenSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true },
    platform: { type: String, enum: ['WEB', 'ANDROID', 'IOS'], default: 'WEB' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

// Compound unique index — one token per user per platform
pushTokenSchema.index({ userId: 1, platform: 1 }, { unique: true });

module.exports = mongoose.model('PushToken', pushTokenSchema);
