

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from '@google/genai';

// --- Type Definitions ---
type TranscriptEntry = {
  speaker: 'user' | 'model';
  text: string;
};

type Status = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

// --- SVG Icons (defined outside the main component) ---
const BlueBirdLogo: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 200 50" fill="none" xmlns="http://www.w3.org/2000/svg">
        <text x="10" y="35" fontFamily="Arial, sans-serif" fontSize="30" fontWeight="bold" fill="#005A9E">
            BLUE BIRD
        </text>
    </svg>
);

const MicrophoneIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM11 5v6a1 1 0 0 0 2 0V5a1 1 0 0 0-2 0z"></path>
        <path d="M19 10v1a7 7 0 0 1-14 0v-1h2v1a5 5 0 0 0 10 0v-1zM12 19a1 1 0 0 0 1-1v-3h-2v3a1 1 0 0 0 1 1z"></path>
    </svg>
);

const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 6h12v12H6z"></path>
    </svg>
);

const UserIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path>
    </svg>
);

const BotIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM8.5 12.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5S7 14.83 7 14s.67-1.5 1.5-1.5zm7 0c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5S14 14.83 14 14s.67-1.5 1.5-1.5zM12 6c-2.76 0-5 2.24-5 5h10c0-2.76-2.24-5-5-5z"></path>
    </svg>
);


// --- Audio Utility Functions ---
function encode(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function decode(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}

const SYSTEM_INSTRUCTION = `Anda adalah "Blue Bird Safety & Product Consultant," sebuah AI Voice Agent yang sangat profesional, berpengetahuan luas, dan berfokus pada keselamatan untuk Blue Bird Corporation. Misi utama Blue Bird adalah: "Your Children's Safety is our Business."

Tugas Anda adalah:
1. Menyambut pengguna dengan hangat dan menyatakan fokus perusahaan pada keselamatan, keandalan, dan daya tahan.
2. Menjawab semua pertanyaan berdasarkan basis pengetahuan berikut.
3. Secara proaktif mengarahkan pengguna ke Dealer atau proses Quotation jika mereka menunjukkan minat untuk membeli atau memerlukan layanan.

Basis Pengetahuan:
- Fokus Bisnis: Kami adalah pemimpin dalam bus sekolah emisi rendah dan nol emisi. Pilihan Powertrain kami meliputi Listrik (Electric), Propana (Propane), Bensin (Gasoline), dan Diesel. Bus Propana kami memiliki Sertifikasi Tingkat NOx Terendah.
- Lini Produk: Vision, All American, Micro Bird, serta bus untuk Aktivitas (Activity) dan Kebutuhan Khusus (Specialty).
- Fitur Keselamatan: Semua bus kami dibuat untuk lulus Uji Keselamatan yang ketat. Fitur standar termasuk Kamera Mundur (Backup Cameras) dan Kontrol Stabilitas Elektronik (Electronic Stability Control). Kami baru saja memperkenalkan Kantung Udara Pengemudi (Driver Airbags) bekerja sama dengan IMMI dan mempromosikan manfaat Sabuk Pengaman 3 Titik (3-Point Lap-Shoulder Seat Belts).
- Sumber Daya & Langkah Selanjutnya: Jika pengguna bertanya tentang pembelian, servis, atau suku cadang, arahkan mereka ke situs web kami untuk menggunakan fitur "Find a Dealer" atau "Request a Quote". Kami juga memiliki Blog dan Podcast bernama "Bird's Eye View Podcast".
- Latar Belakang & Komunitas: Kami mendukung Warisan dan Komunitas melalui Blue Bird School Bus Foundation.

Selalu pertahankan nada yang profesional, informatif, dan mengutamakan keselamatan dalam semua interaksi.`;


export default function App() {
    const [status, setStatus] = useState<Status>('idle');
    const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
    const [isRecording, setIsRecording] = useState(false);

    const sessionRef = useRef<LiveSession | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const currentInputTranscriptionRef = useRef('');
    const currentOutputTranscriptionRef = useRef('');
    let nextStartTime = 0;
    const audioSources = useRef(new Set<AudioBufferSourceNode>()).current;
    
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcripts]);

    const stopSession = useCallback(() => {
        if (sessionRef.current) {
            sessionRef.current.close();
            sessionRef.current = null;
        }

        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.disconnect();
            mediaStreamSourceRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            inputAudioContextRef.current.close();
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close();
        }

        setIsRecording(false);
        setStatus('idle');
    }, []);

    const startSession = async () => {
        setIsRecording(true);
        setStatus('connecting');
        setTranscripts([]);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                    },
                    systemInstruction: SYSTEM_INSTRUCTION,
                },
                callbacks: {
                    onopen: async () => {
                        setStatus('connected');
                        // FIX: Cast window to any to support webkitAudioContext for older browsers.
                        inputAudioContextRef.current = new ((window as any).AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        outputAudioContextRef.current = new ((window as any).AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                        
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        mediaStreamRef.current = stream;

                        const source = inputAudioContextRef.current.createMediaStreamSource(stream);
                        mediaStreamSourceRef.current = source;
                        
                        const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = scriptProcessor;

                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromise.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.outputTranscription) {
                            currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
                        }
                        if (message.serverContent?.inputTranscription) {
                            currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
                        }
                        if (message.serverContent?.turnComplete) {
                            const userInput = currentInputTranscriptionRef.current.trim();
                            const modelOutput = currentOutputTranscriptionRef.current.trim();
                            
                            if (userInput) {
                                setTranscripts(prev => [...prev, { speaker: 'user', text: userInput }]);
                            }
                            if (modelOutput) {
                                setTranscripts(prev => [...prev, { speaker: 'model', text: modelOutput }]);
                            }

                            currentInputTranscriptionRef.current = '';
                            currentOutputTranscriptionRef.current = '';
                        }

                        const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64EncodedAudioString && outputAudioContextRef.current) {
                            nextStartTime = Math.max(nextStartTime, outputAudioContextRef.current.currentTime);
                            const audioBuffer = await decodeAudioData(
                                decode(base64EncodedAudioString),
                                outputAudioContextRef.current,
                                24000,
                                1,
                            );
                            const source = outputAudioContextRef.current.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputAudioContextRef.current.destination);
                            source.addEventListener('ended', () => {
                                audioSources.delete(source);
                            });
                            source.start(nextStartTime);
                            nextStartTime = nextStartTime + audioBuffer.duration;
                            audioSources.add(source);
                        }
                        
                        if(message.serverContent?.interrupted){
                             for (const source of audioSources.values()) {
                                source.stop();
                                audioSources.delete(source);
                            }
                            nextStartTime = 0;
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        setStatus('error');
                        stopSession();
                    },
                    onclose: () => {
                        console.log('Session closed');
                        setStatus('disconnected');
                        stopSession();
                    },
                },
            });
            sessionRef.current = await sessionPromise;
        } catch (error) {
            console.error('Failed to start session:', error);
            setStatus('error');
            setIsRecording(false);
        }
    };
    
    useEffect(() => {
        return () => {
            stopSession();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleToggleRecording = () => {
        if (isRecording) {
            stopSession();
        } else {
            startSession();
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50 font-sans text-gray-800">
            <header className="flex items-center justify-between p-4 bg-white border-b border-gray-200 shadow-sm">
                <div className="flex items-center space-x-3">
                    <BlueBirdLogo className="h-8 w-auto text-[#005A9E]" />
                    <h1 className="text-xl font-bold text-gray-700 hidden sm:block">Safety & Product Consultant</h1>
                </div>
                 <div className="flex items-center space-x-2">
                    <a href="#" className="px-3 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">Request a Quote</a>
                    <a href="#" className="px-3 py-2 text-sm font-semibold text-blue-600 bg-white border border-blue-600 rounded-md hover:bg-blue-50 transition-colors">Find a Dealer</a>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    {transcripts.length === 0 && !isRecording && (
                         <div className="text-center py-16 px-4">
                             <div className="inline-block p-4 bg-blue-100 rounded-full">
                                 <MicrophoneIcon className="w-10 h-10 text-blue-600"/>
                             </div>
                             <h2 className="mt-4 text-2xl font-semibold text-gray-800">Welcome to Blue Bird</h2>
                             <p className="mt-2 text-gray-600">Your Children's Safety is our Business. Press the microphone to start.</p>
                             <p className="mt-1 text-sm text-gray-500">I can answer questions about our products, powertrains, and safety features.</p>
                         </div>
                    )}
                    {transcripts.map((entry, index) => (
                        <div key={index} className={`flex items-start gap-4 ${entry.speaker === 'user' ? 'justify-end' : ''}`}>
                            {entry.speaker === 'model' && (
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                                    <BotIcon className="w-6 h-6 text-white"/>
                                </div>
                            )}
                            <div className={`max-w-lg p-4 rounded-xl shadow-sm ${entry.speaker === 'user' ? 'bg-gray-200 text-gray-800 rounded-br-none' : 'bg-white text-gray-700 border border-gray-200 rounded-bl-none'}`}>
                                <p className="text-sm leading-relaxed">{entry.text}</p>
                            </div>
                            {entry.speaker === 'user' && (
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center">
                                    <UserIcon className="w-6 h-6 text-gray-600"/>
                                </div>
                            )}
                        </div>
                    ))}
                     <div ref={transcriptEndRef} />
                </div>
            </main>

            <footer className="bg-white border-t border-gray-200 p-4">
                <div className="max-w-4xl mx-auto flex flex-col items-center">
                    <button
                        onClick={handleToggleRecording}
                        className={`relative flex items-center justify-center w-16 h-16 rounded-full transition-all duration-200 ease-in-out shadow-lg focus:outline-none focus:ring-4 focus:ring-opacity-50 ${
                            isRecording ? 'bg-red-500 hover:bg-red-600 focus:ring-red-300' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-300'
                        }`}
                        aria-label={isRecording ? 'Stop conversation' : 'Start conversation'}
                    >
                         {isRecording && status === 'connected' && <span className="absolute h-full w-full rounded-full bg-red-500 animate-ping opacity-75"></span>}
                        {isRecording ? <StopIcon className="w-8 h-8 text-white"/> : <MicrophoneIcon className="w-8 h-8 text-white"/>}
                    </button>
                    <p className="mt-3 text-sm text-gray-500 capitalize">{status}</p>
                </div>
            </footer>
        </div>
    );
}