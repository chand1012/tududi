const mockCreate = jest.fn();

jest.mock('openai', () => jest.fn());

const OpenAI = require('openai');
const transcriptionService = require('../../../services/transcriptionService');

describe('Transcription service', () => {
    const envKeys = [
        'TRANSCRIPTION_API_KEY',
        'TRANSCRIPTION_BASE_URL',
        'TRANSCRIPTION_MODEL',
        'LLM_API_KEY',
        'LLM_BASE_URL',
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
    ];
    const savedEnv = {};

    beforeEach(() => {
        envKeys.forEach((key) => {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        });
        mockCreate.mockResolvedValue({ text: '  Buy groceries  ' });
        OpenAI.mockImplementation(() => ({
            audio: { transcriptions: { create: mockCreate } },
        }));
    });

    afterEach(() => {
        envKeys.forEach((key) => {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        });
    });

    it('prefers dedicated settings and defaults the model to whisper-1', () => {
        process.env.TRANSCRIPTION_API_KEY = 'transcription-key';
        process.env.TRANSCRIPTION_BASE_URL = 'http://transcription.test/v1';

        expect(transcriptionService.getTranscriptionConfig()).toEqual({
            apiKey: 'transcription-key',
            baseURL: 'http://transcription.test/v1',
            model: 'whisper-1',
        });
    });

    it('falls back independently to the LLM and OpenAI settings', () => {
        process.env.LLM_API_KEY = 'llm-key';
        process.env.OPENAI_BASE_URL = 'http://openai-compatible.test/v1';
        process.env.TRANSCRIPTION_MODEL = 'custom-whisper';

        expect(transcriptionService.getTranscriptionConfig()).toEqual({
            apiKey: 'llm-key',
            baseURL: 'http://openai-compatible.test/v1',
            model: 'custom-whisper',
        });
    });

    it('uploads an extension-bearing audio file and returns a trimmed transcript', async () => {
        process.env.TRANSCRIPTION_API_KEY = 'placeholder';
        process.env.TRANSCRIPTION_BASE_URL = 'http://transcription.test/v1';

        const transcript = await transcriptionService.transcribeAudio(
            Buffer.from('voice-data'),
            { mimeType: 'audio/webm', filename: 'inbox-recording' }
        );

        expect(OpenAI).toHaveBeenCalledWith({
            apiKey: 'placeholder',
            baseURL: 'http://transcription.test/v1',
        });
        expect(mockCreate).toHaveBeenCalledWith({
            file: expect.any(File),
            model: 'whisper-1',
        });
        const { file } = mockCreate.mock.calls[0][0];
        expect(file.name).toBe('inbox-recording.webm');
        expect(file.type).toBe('audio/webm');
        expect(transcript).toBe('Buy groceries');
    });

    it('rejects an empty transcription response', async () => {
        process.env.TRANSCRIPTION_API_KEY = 'placeholder';
        mockCreate.mockResolvedValue({ text: '   ' });

        await expect(
            transcriptionService.transcribeAudio(Buffer.from('voice-data'))
        ).rejects.toThrow('empty transcript');
    });

    it('requires a configured API key', async () => {
        await expect(
            transcriptionService.transcribeAudio(Buffer.from('voice-data'))
        ).rejects.toThrow('Voice transcription is not configured');
    });

    it('preserves a supplied extension for Telegram OGG uploads', async () => {
        process.env.TRANSCRIPTION_API_KEY = 'placeholder';

        await transcriptionService.transcribeAudio(Buffer.from('voice-data'), {
            mimeType: 'audio/ogg',
            filename: 'telegram-voice.ogg',
        });

        const { file } = mockCreate.mock.calls[0][0];
        expect(file.name).toBe('telegram-voice.ogg');
        expect(file.type).toBe('audio/ogg');
    });
});
