'use strict';

const express = require('express');
const multer = require('multer');
const { getConfig } = require('../../config/config');
const { ValidationError } = require('../../shared/errors');
const router = express.Router();
const inboxController = require('./controller');
const config = getConfig();

const allowedAudioTypes = new Set([
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/m4a',
    'audio/x-m4a',
]);

const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.fileUploadLimitMB * 1024 * 1024,
        files: 1,
    },
    fileFilter: (req, file, callback) => {
        if (allowedAudioTypes.has(file.mimetype)) {
            callback(null, true);
            return;
        }
        callback(new ValidationError('Unsupported audio format.'));
    },
});

function uploadVoiceRecording(req, res, next) {
    audioUpload.single('audio')(req, res, (error) => {
        if (error?.code === 'LIMIT_FILE_SIZE') {
            next(new ValidationError('Voice recording is too large.'));
            return;
        }
        if (error instanceof multer.MulterError) {
            next(
                new ValidationError('Only one voice recording can be uploaded.')
            );
            return;
        }
        next(error);
    });
}

// All routes require authentication (handled by app.js middleware)

router.get('/inbox', inboxController.list);
router.post('/inbox', inboxController.create);
router.post(
    '/inbox/transcribe',
    uploadVoiceRecording,
    inboxController.transcribe
);
router.post('/inbox/analyze-text', inboxController.analyzeText);
router.patch('/inbox/restore-all', inboxController.restoreAll);
router.get('/inbox/:uid', inboxController.getOne);
router.patch('/inbox/:uid', inboxController.update);
router.delete('/inbox/:uid', inboxController.delete);
router.patch('/inbox/:uid/process', inboxController.process);
router.patch('/inbox/:uid/trash', inboxController.trash);
router.patch('/inbox/:uid/restore', inboxController.restore);

module.exports = router;
