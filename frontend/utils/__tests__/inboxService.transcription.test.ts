import { transcribeInboxAudio } from '../inboxService';
import { getCsrfToken } from '../csrfService';

jest.mock('../csrfService', () => ({
    getCsrfToken: jest.fn(),
}));

describe('transcribeInboxAudio', () => {
    const mockedFetch = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = mockedFetch;
        (getCsrfToken as jest.Mock).mockResolvedValue('csrf-token');
    });

    it('sends multipart audio with CSRF protection and trims the transcript', async () => {
        mockedFetch.mockResolvedValue({
            ok: true,
            headers: { get: jest.fn().mockReturnValue(null) },
            json: jest.fn().mockResolvedValue({ transcript: '  Call Mom  ' }),
        });
        const file = new File(['audio'], 'voice.webm', {
            type: 'audio/webm',
        });

        await expect(transcribeInboxAudio(file)).resolves.toBe('Call Mom');

        const [url, options] = mockedFetch.mock.calls[0];
        expect(url).toBe('/api/inbox/transcribe');
        expect(options.method).toBe('POST');
        expect(options.headers).toEqual({
            Accept: 'application/json',
            'x-csrf-token': 'csrf-token',
        });
        expect(options.headers).not.toHaveProperty('Content-Type');
        expect(options.body).toBeInstanceOf(FormData);
        expect(options.body.get('audio')).toBe(file);
    });

    it('rejects an empty provider response', async () => {
        mockedFetch.mockResolvedValue({
            ok: true,
            headers: { get: jest.fn().mockReturnValue(null) },
            json: jest.fn().mockResolvedValue({ transcript: '   ' }),
        });

        await expect(
            transcribeInboxAudio(
                new File(['audio'], 'voice.webm', { type: 'audio/webm' })
            )
        ).rejects.toThrow('transcription was empty');
    });
});
