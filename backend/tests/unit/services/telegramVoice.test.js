const https = require('https');
const { User, InboxItem } = require('../../../models');
const transcriptionService = require('../../../services/transcriptionService');

jest.mock('../../../models', () => ({
    User: {
        update: jest.fn(),
        findOne: jest.fn(),
    },
    InboxItem: {
        create: jest.fn(),
        findOne: jest.fn(),
    },
}));
jest.mock('../../../services/transcriptionService', () => ({
    transcribeAudio: jest.fn(),
}));
jest.mock('https', () => ({
    get: jest.fn(),
    request: jest.fn(),
}));

const telegramPoller = require('../../../modules/telegram/telegramPoller');

function mockResponse(chunks, statusCode = 200) {
    const response = {
        statusCode,
        on: jest.fn((event, handler) => {
            if (event === 'data') {
                chunks.forEach((chunk) => handler(chunk));
            }
            if (event === 'end') {
                handler();
            }
            return response;
        }),
    };
    return response;
}

function mockRequest() {
    const request = {
        on: jest.fn(() => request),
        write: jest.fn(),
        end: jest.fn(),
    };
    return request;
}

function arrangeTelegramRequests() {
    https.get.mockImplementation((url, options, callback) => {
        if (url.includes('/getFile?')) {
            callback(
                mockResponse([
                    JSON.stringify({
                        ok: true,
                        result: { file_path: 'voice/file_123.oga' },
                    }),
                ])
            );
        } else {
            callback(mockResponse([Buffer.from('telegram-audio')]));
        }
        return mockRequest();
    });

    https.request.mockImplementation((url, options, callback) => {
        callback(mockResponse([JSON.stringify({ ok: true })]));
        return mockRequest();
    });
}

function voiceUpdate(overrides = {}) {
    return {
        update_id: 9001,
        message: {
            message_id: 501,
            from: { id: 100, username: 'voice_user' },
            chat: { id: 123456789 },
            voice: {
                file_id: 'telegram-file-id',
                mime_type: 'audio/ogg',
            },
            ...overrides,
        },
    };
}

describe('Telegram voice messages', () => {
    let user;

    beforeEach(() => {
        user = {
            id: 1,
            telegram_bot_token: 'test-token',
            telegram_chat_id: '123456789',
        };
        InboxItem.findOne.mockResolvedValue(null);
        InboxItem.create.mockResolvedValue({ id: 1 });
        User.findOne.mockResolvedValue(null);
        User.update.mockResolvedValue([1]);
        transcriptionService.transcribeAudio.mockResolvedValue(
            'Schedule dentist appointment'
        );
        arrangeTelegramRequests();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        telegramPoller.stopPolling();
    });

    it('downloads, transcribes, and stores a voice message', async () => {
        await telegramPoller._processMessage(user, voiceUpdate());

        expect(https.get).toHaveBeenNthCalledWith(
            1,
            'https://api.telegram.org/bottest-token/getFile?file_id=telegram-file-id',
            { timeout: 5000 },
            expect.any(Function)
        );
        expect(https.get).toHaveBeenNthCalledWith(
            2,
            'https://api.telegram.org/file/bottest-token/voice/file_123.oga',
            { timeout: 30000 },
            expect.any(Function)
        );
        expect(transcriptionService.transcribeAudio).toHaveBeenCalledWith(
            Buffer.from('telegram-audio'),
            {
                mimeType: 'audio/ogg',
                filename: 'telegram-voice.ogg',
            }
        );
        expect(InboxItem.create).toHaveBeenCalledWith({
            content: 'Schedule dentist appointment',
            source: 'telegram',
            user_id: 1,
            metadata: { telegram_message_id: 501 },
        });

        const confirmation = JSON.parse(
            https.request.mock.results[0].value.write.mock.calls[0][0]
        );
        expect(confirmation).toEqual({
            chat_id: '123456789',
            text: '✅ Added to tududi inbox: "Schedule dentist appointment"',
            reply_to_message_id: 501,
        });
    });

    it('supports a voice note as the first message in a chat', async () => {
        user.telegram_chat_id = null;

        await telegramPoller._processMessage(user, voiceUpdate());

        expect(User.update).toHaveBeenCalledWith(
            { telegram_chat_id: '123456789' },
            { where: { id: 1 } }
        );
        expect(transcriptionService.transcribeAudio).toHaveBeenCalledTimes(1);
        expect(InboxItem.create).toHaveBeenCalledTimes(1);
        expect(https.request).toHaveBeenCalledTimes(2);
    });

    it('does not download voice notes from unauthorized users', async () => {
        user.telegram_allowed_users = '@someone_else';

        await telegramPoller._processMessage(user, voiceUpdate());

        expect(https.get).not.toHaveBeenCalled();
        expect(transcriptionService.transcribeAudio).not.toHaveBeenCalled();
        expect(InboxItem.create).not.toHaveBeenCalled();
    });

    it('replies with a stable error and creates no item when transcription fails', async () => {
        transcriptionService.transcribeAudio.mockRejectedValue(
            new Error('provider unavailable')
        );

        await telegramPoller._processMessage(user, voiceUpdate());

        expect(InboxItem.create).not.toHaveBeenCalled();
        const errorReply = JSON.parse(
            https.request.mock.results[0].value.write.mock.calls[0][0]
        );
        expect(errorReply.text).toBe(
            '❌ Failed to transcribe this voice message. Please try again.'
        );
        expect(errorReply.text).not.toContain('provider unavailable');
    });

    it('processes the same voice update only once', async () => {
        const update = voiceUpdate({ message_id: 502 });
        update.update_id = 9002;

        await telegramPoller._processUpdates(user, [update]);
        await telegramPoller._processUpdates(user, [update]);

        expect(transcriptionService.transcribeAudio).toHaveBeenCalledTimes(1);
        expect(InboxItem.create).toHaveBeenCalledTimes(1);
    });

    it('ignores generic audio attachments', async () => {
        const update = voiceUpdate({
            voice: undefined,
            audio: { file_id: 'generic-audio' },
        });
        update.update_id = 9003;

        await telegramPoller._processUpdates(user, [update]);

        expect(https.get).not.toHaveBeenCalled();
        expect(transcriptionService.transcribeAudio).not.toHaveBeenCalled();
        expect(InboxItem.create).not.toHaveBeenCalled();
    });
});
