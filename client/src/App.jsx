import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Phone, PhoneOff, Play, Pause, Trash2, ArrowLeft, Mic } from 'lucide-react';
import elliPic from './img/elli.jpg';

const MIME_CANDIDATES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

function pickMimeType() {
  for (const type of MIME_CANDIDATES) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatWhen(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export default function App() {
  const [activeScreen, setActiveScreen] = useState('call'); // 'call' | 'voicemails'
  const [callState, setCallState] = useState('incoming'); // 'incoming' | 'connected' | 'review'
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [callerName, setCallerName] = useState('Elli');
  const [pending, setPending] = useState(null); // { blob, mimeType }
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [levels, setLevels] = useState(Array(28).fill(3));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const audioElRef = useRef(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/messages`);
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      setMessages(data);
    } catch (e) {
      setError('Could not reach the server. Make sure the backend server is running and VITE_API_URL is configured.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const stopLevelLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setLevels(Array(28).fill(3));
  }, []);

  const startLevelLoop = useCallback((stream) => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    audioCtxRef.current = ctx;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const bars = 28;
      const step = Math.floor(data.length / bars) || 1;
      const next = new Array(bars);
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] || 0;
        next[i] = 3 + Math.round((v / 255) * 34);
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const autoSaveRecording = useCallback(async (blob, mimeType, duration) => {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `recording.${ext}`);
      form.append('label', 'Voice Message');
      form.append('duration', String(duration));

      const res = await fetch(`${API_BASE_URL}/api/messages`, { method: 'POST', body: form });
      if (!res.ok) throw new Error('Upload failed');
      const saved = await res.json();
      setMessages((prev) => [saved, ...prev]);
    } catch (e) {
      setError('Could not save recording automatically.');
    } finally {
      setBusy(false);
      setElapsed(0);
      setCallState('incoming');
    }
  }, []);

  const answerCall = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      let startTime = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        const finalDuration = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        autoSaveRecording(blob, blob.type, finalDuration);
      };
      recorderRef.current = recorder;
      recorder.start(250);
      startLevelLoop(stream);
      setElapsed(0);
      setCallState('connected');
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      setError('Microphone access blocked. Please check browser permissions.');
    }
  }, [startLevelLoop, autoSaveRecording]);

  const endCall = useCallback(() => {
    // Trigger native browser fullscreen on user interaction (Decline)
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen().catch(() => {});
      }
    } catch (e) { /* ignore fullscreen errors */ }

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    stopLevelLoop();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      setCallState('incoming');
    }
  }, [stopLevelLoop]);

  const deleteMessage = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE_URL}/api/messages/${id}`, { method: 'DELETE' });
    } catch (e) { /* ignore */ }
    setMessages((prev) => prev.filter((m) => m._id !== id));
    if (playingId === id) {
      audioElRef.current?.pause();
      setPlayingId(null);
    }
  }, [playingId]);

  const togglePlay = useCallback((msg) => {
    const el = audioElRef.current;
    if (!el) return;
    if (playingId === msg._id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = `${API_BASE_URL}/uploads/${msg.filename}`;
    el.play().catch(() => {});
    setPlayingId(msg._id);
  }, [playingId]);

  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    const onEnd = () => setPlayingId(null);
    el.addEventListener('ended', onEnd);
    return () => el.removeEventListener('ended', onEnd);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopLevelLoop();
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  }, [stopLevelLoop]);

  return (
    <div className="apple-phone-wrap">
      <style>{`
        .apple-phone-wrap {
          background: #000;
          height: 100vh;
          height: -webkit-fill-available;
          width: 100vw;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif;
          color: #FFF;
          user-select: none;
          padding: 0;
          margin: 0;
          box-sizing: border-box;
          overflow: hidden;
        }

        .iphone-casing {
          width: 100%;
          height: 100%;
          max-width: 100%;
          max-height: 100%;
          background: #000000;
          border-radius: 0;
          box-shadow: none;
          position: relative;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        // .dynamic-island {
        //   position: absolute;
        //   top: 14px;
        //   left: 50%;
        //   transform: translateX(-50%);
        //   width: 124px;
        //   height: 34px;
        //   background: #000000;
        //   border-radius: 20px;
        //   z-index: 100;
        //   display: flex;
        //   align-items: center;
        //   justify-content: space-between;
        //   padding: 0 12px;
        //   box-sizing: border-box;
        //   border: 0.5px solid rgba(255,255,255,0.05);
        // }
        // .island-camera { width: 11px; height: 11px; background: #121216; border-radius: 50%; }
        // .island-sensor { width: 11px; height: 11px; background: #07070F; border-radius: 50%; }

        .ios-status-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 22px 28px 0px;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
          z-index: 90;
        }

        .wallpaper-blur {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 20%, #1c2744 0%, #0d121f 50%, #04060b 100%);
          z-index: 1;
        }

        .screen-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          z-index: 10;
          position: relative;
        }

        .top-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: calc(env(safe-area-inset-top, 12px) + 12px) 20px 0;
        }
        .nav-btn {
          background: rgba(255, 255, 255, 0.15);
          border: none;
          color: #FFF;
          font-size: 13px;
          font-weight: 600;
          padding: 7px 16px;
          border-radius: 20px;
          cursor: pointer;
          backdrop-filter: blur(25px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          transition: all 0.2s;
        }
        .nav-btn:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .apple-call-screen {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 40px 30px 50px;
          text-align: center;
        }

        .apple-caller-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
        }

        .apple-caller-avatar {
          width: 108px;
          height: 108px;
          border-radius: 50%;
          background: linear-gradient(180deg, #4A5B7F 0%, #2D374D 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
          margin: 0 auto 20px auto;
          border: 1px solid rgba(255, 255, 255, 0.15);
          overflow: hidden;
        }
        .caller-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 50%;
        }

        .pulse-ring {
          animation: ios-pulse 2.2s ease-out infinite;
        }
        @keyframes ios-pulse {
          0% { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0.6); }
          100% { box-shadow: 0 0 0 35px rgba(52, 199, 89, 0); }
        }

        .apple-caller-title {
          font-size: 34px;
          font-weight: 600;
          letter-spacing: -0.02em;
          margin: 0 0 6px;
          color: #FFFFFF;
        }
        .apple-call-subtitle {
          font-size: 16px;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.65);
          margin: 0 0 6px;
        }
        .apple-call-timer {
          font-size: 20px;
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          color: #FFFFFF;
        }

        .visualizer-wave {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 32px;
          margin-top: 14px;
        }
        .wave-bar {
          width: 3.5px;
          background: #34C759;
          border-radius: 3px;
          transition: height 90ms ease;
          box-shadow: 0 0 10px rgba(52, 199, 89, 0.5);
        }

        .apple-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px 28px;
          width: 100%;
          max-width: 290px;
          margin-bottom: 20px;
        }
        .apple-grid-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          background: none;
          border: none;
          color: #FFF;
          cursor: pointer;
        }
        .apple-grid-circle {
          width: 66px;
          height: 66px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.16);
          backdrop-filter: blur(25px);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        .apple-grid-circle.active {
          background: #FFFFFF;
          color: #000000;
        }
        .apple-grid-btn:active .apple-grid-circle {
          transform: scale(0.94);
          background: rgba(255, 255, 255, 0.3);
        }
        .apple-grid-label {
          font-size: 11px;
          font-weight: 400;
          color: #FFFFFF;
          letter-spacing: -0.01em;
        }

        .apple-actions-row {
          display: flex;
          align-items: center;
          justify-content: space-around;
          width: 100%;
          max-width: 280px;
        }
        .action-button-group {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .action-button-label {
          font-size: 13px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.8);
        }

        .apple-circle-btn {
          width: 76px;
          height: 76px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #FFFFFF;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .apple-circle-btn:active { transform: scale(0.92); }

        .btn-apple-decline {
          background: #FF3B30;
          box-shadow: 0 10px 25px rgba(255, 59, 48, 0.4);
        }
        .btn-apple-answer {
          background: #34C759;
          box-shadow: 0 10px 25px rgba(52, 199, 89, 0.4);
        }

        .apple-review-card {
          width: 100%;
          background: rgba(30, 35, 48, 0.85);
          border-radius: 28px;
          padding: 26px;
          box-sizing: border-box;
          backdrop-filter: blur(40px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 20px 50px rgba(0,0,0,0.6);
        }
        .review-card-header {
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 6px;
          font-weight: 600;
        }
        .review-card-time {
          font-size: 32px;
          font-weight: 300;
          margin-bottom: 20px;
        }
        .apple-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 14px 16px;
          color: #FFF;
          font-size: 15px;
          outline: none;
          box-sizing: border-box;
          margin-bottom: 18px;
        }
        .apple-review-btns {
          display: flex;
          gap: 12px;
        }
        .apple-pill-btn {
          flex: 1;
          padding: 14px;
          border-radius: 22px;
          border: none;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
        }
        .pill-save { background: #34C759; color: #FFF; }
        .pill-discard { background: rgba(255, 255, 255, 0.12); color: #FFF; }

        .voicemail-screen {
          flex: 1;
          padding: 10px 20px 30px;
          overflow-y: auto;
        }
        .voicemail-header {
          font-size: 34px;
          font-weight: 700;
          margin: 10px 0 20px;
          letter-spacing: -0.02em;
        }
        .voicemail-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          margin-bottom: 12px;
          backdrop-filter: blur(20px);
        }
        .vm-play-circle {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: #34C759;
          border: none;
          color: #FFF;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .vm-details {
          flex: 1;
          margin: 0 14px;
          text-align: left;
        }
        .vm-name { font-size: 16px; font-weight: 600; }
        .vm-sub { font-size: 13px; color: rgba(255, 255, 255, 0.5); margin-top: 2px; }

        .apple-error-toast {
          background: rgba(255, 59, 48, 0.9);
          padding: 10px 16px;
          border-radius: 14px;
          font-size: 13px;
          margin-top: 10px;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
      `}</style>

      <div className="iphone-casing">
        <div className="wallpaper-blur" />

        <div className="dynamic-island">
          <div className="island-camera" />
          <div className="island-sensor" />
        </div>

        <div className="ios-status-bar">
          <span>12:51</span>
          <span style={{ fontSize: '12px' }}>5G</span>
        </div>

        <div className="screen-container">
          <div className="top-nav">
            {activeScreen === 'call' ? (
              <button className="nav-btn" onClick={() => setActiveScreen('voicemails')}>
                Voicemails ({messages.length})
              </button>
            ) : (
              <button className="nav-btn" onClick={() => setActiveScreen('call')}>
                ← Phone Call
              </button>
            )}
          </div>

          {activeScreen === 'call' && (
            <div className="apple-call-screen">
              
              <div className="apple-caller-header">
                <div className={`apple-caller-avatar ${callState === 'connected' ? 'pulse-ring' : ''}`}>
                  <img src={elliPic} alt="Elli" className="caller-img" />
                </div>

                <h1 className="apple-caller-title">{callerName}</h1>

                {callState === 'incoming' && (
                  <p className="apple-call-subtitle">Incoming Call…</p>
                )}

                {callState === 'connected' && (
                  <>
                    {/* <p className="apple-call-subtitle">Recording Live Call</p> */}
                    <div className="apple-call-timer">{formatTime(elapsed)}</div>
                    
                    <div className="visualizer-wave">
                      {levels.map((h, i) => (
                        <span key={i} className="wave-bar" style={{ height: `${h}px` }} />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {callState === 'connected' && (
                <div className="apple-grid">
                  <button className="apple-grid-btn" onClick={() => setMuted(!muted)}>
                    <div className={`apple-grid-circle ${muted ? 'active' : ''}`}><Mic size={24} /></div>
                    <span className="apple-grid-label">{muted ? 'unmute' : 'mute'}</span>
                  </button>
                  <button className="apple-grid-btn">
                    <div className="apple-grid-circle"><Phone size={24} /></div>
                    <span className="apple-grid-label">keypad</span>
                  </button>
                  <button className="apple-grid-btn" onClick={() => setSpeaker(!speaker)}>
                    <div className={`apple-grid-circle ${speaker ? 'active' : ''}`}><Play size={24} /></div>
                    <span className="apple-grid-label">audio</span>
                  </button>
                  <button className="apple-grid-btn">
                    <div className="apple-grid-circle"><Mic size={24} /></div>
                    <span className="apple-grid-label">add call</span>
                  </button>
                  <button className="apple-grid-btn">
                    <div className="apple-grid-circle"><Phone size={24} /></div>
                    <span className="apple-grid-label">FaceTime</span>
                  </button>
                  <button className="apple-grid-btn">
                    <div className="apple-grid-circle"><Mic size={24} /></div>
                    <span className="apple-grid-label">contacts</span>
                  </button>
                </div>
              )}

              {callState === 'incoming' && (
                <div className="apple-actions-row">
                  <div className="action-button-group">
                    <button className="apple-circle-btn btn-apple-decline" onClick={endCall}>
                      <PhoneOff size={32} />
                    </button>
                    <span className="action-button-label">Decline</span>
                  </div>
                  <div className="action-button-group">
                    <button className="apple-circle-btn btn-apple-answer" onClick={answerCall}>
                      <Phone size={32} />
                    </button>
                    <span className="action-button-label">Accept</span>
                  </div>
                </div>
              )}

              {callState === 'connected' && (
                <div className="apple-actions-row">
                  <div className="action-button-group">
                    <button className="apple-circle-btn btn-apple-decline" onClick={endCall}>
                      <PhoneOff size={34} />
                    </button>
                    <span className="action-button-label">End Call</span>
                  </div>
                </div>
              )}



              {error && <div className="apple-error-toast">{error}</div>}
            </div>
          )}

          {activeScreen === 'voicemails' && (
            <div className="voicemail-screen">
              <h1 className="voicemail-header">Voicemails</h1>
              {!loaded ? null : messages.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', marginTop: '80px', fontSize: '15px' }}>
                  No saved voicemails
                </p>
              ) : (
                messages.map((m) => (
                  <div className="voicemail-row" key={m._id}>
                    <button className="vm-play-circle" onClick={() => togglePlay(m)}>
                      {playingId === m._id ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <div className="vm-details">
                      <div className="vm-name">{m.label || 'Unknown Caller'}</div>
                      <div className="vm-sub">{formatWhen(m.createdAt)} · {formatTime(m.duration)}</div>
                    </div>
                    <button
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
                      onClick={() => deleteMessage(m._id)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <audio ref={audioElRef} style={{ display: 'none' }} />
    </div>
  );
}
