import React, { useEffect, useRef, useState } from 'react';
import {
    CheckIcon,
    ExclamationCircleIcon,
    MicrophoneIcon,
    PaperAirplaneIcon,
    PencilSquareIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { transcribeInboxAudio } from '../../utils/inboxService';
import Tooltip from '../Shared/Tooltip';

type VoiceState =
    | 'idle'
    | 'requesting'
    | 'recording'
    | 'transcribing'
    | 'success'
    | 'error'
    | 'unsupported';

export type VoiceTranscriptMode = 'draft' | 'submit';

interface VoiceCaptureButtonProps {
    disabled?: boolean;
    onBusyChange?: (busy: boolean) => void;
    onTranscribed: (
        transcript: string,
        mode: VoiceTranscriptMode
    ) => boolean | void | Promise<boolean | void>;
}

const MAX_RECORDING_MS = 5 * 60 * 1000;
export const VOICE_TRANSCRIPT_MODE_STORAGE_KEY =
    'tududi.inbox.voiceTranscriptMode';
const MIME_TYPE_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
];

const getSupportedMimeType = () =>
    typeof MediaRecorder.isTypeSupported === 'function'
        ? MIME_TYPE_CANDIDATES.find((type) =>
              MediaRecorder.isTypeSupported(type)
          )
        : undefined;

const getFileExtension = (mimeType: string) => {
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
};

const getSavedTranscriptMode = (): VoiceTranscriptMode => {
    try {
        return localStorage.getItem(VOICE_TRANSCRIPT_MODE_STORAGE_KEY) ===
            'submit'
            ? 'submit'
            : 'draft';
    } catch {
        return 'draft';
    }
};

const formatElapsed = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const VoiceCaptureButton: React.FC<VoiceCaptureButtonProps> = ({
    disabled = false,
    onBusyChange,
    onTranscribed,
}) => {
    const { t } = useTranslation();
    const supported =
        typeof MediaRecorder !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia;
    const [state, setState] = useState<VoiceState>(
        supported ? 'idle' : 'unsupported'
    );
    const [transcriptMode, setTranscriptMode] = useState<VoiceTranscriptMode>(
        getSavedTranscriptMode
    );
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const cancelledRef = useRef(false);
    const recordingFailedRef = useRef(false);
    const holdActiveRef = useRef(false);
    const mountedRef = useRef(true);
    const elapsedIntervalRef = useRef<ReturnType<typeof setInterval>>();
    const maximumDurationRef = useRef<ReturnType<typeof setTimeout>>();
    const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const isBusy =
        state === 'requesting' ||
        state === 'recording' ||
        state === 'transcribing';

    useEffect(() => {
        onBusyChange?.(isBusy);
    }, [isBusy, onBusyChange]);

    useEffect(() => {
        try {
            localStorage.setItem(
                VOICE_TRANSCRIPT_MODE_STORAGE_KEY,
                transcriptMode
            );
        } catch {
            // The mode still works for this session when storage is unavailable.
        }
    }, [transcriptMode]);

    const clearTimers = () => {
        if (elapsedIntervalRef.current) {
            clearInterval(elapsedIntervalRef.current);
        }
        if (maximumDurationRef.current) {
            clearTimeout(maximumDurationRef.current);
        }
        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current);
        }
    };

    const releaseMicrophone = () => {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
    };

    useEffect(() => {
        return () => {
            mountedRef.current = false;
            cancelledRef.current = true;
            holdActiveRef.current = false;
            clearTimers();
            const recorder = mediaRecorderRef.current;
            if (recorder && recorder.state !== 'inactive') {
                recorder.stop();
            }
            releaseMicrophone();
        };
    }, []);

    const finishRecording = async (recorder: MediaRecorder) => {
        clearTimers();
        releaseMicrophone();
        if (mediaRecorderRef.current === recorder) {
            mediaRecorderRef.current = null;
        }

        if (cancelledRef.current || !mountedRef.current) {
            if (mountedRef.current && !recordingFailedRef.current) {
                setState('idle');
            }
            return;
        }

        const recordedMimeType =
            recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
        const uploadMimeType = recordedMimeType.split(';')[0];
        const recording = new Blob(chunksRef.current, {
            type: uploadMimeType,
        });
        chunksRef.current = [];

        if (!recording.size) {
            setErrorMessage(
                t(
                    'inbox.voiceEmpty',
                    'No audio was recorded. Please try again.'
                )
            );
            setState('error');
            return;
        }

        setState('transcribing');
        try {
            const extension = getFileExtension(uploadMimeType);
            const file = new File([recording], `inbox-voice.${extension}`, {
                type: uploadMimeType,
            });
            const transcript = await transcribeInboxAudio(file);
            if (!mountedRef.current) return;
            const accepted = await onTranscribed(transcript, transcriptMode);
            if (!mountedRef.current) return;
            if (accepted === false) {
                setErrorMessage(
                    t(
                        'inbox.voiceSubmitError',
                        'Transcribed, but could not save the inbox item.'
                    )
                );
                setState('error');
                return;
            }
            setState('success');
            successTimeoutRef.current = setTimeout(() => {
                if (mountedRef.current) setState('idle');
            }, 2500);
        } catch (error) {
            if (!mountedRef.current) return;
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : t(
                          'inbox.voiceTranscriptionError',
                          'Could not transcribe that recording.'
                      )
            );
            setState('error');
        }
    };

    const startRecording = async () => {
        if (!supported || disabled || isBusy) return;
        clearTimers();
        setErrorMessage('');
        setState('requesting');
        cancelledRef.current = false;
        recordingFailedRef.current = false;
        chunksRef.current = [];
        setElapsedSeconds(0);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });
            if (!mountedRef.current || cancelledRef.current) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            mediaStreamRef.current = stream;
            const mimeType = getSupportedMimeType();
            const recorder = new MediaRecorder(
                stream,
                mimeType ? { mimeType } : undefined
            );
            mediaRecorderRef.current = recorder;
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunksRef.current.push(event.data);
            };
            recorder.onerror = () => {
                cancelledRef.current = true;
                recordingFailedRef.current = true;
                mediaRecorderRef.current = null;
                clearTimers();
                releaseMicrophone();
                if (mountedRef.current) {
                    setErrorMessage(
                        t(
                            'inbox.voiceRecordingError',
                            'Recording failed. Please try again.'
                        )
                    );
                    setState('error');
                }
            };
            recorder.onstop = () => finishRecording(recorder);
            recorder.start(250);
            setState('recording');
            elapsedIntervalRef.current = setInterval(
                () => setElapsedSeconds((seconds) => seconds + 1),
                1000
            );
            maximumDurationRef.current = setTimeout(() => {
                holdActiveRef.current = false;
                if (recorder.state !== 'inactive') recorder.stop();
            }, MAX_RECORDING_MS);

            if (!holdActiveRef.current && recorder.state !== 'inactive') {
                recorder.stop();
            }
        } catch (error) {
            releaseMicrophone();
            const permissionDenied =
                error instanceof DOMException &&
                (error.name === 'NotAllowedError' ||
                    error.name === 'SecurityError');
            setErrorMessage(
                permissionDenied
                    ? t(
                          'inbox.voicePermissionDenied',
                          'Microphone permission was denied.'
                      )
                    : t(
                          'inbox.voiceRecordingError',
                          'Recording failed. Please try again.'
                      )
            );
            setState('error');
        }
    };

    const stopRecording = () => {
        holdActiveRef.current = false;
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
    };

    const cancelRecording = () => {
        holdActiveRef.current = false;
        cancelledRef.current = true;
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        } else {
            clearTimers();
            releaseMicrophone();
            setState('idle');
        }
    };

    const beginHold = () => {
        holdActiveRef.current = true;
        void startRecording();
    };

    const labels: Partial<Record<VoiceState, string>> = {
        requesting: t('inbox.voiceRequesting', 'Requesting microphone…'),
        recording: t('inbox.voiceRecording', 'Recording—release to transcribe'),
        transcribing: t('inbox.voiceTranscribing', 'Transcribing…'),
        success:
            transcriptMode === 'submit'
                ? t('inbox.voiceSent', 'Transcribed and sent to inbox')
                : t('inbox.voiceReady', 'Transcribed—ready to edit'),
        unsupported: t(
            'inbox.voiceUnsupported',
            'Voice recording is unavailable in this browser.'
        ),
        error: errorMessage,
    };
    const modeLabel =
        transcriptMode === 'submit'
            ? t('inbox.voiceModeSubmit', 'Voice mode: send automatically')
            : t('inbox.voiceModeDraft', 'Voice mode: place in text box');
    const microphoneLabel =
        state === 'recording'
            ? t('inbox.voiceRelease', 'Release to transcribe voice note')
            : labels[state] ||
              t('inbox.voiceHold', 'Press and hold to record voice note');
    const modeTooltip =
        transcriptMode === 'submit'
            ? t(
                  'inbox.voiceModeSubmitTooltip',
                  'Transcripts are sent to your inbox automatically. Click to place them in the text box instead.'
              )
            : t(
                  'inbox.voiceModeDraftTooltip',
                  'Transcripts are placed in the text box for review. Click to send them automatically instead.'
              );
    const microphoneTooltip = t(
        'inbox.voiceHoldTooltip',
        'Press and hold while speaking. Release to transcribe.'
    );

    return (
        <div className="relative flex flex-shrink-0 items-center gap-1 pt-2">
            <Tooltip
                content={modeTooltip}
                position="bottom"
                align="right"
                tooltipClassName="w-56"
            >
                <button
                    type="button"
                    onClick={() =>
                        setTranscriptMode((current) =>
                            current === 'draft' ? 'submit' : 'draft'
                        )
                    }
                    disabled={disabled || isBusy}
                    aria-label={modeLabel}
                    aria-pressed={transcriptMode === 'submit'}
                    className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-300"
                >
                    {transcriptMode === 'submit' ? (
                        <PaperAirplaneIcon className="h-4 w-4" />
                    ) : (
                        <PencilSquareIcon className="h-4 w-4" />
                    )}
                </button>
            </Tooltip>
            <Tooltip
                content={microphoneTooltip}
                position="bottom"
                align="right"
                tooltipClassName="w-56"
            >
                <button
                    type="button"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.currentTarget.setPointerCapture?.(
                            event.pointerId
                        );
                        beginHold();
                    }}
                    onPointerUp={(event) => {
                        event.preventDefault();
                        stopRecording();
                    }}
                    onPointerCancel={cancelRecording}
                    onKeyDown={(event) => {
                        if (
                            !event.repeat &&
                            (event.key === ' ' || event.key === 'Enter')
                        ) {
                            event.preventDefault();
                            beginHold();
                        }
                    }}
                    onKeyUp={(event) => {
                        if (event.key === ' ' || event.key === 'Enter') {
                            event.preventDefault();
                            stopRecording();
                        }
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                    disabled={
                        disabled ||
                        state === 'transcribing' ||
                        state === 'success' ||
                        state === 'unsupported'
                    }
                    aria-label={microphoneLabel}
                    style={{ touchAction: 'none' }}
                    className={`rounded-full p-1.5 transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                        state === 'recording'
                            ? 'scale-110 bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                            : state === 'error'
                              ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
                              : state === 'success'
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-300'
                    }`}
                >
                    {state === 'requesting' || state === 'transcribing' ? (
                        <span className="block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : state === 'success' ? (
                        <CheckIcon className="h-5 w-5" />
                    ) : state === 'error' ? (
                        <ExclamationCircleIcon className="h-5 w-5" />
                    ) : (
                        <MicrophoneIcon className="h-5 w-5" />
                    )}
                </button>
            </Tooltip>
            {state === 'recording' && (
                <>
                    <span className="min-w-9 text-xs font-medium tabular-nums text-red-600 dark:text-red-400">
                        {formatElapsed(elapsedSeconds)}
                    </span>
                    <button
                        type="button"
                        onClick={cancelRecording}
                        className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/10"
                        aria-label={t('inbox.voiceCancel', 'Cancel recording')}
                    >
                        <XMarkIcon className="h-4 w-4" />
                    </button>
                </>
            )}
            {state !== 'idle' && labels[state] && (
                <span
                    className={`absolute right-0 top-11 z-20 max-w-64 rounded-md bg-white px-2 py-1 text-right text-xs shadow-sm dark:bg-gray-800 ${
                        state === 'error'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-500 dark:text-gray-400'
                    }`}
                    role={state === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                >
                    {labels[state]}
                </span>
            )}
        </div>
    );
};

export default VoiceCaptureButton;
