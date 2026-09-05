'use strict';

const inboxService = require('./service');
const transcriptionService = require('../../services/transcriptionService');
const {
    AppError,
    UnauthorizedError,
    ValidationError,
} = require('../../shared/errors');
const { getAuthenticatedUserId } = require('../../utils/request-utils');

function requireUserId(req) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
        throw new UnauthorizedError('Authentication required');
    }
    return userId;
}

const inboxController = {
    async list(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { limit, offset } = req.query;
            const result = await inboxService.getAll(userId, { limit, offset });
            res.json(result);
        } catch (error) {
            next(error);
        }
    },

    async getOne(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { uid } = req.params;
            const item = await inboxService.getByUid(userId, uid);
            res.json(item);
        } catch (error) {
            next(error);
        }
    },

    async create(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { content, source } = req.body;
            const item = await inboxService.create(userId, { content, source });
            res.status(201).json(item);
        } catch (error) {
            next(error);
        }
    },

    async transcribe(req, res, next) {
        try {
            requireUserId(req);
            if (!req.file?.buffer?.length) {
                throw new ValidationError('A voice recording is required.');
            }

            const transcript = await transcriptionService.transcribeAudio(
                req.file.buffer,
                {
                    mimeType: req.file.mimetype,
                    filename: req.file.originalname,
                }
            );
            res.json({ transcript });
        } catch (error) {
            if (error instanceof AppError) {
                next(error);
                return;
            }

            if (error?.code === 'TRANSCRIPTION_NOT_CONFIGURED') {
                next(
                    new AppError(
                        'Voice transcription is not configured on this server.',
                        503,
                        'TRANSCRIPTION_NOT_CONFIGURED'
                    )
                );
                return;
            }

            next(
                new AppError(
                    'We could not transcribe that recording. Please try again.',
                    502,
                    'TRANSCRIPTION_FAILED'
                )
            );
        }
    },

    async update(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { uid } = req.params;
            const { content, status } = req.body;
            const item = await inboxService.update(userId, uid, {
                content,
                status,
            });
            res.json(item);
        } catch (error) {
            next(error);
        }
    },

    async delete(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { uid } = req.params;
            const result = await inboxService.delete(userId, uid);
            res.json(result);
        } catch (error) {
            next(error);
        }
    },

    async process(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { uid } = req.params;
            const item = await inboxService.process(userId, uid);
            res.json(item);
        } catch (error) {
            next(error);
        }
    },

    async analyzeText(req, res, next) {
        try {
            const { content } = req.body;
            const result = inboxService.analyzeText(content);
            res.json(result);
        } catch (error) {
            next(error);
        }
    },

    async trash(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { uid } = req.params;
            const item = await inboxService.trash(userId, uid);
            res.json(item);
        } catch (error) {
            next(error);
        }
    },

    async restore(req, res, next) {
        try {
            const userId = requireUserId(req);
            const { uid } = req.params;
            const item = await inboxService.restore(userId, uid);
            res.json(item);
        } catch (error) {
            next(error);
        }
    },

    async restoreAll(req, res, next) {
        try {
            const userId = requireUserId(req);
            const result = await inboxService.restoreAll(userId);
            res.json(result);
        } catch (error) {
            next(error);
        }
    },
};

module.exports = inboxController;
