import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VoiceCaptureButton from '../VoiceCaptureButton';
import { VOICE_TRANSCRIPT_MODE_STORAGE_KEY } from '../VoiceCaptureButton';
import { transcribeInboxAudio } from '../../../utils/inboxService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback || _key,
    }),
}));

jest.mock('../../../utils/inboxService', () => ({
    transcribeInboxAudio: jest.fn(),
}));

const mockedTranscribe = transcribeInboxAudio as jest.Mock;
const stopTrack = jest.fn();

class MockMediaRecorder {
    static isTypeSupported = jest.fn(() => true);
    state: RecordingState = 'inactive';
    mimeType: string;
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;

    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType || 'audio/webm';
    }

    start() {
        this.state = 'recording';
    }

    stop() {
        this.state = 'inactive';
        this.ondataavailable?.({
            data: new Blob(['voice-data'], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
    }
}

describe('VoiceCaptureButton', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        Object.defineProperty(globalThis, 'MediaRecorder', {
            configurable: true,
            value: MockMediaRecorder,
        });
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: jest.fn().mockResolvedValue({
                    getTracks: () => [{ stop: stopTrack }],
                }),
            },
        });
        mockedTranscribe.mockResolvedValue('Call the dentist');
    });

    it('records while held and returns editable text when released', async () => {
        const onTranscribed = jest.fn();
        render(<VoiceCaptureButton onTranscribed={onTranscribed} />);

        fireEvent.pointerDown(
            screen.getByLabelText('Press and hold to record voice note'),
            { button: 0, pointerId: 1 }
        );
        const recordButton = await screen.findByLabelText(
            'Release to transcribe voice note'
        );
        fireEvent.pointerUp(recordButton, { button: 0, pointerId: 1 });

        await waitFor(() => expect(mockedTranscribe).toHaveBeenCalledTimes(1));
        const file = mockedTranscribe.mock.calls[0][0] as File;
        expect(file.name).toBe('inbox-voice.webm');
        expect(file.type).toBe('audio/webm');
        await waitFor(() =>
            expect(onTranscribed).toHaveBeenCalledWith(
                'Call the dentist',
                'draft'
            )
        );
        expect(
            screen.getByText('Transcribed—ready to edit')
        ).toBeInTheDocument();
        expect(stopTrack).toHaveBeenCalled();
    });

    it('explains both voice controls with contextual tooltips', () => {
        render(<VoiceCaptureButton onTranscribed={jest.fn()} />);

        expect(
            screen.getByText(
                'Transcripts are placed in the text box for review. Click to send them automatically instead.'
            )
        ).toHaveClass('top-full');
        expect(
            screen.getByText(
                'Press and hold while speaking. Release to transcribe.'
            )
        ).toHaveClass('top-full');

        fireEvent.click(screen.getByLabelText('Voice mode: place in text box'));
        expect(
            screen.getByText(
                'Transcripts are sent to your inbox automatically. Click to place them in the text box instead.'
            )
        ).toBeInTheDocument();
    });

    it('cancels a recording and releases the microphone without transcribing', async () => {
        render(<VoiceCaptureButton onTranscribed={jest.fn()} />);

        fireEvent.pointerDown(
            screen.getByLabelText('Press and hold to record voice note'),
            { button: 0, pointerId: 1 }
        );
        await screen.findByLabelText('Release to transcribe voice note');
        fireEvent.click(screen.getByLabelText('Cancel recording'));

        await waitFor(() =>
            expect(
                screen.getByLabelText('Press and hold to record voice note')
            ).toBeInTheDocument()
        );
        expect(mockedTranscribe).not.toHaveBeenCalled();
        expect(stopTrack).toHaveBeenCalled();
    });

    it('shows permission failures as an accessible error', async () => {
        (navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValue(
            new DOMException('denied', 'NotAllowedError')
        );
        render(<VoiceCaptureButton onTranscribed={jest.fn()} />);

        fireEvent.pointerDown(
            screen.getByLabelText('Press and hold to record voice note'),
            { button: 0, pointerId: 1 }
        );

        expect(
            await screen.findByText('Microphone permission was denied.')
        ).toHaveAttribute('role', 'alert');
        expect(mockedTranscribe).not.toHaveBeenCalled();
    });

    it('releases an active microphone when unmounted', async () => {
        const { unmount } = render(
            <VoiceCaptureButton onTranscribed={jest.fn()} />
        );

        fireEvent.pointerDown(
            screen.getByLabelText('Press and hold to record voice note'),
            { button: 0, pointerId: 1 }
        );
        await screen.findByLabelText('Release to transcribe voice note');
        unmount();

        expect(stopTrack).toHaveBeenCalled();
        expect(mockedTranscribe).not.toHaveBeenCalled();
    });

    it('persists auto-submit mode and reports it with the transcript', async () => {
        const onTranscribed = jest.fn().mockResolvedValue(true);
        const { unmount } = render(
            <VoiceCaptureButton onTranscribed={onTranscribed} />
        );

        fireEvent.click(screen.getByLabelText('Voice mode: place in text box'));
        expect(localStorage.getItem(VOICE_TRANSCRIPT_MODE_STORAGE_KEY)).toBe(
            'submit'
        );

        fireEvent.pointerDown(
            screen.getByLabelText('Press and hold to record voice note'),
            { button: 0, pointerId: 2 }
        );
        const recordButton = await screen.findByLabelText(
            'Release to transcribe voice note'
        );
        fireEvent.pointerUp(recordButton, { button: 0, pointerId: 2 });

        await waitFor(() =>
            expect(onTranscribed).toHaveBeenCalledWith(
                'Call the dentist',
                'submit'
            )
        );
        expect(
            await screen.findByText('Transcribed and sent to inbox')
        ).toBeInTheDocument();

        unmount();
        render(<VoiceCaptureButton onTranscribed={jest.fn()} />);
        expect(
            screen.getByLabelText('Voice mode: send automatically')
        ).toHaveAttribute('aria-pressed', 'true');
    });
});
