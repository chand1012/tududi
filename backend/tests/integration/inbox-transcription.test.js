const transcriptionService = require('../../services/transcriptionService');

jest.mock('../../services/transcriptionService', () => ({
    transcribeAudio: jest.fn(),
}));

const request = require('supertest');
const app = require('../../app');
const { InboxItem } = require('../../models');
const { getConfig } = require('../../config/config');
const { createTestUser } = require('../helpers/testUtils');

describe('Inbox voice transcription route', () => {
    let agent;

    beforeEach(async () => {
        await createTestUser({ email: 'voice@example.com' });
        agent = request.agent(app);
        await agent.post('/api/login').send({
            email: 'voice@example.com',
            password: 'password123',
        });
        transcriptionService.transcribeAudio.mockResolvedValue(
            'Remember the dentist appointment'
        );
    });

    it('transcribes an in-memory browser recording without creating an item', async () => {
        const response = await agent
            .post('/api/inbox/transcribe')
            .attach('audio', Buffer.from('browser-audio'), {
                filename: 'inbox-voice.webm',
                contentType: 'audio/webm',
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            transcript: 'Remember the dentist appointment',
        });
        expect(transcriptionService.transcribeAudio).toHaveBeenCalledWith(
            Buffer.from('browser-audio'),
            {
                mimeType: 'audio/webm',
                filename: 'inbox-voice.webm',
            }
        );
        expect(await InboxItem.count()).toBe(0);
    });

    it('requires authentication', async () => {
        const response = await request(app)
            .post('/api/inbox/transcribe')
            .attach('audio', Buffer.from('browser-audio'), {
                filename: 'inbox-voice.webm',
                contentType: 'audio/webm',
            });

        expect(response.status).toBe(401);
        expect(transcriptionService.transcribeAudio).not.toHaveBeenCalled();
    });

    it('requires an audio file', async () => {
        const response = await agent.post('/api/inbox/transcribe');

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('A voice recording is required.');
    });

    it('rejects unsupported uploads', async () => {
        const response = await agent
            .post('/api/inbox/transcribe')
            .attach('audio', Buffer.from('not-audio'), {
                filename: 'notes.txt',
                contentType: 'text/plain',
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Unsupported audio format.');
        expect(transcriptionService.transcribeAudio).not.toHaveBeenCalled();
    });

    it('enforces the configured upload size limit', async () => {
        const tooLarge = Buffer.alloc(
            getConfig().fileUploadLimitMB * 1024 * 1024 + 1
        );

        const response = await agent
            .post('/api/inbox/transcribe')
            .attach('audio', tooLarge, {
                filename: 'inbox-voice.webm',
                contentType: 'audio/webm',
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Voice recording is too large.');
        expect(transcriptionService.transcribeAudio).not.toHaveBeenCalled();
    });

    it('returns a stable error when the provider fails', async () => {
        transcriptionService.transcribeAudio.mockRejectedValue(
            new Error('private provider details')
        );

        const response = await agent
            .post('/api/inbox/transcribe')
            .attach('audio', Buffer.from('browser-audio'), {
                filename: 'inbox-voice.mp4',
                contentType: 'audio/mp4',
            });

        expect(response.status).toBe(502);
        expect(response.body).toEqual({
            error: 'We could not transcribe that recording. Please try again.',
            code: 'TRANSCRIPTION_FAILED',
        });
        expect(response.text).not.toContain('private provider details');
    });

    it('reports missing transcription configuration without exposing details', async () => {
        const error = new Error('missing key details');
        error.code = 'TRANSCRIPTION_NOT_CONFIGURED';
        transcriptionService.transcribeAudio.mockRejectedValue(error);

        const response = await agent
            .post('/api/inbox/transcribe')
            .attach('audio', Buffer.from('browser-audio'), {
                filename: 'inbox-voice.ogg',
                contentType: 'audio/ogg',
            });

        expect(response.status).toBe(503);
        expect(response.body.code).toBe('TRANSCRIPTION_NOT_CONFIGURED');
        expect(response.text).not.toContain('missing key details');
    });
});
