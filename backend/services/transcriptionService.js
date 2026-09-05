'use strict';

const path = require('path');
const OpenAI = require('openai');

const EXTENSIONS_BY_MIME_TYPE = {
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'audio/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/m4a': '.m4a',
    'audio/x-m4a': '.m4a',
};

function getTranscriptionConfig() {
    return {
        apiKey:
            process.env.TRANSCRIPTION_API_KEY ||
            process.env.LLM_API_KEY ||
            process.env.OPENAI_API_KEY,
        baseURL:
            process.env.TRANSCRIPTION_BASE_URL ||
            process.env.LLM_BASE_URL ||
            process.env.OPENAI_BASE_URL,
        model: process.env.TRANSCRIPTION_MODEL || 'whisper-1',
    };
}

function getTranscriptionClient() {
    const { apiKey, baseURL } = getTranscriptionConfig();
    if (!apiKey) {
        const error = new Error(
            'Voice transcription is not configured. Set TRANSCRIPTION_API_KEY, LLM_API_KEY, or OPENAI_API_KEY.'
        );
        error.code = 'TRANSCRIPTION_NOT_CONFIGURED';
        throw error;
    }

    const options = { apiKey };
    if (baseURL) {
        options.baseURL = baseURL;
    }

    return new OpenAI(options);
}

function resolveUploadName(filename, mimeType) {
    const safeName = path.basename(filename || 'voice-message');
    if (path.extname(safeName)) {
        return safeName;
    }
    return `${safeName}${EXTENSIONS_BY_MIME_TYPE[mimeType] || '.audio'}`;
}

async function transcribeAudio(
    audioBuffer,
    { mimeType = 'audio/ogg', filename = 'voice-message' } = {}
) {
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        throw new Error('The voice message contained no audio data.');
    }

    const { model } = getTranscriptionConfig();
    const client = getTranscriptionClient();
    const file = new File(
        [audioBuffer],
        resolveUploadName(filename, mimeType),
        {
            type: mimeType,
        }
    );

    const result = await client.audio.transcriptions.create({ file, model });
    const transcript = result?.text?.trim();

    if (!transcript) {
        throw new Error(
            'The transcription server returned an empty transcript.'
        );
    }

    return transcript;
}

module.exports = {
    EXTENSIONS_BY_MIME_TYPE,
    getTranscriptionConfig,
    transcribeAudio,
};
