import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  Mic,
  MicOff,
  Navigation,
  Send,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAppStore } from '../store/useAppStore';
import type { AIChatResponse, PendingConfirmation, ToolCallTrace } from '../types';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  agentUsed?: string;
  provider?: string;
  toolCalls?: ToolCallTrace[];
  pendingAction?: PendingConfirmation | null;
  recommendations?: Array<Record<string, unknown>>;
}

const EXAMPLE_PROMPTS = [
  'Find a fast charger near Connaught Place',
  'Mere paas sabse sasta charger dhundo',
  'Book Charger 2 at ChargeZone Saket for 6 PM',
  'Is Charger 1 free right now?',
];

export function AssistantDrawer() {
  const navigate = useNavigate();
  const assistantOpen = useAppStore((s) => s.assistantOpen);
  const openAssistant = useAppStore((s) => s.openAssistant);
  const closeAssistant = useAppStore((s) => s.closeAssistant);
  const draftPrompt = useAppStore((s) => s.assistantDraftPrompt);
  const clearDraftPrompt = useAppStore((s) => s.clearDraftPrompt);
  const userLocation = useAppStore((s) => s.userLocation);
  const user = useAppStore((s) => s.user);
  const setRoutePlan = useAppStore((s) => s.setRoutePlan);
  const setSelectedStationId = useAppStore((s) => s.setSelectedStationId);
  const addToast = useAppStore((s) => s.addToast);

  const [mode, setMode] = useState<'chat' | 'route'>('chat');
  const [language, setLanguage] = useState<'en-IN' | 'hi-IN'>('en-IN');
  const [speakReplies, setSpeakReplies] = useState(true);
  const [listening, setListening] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Namaste! Ask me in English, Hindi, or Hinglish to find chargers, check live availability, plan a Delhi-NCR route, or book a slot.',
      agentUsed: 'Orchestrator Agent',
    },
  ]);

  // Route planner state
  const [routeOrigin, setRouteOrigin] = useState('Connaught Place');
  const [routeDest, setRouteDest] = useState('Cyber Hub Gurugram');
  const [routeBattery, setRouteBattery] = useState(28);

  const recognitionRef = useRef<unknown>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, assistantOpen]);

  useEffect(() => {
    if (draftPrompt && assistantOpen) {
      setInputText(draftPrompt);
      clearDraftPrompt();
    }
  }, [draftPrompt, assistantOpen, clearDraftPrompt]);

  const speakText = (text: string) => {
    if (!speakReplies || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = language;
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    } catch {
      // SpeechSynthesis unsupported in headless environments
    }
  };

  const sendMessage = async (textToSend: string, confirmActionId?: string) => {
    const clean = textToSend.trim();
    if (!clean && !confirmActionId) return;

    if (!confirmActionId) {
      setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: clean }]);
      setInputText('');
    }
    setSending(true);
    try {
      const battery = user?.vehicles?.[0]?.current_battery_pct ?? 35;
      const endpoint = listening ? '/ai/voice-intent' : '/ai/chat';
      const res = await apiClient.post<AIChatResponse>(endpoint, {
        message: clean || 'Confirm action',
        language,
        user_lat: userLocation[0],
        user_lng: userLocation[1],
        battery_pct: battery,
        confirm_action_id: confirmActionId ?? null,
      });

      const data = res.data;
      if (data.route_plan) {
        setRoutePlan(data.route_plan);
      }
      if (data.executed_booking) {
        addToast({
          title: 'Booking Updated by AI',
          message: `${data.executed_booking.station_name} · ${data.executed_booking.charger_label}`,
          variant: 'success',
        });
      }

      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: data.reply,
          agentUsed: `${data.agent_used} (${data.provider})`,
          toolCalls: data.tool_calls,
          pendingAction: data.pending_action,
          recommendations: data.recommendations,
        },
      ]);
      speakText(data.speak_text);
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: 'Could not reach the AI orchestrator right now. Please try again.',
          agentUsed: 'Error Handler',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const toggleVoiceMic = () => {
    if (listening) {
      (recognitionRef.current as { stop?: () => void } | null)?.stop?.();
      setListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
    };

    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      addToast({
        title: 'Voice Input Unavailable',
        message: 'Your browser does not support Web Speech API. Type or pick a sample prompt below.',
        variant: 'info',
      });
      return;
    }

    const rec = new SpeechRec();
    rec.lang = language;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        sendMessage(transcript);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const handlePlanRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await apiClient.post('/ai/plan-route', {
        origin: routeOrigin,
        destination: routeDest,
        battery_pct: routeBattery,
        vehicle_range_km: user?.vehicles?.[0]?.range_km ?? 310,
        connector_type: user?.vehicles?.[0]?.connector_type ?? 'CCS2',
      });
      setRoutePlan(res.data);
      setMode('chat');
      setTurns((prev) => [
        ...prev,
        {
          id: `rt-${Date.now()}`,
          role: 'assistant',
          text: res.data.summary,
          agentUsed: 'Route & Range Agent',
          toolCalls: [
            {
              tool_name: 'plan_ev_route',
              arguments: { origin: routeOrigin, destination: routeDest, battery_pct: routeBattery },
              status: 'ok',
              summary: `Corridor plotted (${res.data.recommended_stops.length} stop(s))`,
            },
          ],
        },
      ]);
      navigate('/map');
    } catch {
      addToast({ title: 'Route Planning Failed', message: 'Could not compute route corridor.', variant: 'error' });
    } finally {
      setSending(false);
    }
  };

  if (!assistantOpen) {
    return (
      <button
        type="button"
        onClick={() => openAssistant()}
        aria-label="Open ChargeKaro AI and Voice Assistant"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-xl hover:bg-emerald-400 transition-transform hover:scale-[1.02] no-print"
      >
        <Bot className="h-5 w-5" aria-hidden="true" />
        <span>AI &amp; Voice</span>
      </button>
    );
  }

  return (
    <aside
      aria-label="ChargeKaro AI and Voice Assistant"
      className="fixed bottom-4 right-4 z-50 flex h-[580px] max-h-[85vh] w-[410px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 no-print"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          <span className="font-display text-sm font-bold text-slate-900 dark:text-white">
            ChargeKaro AI
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            aria-label="Voice language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'en-IN' | 'hi-IN')}
            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="en-IN">en-IN</option>
            <option value="hi-IN">hi-IN</option>
          </select>
          <button
            type="button"
            onClick={() => setSpeakReplies((v) => !v)}
            aria-label={speakReplies ? 'Mute voice replies' : 'Enable voice replies'}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {speakReplies ? <Volume2 className="h-4 w-4 text-emerald-500" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={closeAssistant}
            aria-label="Close AI Assistant"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950/60">
        <button
          type="button"
          onClick={() => setMode('chat')}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
            mode === 'chat'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Chat &amp; Voice Agents
        </button>
        <button
          type="button"
          onClick={() => setMode('route')}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
            mode === 'route'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Route &amp; Range Planner
        </button>
      </div>

      {mode === 'route' ? (
        <form onSubmit={handlePlanRoute} className="flex-1 space-y-4 overflow-y-auto p-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Plan a Delhi-NCR trip corridor and plot optimal fast-charging stops onto the live map.
          </p>
          <div>
            <label htmlFor="route-origin" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Origin
            </label>
            <input
              id="route-origin"
              type="text"
              value={routeOrigin}
              onChange={(e) => setRouteOrigin(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="route-dest" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Destination
            </label>
            <input
              id="route-dest"
              type="text"
              value={routeDest}
              onChange={(e) => setRouteDest(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="route-battery" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Current Battery ({routeBattery}%)
            </label>
            <input
              id="route-battery"
              type="range"
              min={5}
              max={100}
              value={routeBattery}
              onChange={(e) => setRouteBattery(Number(e.target.value))}
              className="mt-1 w-full accent-emerald-500"
            />
          </div>
          <button
            type="submit"
            disabled={sending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400"
          >
            <Navigation className="h-4 w-4" />
            <span>Plot Charging Corridor on Map</span>
          </button>
        </form>
      ) : (
        <>
          {/* Conversation History */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {turns.map((t) => (
              <div key={t.id} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    t.role === 'user'
                      ? 'bg-emerald-500 font-medium text-slate-950'
                      : 'border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'
                  }`}
                >
                  {t.agentUsed && (
                    <div className="mb-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                      {t.agentUsed}
                    </div>
                  )}
                  <p>{t.text}</p>

                  {/* Recommended stations quick-select */}
                  {t.recommendations && t.recommendations.length > 0 && (
                    <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2 dark:border-slate-800">
                      {t.recommendations.slice(0, 2).map((rec, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSelectedStationId(Number(rec.station_id));
                            navigate('/map');
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] hover:border-emerald-500 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <span className="font-semibold text-slate-900 dark:text-white">
                            <MapPin className="mr-1 inline h-3 w-3 text-emerald-500" />
                            {String(rec.station_name)}
                          </span>
                          <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                            ₹{String(rec.price_per_kwh)}/kWh
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Explicit Write Confirmation Gate */}
                  {t.pendingAction && (
                    <div className="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/40">
                      <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                        Confirmation Required
                      </p>
                      <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                        {t.pendingAction.summary}
                      </p>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => sendMessage('Confirm', t.pendingAction!.action_id)}
                        className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" /> Confirm &amp; Execute
                      </button>
                    </div>
                  )}

                  {/* Transparent Agent Activity Panel */}
                  {t.toolCalls && t.toolCalls.length > 0 && (
                    <div className="mt-2 border-t border-slate-200 pt-1.5 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setShowActivity((v) => !v)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        <Wrench className="h-3 w-3" />
                        <span>Agent Activity ({t.toolCalls.length} tool call)</span>
                        {showActivity ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>
                      {showActivity && (
                        <div className="mt-1 space-y-1">
                          {t.toolCalls.map((tc, idx) => (
                            <div
                              key={idx}
                              className="rounded bg-slate-200/70 p-1.5 font-mono text-[10px] leading-relaxed text-slate-800 break-all whitespace-pre-wrap dark:bg-slate-900 dark:text-slate-300"
                            >
                              <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                                {tc.tool_name}({JSON.stringify(tc.arguments)})
                              </div>
                              <div className="text-slate-600 dark:text-slate-400">{tc.summary}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Command Chips */}
          <div className="flex gap-1.5 overflow-x-auto border-t border-slate-200 px-3 py-2 dark:border-slate-800">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => sendMessage(p)}
                className="whitespace-nowrap shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 hover:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
              >
                {p}
              </button>
            ))}
          </div>

          {/* Input + Voice Mic */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(inputText);
            }}
            className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
          >
            <button
              type="button"
              onClick={toggleVoiceMic}
              aria-label={listening ? 'Stop voice recording' : 'Start voice command'}
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                listening
                  ? 'border-rose-500 bg-rose-500 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={language === 'hi-IN' ? 'Boliye ya likhiye...' : 'Ask about chargers, booking, or routes...'}
              aria-label="Ask ChargeKaro AI"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={sending || !inputText.trim()}
              aria-label="Send message"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
