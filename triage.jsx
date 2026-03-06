import { useState, useCallback } from "react";

// ─── COMPLIANCE PRECHECK (rules layer — hard stops only) ──────────────────────
// The rules layer no longer classifies. It runs one job: detect compliance hard
// stops before the LLM call so they can be flagged immediately and never missed
// due to model error. The LLM is the authoritative classifier for everything else.

const LEGAL_THREAT_PATTERNS = [
  "arrested", "jail", "prison", "criminal", "law enforcement", "police", "prosecut",
  "will be arrested", "going to be arrested", "threaten.*arrest", "criminal charges",
  "garnish", "wage garnishment", "wages.*garnish", "seize", "asset seizure", "levy", "lien",
  "lawsuit", "sue you", "legal action", "take.*court", "attorney", "judgment", "file.*suit",
  "referred.*attorney", "face.*legal", "must pay.*or.*legal"
];

const LEP_PATTERNS_TRIGGER  = [
  // Spanish
  "habla", "spanish.*caller", "responds in english", "limited english", "lep",
  // Language-agnostic: any named language + caller/speaking pattern
  "mandarin.*caller", "mandarin.*speaking", "caller.*mandarin",
  "cantonese.*caller", "cantonese.*speaking",
  "vietnamese.*caller", "vietnamese.*speaking",
  "korean.*caller", "korean.*speaking",
  "arabic.*caller", "arabic.*speaking",
  "portuguese.*caller", "portuguese.*speaking",
  "french.*caller", "french.*speaking",
  "tagalog.*caller", "tagalog.*speaking",
  "russian.*caller", "russian.*speaking",
  "hindi.*caller", "hindi.*speaking",
  // Generic: "[language]-speaking callers"
  "speaking callers.*routed", "callers.*routed.*english", "english.only agent",
  "salient supports",
];
const LEP_PATTERNS_FAILURE  = ["misunderstands", "keeps", "always", "every time", "won't",
                                "doesn't", "routed", "routing", "english-only", "english only",
                                "supports.*mandarin", "supports.*spanish", "supports"];
const OUTAGE_PATTERNS       = ["nothing is saving", "near zero", "dropped to near zero",
                                "connect rate dropped", "cannot place", "cannot receive", "all calls failing"];

function mp(text, patterns) {
  const lower = text.toLowerCase();
  for (const p of patterns) {
    try { if (new RegExp(p, "i").test(lower)) return p; } catch { if (lower.includes(p)) return p; }
  }
  return null;
}

function runCompliancePrecheck(reportText, impact) {
  const t = reportText;

  if (mp(t, LEGAL_THREAT_PATTERNS)) {
    return {
      bucket: "LLM", severity: { level: "Sev0" }, confidence: { level: "High" },
      secondaryTags: ["compliance-risk"], isComplianceRisk: true,
      routing: ROUTING_MAP["LLM"],
      complianceRouting: { team: "Legal / Compliance", channel: "#legal-compliance" },
      warning: "🚨 Sev0-Compliance: stop-ship. Legal review required before next deployment.",
    };
  }

  if (mp(t, LEP_PATTERNS_TRIGGER) && mp(t, LEP_PATTERNS_FAILURE)) {
    return {
      bucket: "STT", severity: { level: "Sev0" }, confidence: { level: "High" },
      secondaryTags: ["compliance-risk", "accent/language"], isComplianceRisk: true,
      routing: ROUTING_MAP["STT"],
      complianceRouting: { team: "Legal / Compliance", channel: "#legal-compliance" },
      warning: "🚨 Sev0-Compliance: LEP discrimination risk. Compliance team must be looped in.",
    };
  }

  if (impact === "Outage" || mp(t, OUTAGE_PATTERNS)) {
    return {
      bucket: "Infra", severity: { level: "Sev0" }, confidence: { level: impact === "Outage" ? "High" : "Med" },
      secondaryTags: [], isComplianceRisk: false,
      routing: ROUTING_MAP["Infra"], complianceRouting: null,
      warning: impact !== "Outage" ? "⚠️ Sev0 triggered by text signals — confirm scope before routing." : null,
    };
  }

  // No hard stop — return placeholder; LLM will classify
  return {
    bucket: null, severity: { level: null }, confidence: { level: null },
    secondaryTags: [], isComplianceRisk: false,
    routing: null, complianceRouting: null, warning: null,
  };
}

const ROUTING_MAP = {
  STT:         { team: "Voice AI",           channel: "#voice-ai-bugs"     },
  TTS:         { team: "Voice AI",           channel: "#voice-ai-bugs"     },
  LLM:         { team: "Voice AI / Product", channel: "#llm-issues"        },
  "Post-call": { team: "Integrations",       channel: "#integrations-bugs"  },
  Infra:       { team: "Platform/Infra",     channel: "#infra-oncall"      },
};


// ─── TEST SET ────────────────────────────────────────────────────────────────


const TEST_REPORTS = [
  { id: 1, text: "Agent keeps hearing 'yes' as 'no' and sends people to collections escalation incorrectly." },
  { id: 2, text: "Customers say the voice sounds robotic and garbled, and they can't understand amounts." },
  { id: 3, text: "Agent told a customer they're going to be arrested if they don't pay today." },
  { id: 4, text: "Calls connect, but after the call we don't see notes in Salesforce and no summary is written." },
  { id: 5, text: "We're getting 500 errors on the /webhook/call-ended endpoint; nothing is saving." },
  { id: 6, text: "Agent repeats the same question in a loop even after the customer answers." },
  { id: 7, text: "Audio is fine, but the transcript shows [inaudible] for half the call." },
  { id: 8, text: "The agent voice cuts off mid-sentence when the customer interrupts—barge-in seems broken." },
  { id: 9, text: "Outbound attempts show 'dialed' but the customer never receives a ring—carrier connect rate dropped to near zero." },
  { id: 10, text: "Agent misunderstands Spanish callers; keeps responding in English even when they ask '¿Habla español?'" },
  { id: 11, text: "After successful payments, the system sometimes double-logs the payment event (duplicate transaction IDs)." },
  { id: 12, text: "On long calls, the voice response starts taking 8–12 seconds to speak back." },
  { id: 13, text: "Customer says they already paid; agent still insists they haven't and won't check—bad account lookup/tool use." },
  { id: 14, text: "We can't retrieve recordings for yesterday—storage shows 'file not found' for many call IDs." },
  { id: 15, text: "Agent reads the amount as 'one hundred twenty' when it should be 'one thousand twenty'—number pronunciation is wrong." },
];

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const SEV_COLORS = {
  Sev0: { bg: "bg-red-950", badge: "bg-red-600 text-white", text: "text-red-400", border: "border-red-800" },
  Sev1: { bg: "bg-orange-950", badge: "bg-orange-500 text-white", text: "text-orange-400", border: "border-orange-800" },
  Sev2: { bg: "bg-yellow-950", badge: "bg-yellow-600 text-white", text: "text-yellow-400", border: "border-yellow-800" },
  Sev3: { bg: "bg-slate-800", badge: "bg-slate-500 text-white", text: "text-slate-300", border: "border-slate-600" },
};

const BUCKET_COLORS = {
  STT: "bg-blue-900 text-blue-200",
  TTS: "bg-purple-900 text-purple-200",
  LLM: "bg-emerald-900 text-emerald-200",
  "Post-call": "bg-amber-900 text-amber-200",
  Infra: "bg-rose-900 text-rose-200",
};

const CONFIDENCE_COLORS = {
  High: "text-emerald-400",
  Med: "text-yellow-400",
  Low: "text-red-400",
};

const STATUS_OPTIONS = ["New", "In Review", "Routed", "Resolved"];
const STATUS_COLORS = {
  New: "bg-blue-900 text-blue-300",
  "In Review": "bg-yellow-900 text-yellow-300",
  Routed: "bg-purple-900 text-purple-300",
  Resolved: "bg-emerald-900 text-emerald-300",
};

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function Badge({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold ${className}`}>
      {children}
    </span>
  );
}

function Tag({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300 font-mono mr-1 mb-1">
      {children}
    </span>
  );
}

function Section({ label, children }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1.5">{label}</div>
      {children}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState("submit"); // submit | queue
  const [form, setForm] = useState({ report: "", customer: "", callId: "", startedAt: "", impact: "" });
  const [triageResult, setTriageResult] = useState(null);
  const [llmResult, setLlmResult] = useState(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState(null);
  const [queue, setQueue] = useState([]);
  const [override, setOverride] = useState({ bucket: "", severity: "", note: "" });
  const [overrideMode, setOverrideMode] = useState(false);
  const [queueFilters, setQueueFilters] = useState({ bucket: "", severity: "", status: "" });
  const [expandedRow, setExpandedRow] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!form.report.trim()) return;
    const customer = form.customer.trim() || "Customer";

    // Rules layer: compliance hard-stop pre-check only
    const rulesPrecheck = runCompliancePrecheck(form.report, form.impact);
    setTriageResult({ ...rulesPrecheck, form: { ...form, customer }, pending: true });
    setOverride({ bucket: "", severity: "", note: "" });
    setOverrideMode(false);
    setLlmResult(null);
    setLlmError(null);
    setLlmLoading(true);

    try {
      const res = await callLLMWithKey(form.report, form.impact, rulesPrecheck, apiKey || null);
      setLlmResult(res);

      // LLM is the authoritative classifier — build triageResult from its output
      const routing = ROUTING_MAP[res.bucket] || { team: "Engineering", channel: "#bugs" };
      const isCompliance = res.complianceFlag || rulesPrecheck.isComplianceRisk;
      setTriageResult({
        bucket: res.bucket,
        severity: { level: res.severity },
        confidence: { level: res.confidence },
        secondaryTags: res.secondaryTags || [],
        routing,
        complianceRouting: isCompliance ? { team: "Legal / Compliance", channel: "#legal-compliance" } : null,
        isComplianceRisk: isCompliance,
        llmComplianceOverride: res.complianceFlag && !rulesPrecheck.isComplianceRisk,
        warning: rulesPrecheck.warning || null,
        form: { ...form },
        pending: false,
      });
      setOverride({ bucket: res.bucket, severity: res.severity, note: "" });
    } catch (e) {
      setLlmError("Classification failed: " + e.message);
      // Fall back to rules precheck result on error
      setTriageResult(prev => ({ ...prev, pending: false }));
    } finally {
      setLlmLoading(false);
    }
  }, [form, apiKey]);

  const handleConfirmRoute = useCallback(() => {
    const finalBucket = overrideMode && override.bucket ? override.bucket : triageResult.bucket;
    const finalSeverity = overrideMode && override.severity ? override.severity : triageResult.severity.level;
    const entry = {
      id: `TKT-${String(queue.length + 1).padStart(3, "0")}`,
      customer: triageResult.form.customer,
      callId: triageResult.form.callId,
      report: triageResult.form.report,
      bucket: finalBucket,
      severity: finalSeverity,
      secondaryTags: triageResult.secondaryTags,
      routing: triageResult.routing,
      complianceRouting: triageResult.complianceRouting,
      status: "New",
      submittedAt: new Date().toISOString(),
      triageResult,
      llmResult,
      override: overrideMode ? { ...override } : null,
      isComplianceRisk: triageResult.isComplianceRisk,
    };
    setQueue(q => [entry, ...q]);
    setForm({ report: "", customer: "", callId: "", startedAt: "", impact: "" });
    setTriageResult(null);
    setLlmResult(null);
  }, [triageResult, llmResult, override, overrideMode, queue]);

  const handleStatusChange = (id, status) => {
    setQueue(q => q.map(t => t.id === id ? { ...t, status } : t));
  };

  const filtered = queue.filter(t =>
    (!queueFilters.bucket || t.bucket === queueFilters.bucket) &&
    (!queueFilters.severity || t.severity === queueFilters.severity) &&
    (!queueFilters.status || t.status === queueFilters.status)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'DM Mono', 'Fira Mono', monospace" }}>
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <span className="font-semibold text-sm tracking-wide text-slate-100">Salient</span>
          <span className="text-slate-600 mx-1">|</span>
          <span className="text-slate-400 text-sm">Bug Triage Console</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowApiKey(v => !v)} className="text-xs text-slate-500 hover:text-slate-300 px-3 py-1 rounded border border-slate-700 hover:border-slate-500 transition-colors">
            {apiKey ? "✓ API Key set" : "Set API Key"}
          </button>
          <nav className="flex gap-1">
            {["submit", "queue"].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded text-xs font-semibold tracking-wide transition-colors ${view === v ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}>
                {v === "submit" ? "New Report" : `Queue (${queue.length})`}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* API Key input */}
      {showApiKey && (
        <div className="bg-slate-900 border-b border-slate-700 px-6 py-3 flex items-center gap-3">
          <span className="text-xs text-slate-400">Anthropic API Key</span>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="flex-1 max-w-sm bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-500" />
          <span className="text-xs text-slate-500">Used for LLM evidence + follow-up questions</span>
          <button onClick={() => setShowApiKey(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* ── SUBMIT + RESULT SPLIT VIEW ── */}
        {view === "submit" && (
          <div className="flex gap-6 items-start">

            {/* LEFT: Form */}
            <div className="w-96 flex-shrink-0">
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-slate-100 mb-1">Submit Bug Report</h1>
                <p className="text-slate-500 text-xs">Rules layer classifies instantly. LLM generates evidence + follow-ups.</p>
              </div>

              {/* Quick select */}
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Quick-select test report</div>
                <div className="flex flex-wrap gap-1.5">
                  {TEST_REPORTS.map(r => (
                    <button key={r.id} onClick={() => setForm(f => ({ ...f, report: r.text, customer: f.customer || "Test Customer" }))}
                      className="text-xs px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:border-emerald-600 hover:text-emerald-400 transition-colors">
                      #{r.id}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-widest mb-1.5">Bug Report *</label>
                  <textarea value={form.report} onChange={e => setForm(f => ({ ...f, report: e.target.value }))}
                    rows={5} placeholder="Paste the raw bug report here..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-600 resize-none placeholder-slate-600" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-widest mb-1.5">Customer *</label>
                  <input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))}
                    placeholder="Customer name"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-600 placeholder-slate-600" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-widest mb-1.5">Call ID <span className="text-slate-600 normal-case">(opt)</span></label>
                    <input value={form.callId} onChange={e => setForm(f => ({ ...f, callId: e.target.value }))}
                      placeholder="call_abc123"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-600 placeholder-slate-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-widest mb-1.5">Impact *</label>
                    <select value={form.impact} onChange={e => setForm(f => ({ ...f, impact: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-600">
                      <option value="">— scope —</option>
                      <option>Single caller</option>
                      <option>Many callers</option>
                      <option>Outage</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-widest mb-1.5">When did it start? <span className="text-slate-600 normal-case">(opt)</span></label>
                  <input type="datetime-local" value={form.startedAt} onChange={e => setForm(f => ({ ...f, startedAt: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-400 outline-none focus:border-emerald-600" />
                </div>
              </div>

              <button onClick={handleSubmit} disabled={!form.report.trim() || llmLoading}
                className="mt-4 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors">
                {llmLoading ? "Classifying..." : "Run Triage →"}
              </button>
            </div>

            {/* RIGHT: Triage Result */}
            <div className="flex-1 min-w-0">
              {!triageResult ? (
                <div className="h-full flex items-center justify-center py-32">
                  <div className="text-center">
                    <div className="text-slate-700 text-4xl mb-3">⟳</div>
                    <div className="text-slate-600 text-sm">Triage output will appear here</div>
                    <div className="text-slate-700 text-xs mt-1">Submit a report or select a test case</div>
                  </div>
                </div>
              ) : triageResult.pending ? (
                <div className="h-full flex items-center justify-center py-32">
                  <div className="text-center">
                    <div className="flex justify-center mb-4">
                      <span className="inline-block w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                    <div className="text-slate-400 text-sm">Classifying report...</div>
                    <div className="text-slate-600 text-xs mt-1">Applying triage framework</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-slate-200">{triageResult.form.customer}</span>
                      {triageResult.form.callId && <span className="text-xs text-slate-600 font-mono ml-3">{triageResult.form.callId}</span>}
                    </div>
                    <span className="text-xs text-slate-600">Review & confirm before routing</span>
                  </div>

                  {/* Report quote */}
                  <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 mb-3 text-xs text-slate-400 italic leading-relaxed">
                    "{triageResult.form.report}"
                  </div>

                  {/* Legal threat / Sev0-compliance banner */}
                  {triageResult.isLegalThreat && (
                    <div className="bg-red-950 border-2 border-red-600 rounded-lg px-4 py-3 mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-red-400">🚨</span>
                        <span className="text-red-300 text-xs font-bold uppercase tracking-widest">Sev0 — Compliance</span>
                      </div>
                      <div className="text-red-200 text-xs">Agent delivered a false legal threat. UDAAP risk + potential state law violations + immediate reputational exposure. Stop-ship. Legal review required before any further calls.</div>
                    </div>
                  )}

                  {/* General compliance risk banner (non-Sev0) */}
                  {triageResult.isComplianceRisk && !triageResult.isLegalThreat && (
                    <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-2.5 mb-3 flex items-start gap-2.5">
                      <span className="text-red-400 mt-0.5">⚠</span>
                      <div>
                        <div className="text-red-300 text-xs font-semibold">Compliance Risk</div>
                        <div className="text-red-500 text-xs mt-0.5">Flag for compliance review regardless of engineering routing.</div>
                      </div>
                    </div>
                  )}

                  {/* LLM-detected compliance override — rules layer missed it */}
                  {triageResult.llmComplianceOverride && (
                    <div className="bg-amber-950 border-2 border-amber-500 rounded-lg px-4 py-3 mb-3 flex items-start gap-2.5">
                      <span className="text-amber-400 mt-0.5 text-base">⚠</span>
                      <div>
                        <div className="text-amber-300 text-xs font-bold uppercase tracking-widest mb-1">LLM: Possible Compliance Violation Detected</div>
                        <div className="text-amber-400 text-xs">The AI identified a potential legal or regulatory issue not caught by automatic classification. Review the evidence below before confirming. Do not route without human verification.</div>
                      </div>
                    </div>
                  )}

                  {/* Sev0 warning */}
                  {triageResult.severity.warning && (
                    <div className="bg-amber-950 border border-amber-800 rounded-lg px-4 py-2.5 mb-3 text-amber-300 text-xs">
                      {triageResult.severity.warning}
                    </div>
                  )}

                  {/* Core classification row */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-600 uppercase tracking-widest mb-1.5">Bucket</div>
                      <Badge className={BUCKET_COLORS[triageResult.bucket]}>{triageResult.bucket}</Badge>
                    </div>
                    <div className={`border rounded-lg p-3 ${SEV_COLORS[triageResult.severity.level]?.bg} ${SEV_COLORS[triageResult.severity.level]?.border}`}>
                      <div className="text-xs text-slate-600 uppercase tracking-widest mb-1.5">Severity</div>
                      <Badge className={SEV_COLORS[triageResult.severity.level]?.badge}>{triageResult.severity.level}</Badge>
                    </div>
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-600 uppercase tracking-widest mb-1.5">Confidence</div>
                      <span className={`text-sm font-semibold ${CONFIDENCE_COLORS[triageResult.confidence.level]}`}>
                        {triageResult.confidence.level}
                      </span>
                    </div>
                  </div>

                  {/* Tags + Routing row */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {triageResult.secondaryTags.length > 0 && (
                      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                        <div className="text-xs text-slate-600 uppercase tracking-widest mb-1.5">Tags</div>
                        <div className="flex flex-wrap">{triageResult.secondaryTags.map(t => <Tag key={t}>{t}</Tag>)}</div>
                      </div>
                    )}
                    <div className={`bg-slate-900 border border-slate-700 rounded-lg p-3 ${triageResult.secondaryTags.length === 0 ? "col-span-2" : ""}`}>
                      <div className="text-xs text-slate-600 uppercase tracking-widest mb-1.5">Routing</div>
                      <div className="text-sm text-slate-200 flex items-center gap-2">
                        <span className="font-semibold">{triageResult.routing.team}</span>
                        <span className="text-slate-600">→</span>
                        <span className="font-mono text-emerald-400 text-xs">{triageResult.routing.channel}</span>
                      </div>
                      {triageResult.complianceRouting && (
                        <div className="text-sm text-slate-200 flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-700">
                          <span className="font-semibold text-red-400">{triageResult.complianceRouting.team}</span>
                          <span className="text-slate-600">→</span>
                          <span className="font-mono text-red-400 text-xs">{triageResult.complianceRouting.channel}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Evidence & Follow-up panel */}
                  {llmError && (
                    <div className="bg-red-950 border border-red-800 rounded-lg p-3 mb-3 text-red-400 text-xs">{llmError}</div>
                  )}
                  {llmResult && (
                    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 mb-3 space-y-3">
                      <div>
                        <div className="text-xs text-slate-600 uppercase tracking-widest mb-1">Evidence & Reasoning</div>
                        <p className="text-xs text-slate-300 leading-relaxed">{llmResult.evidence}</p>
                      </div>
                      <div>
                        <div className="text-xs text-slate-600 uppercase tracking-widest mb-1">Confidence Justification</div>
                        <p className="text-xs text-slate-300 leading-relaxed">{llmResult.confidenceJustification}</p>
                      </div>
                      <div>
                        <div className="text-xs text-slate-600 uppercase tracking-widest mb-1">Follow-up Questions</div>
                        <ol className="space-y-1">
                          {llmResult.followUpQuestions.map((q, i) => (
                            <li key={i} className="text-xs text-slate-300 flex gap-2">
                              <span className="text-emerald-600 font-mono flex-shrink-0">{i + 1}.</span> {q}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}

                  {/* Override */}
                  <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-slate-600 uppercase tracking-widest">Human Override</div>
                      <button onClick={() => setOverrideMode(v => !v)} className="text-xs text-emerald-600 hover:text-emerald-400">
                        {overrideMode ? "Cancel" : "Override"}
                      </button>
                    </div>
                    {overrideMode ? (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-600 mb-1 block">Bucket</label>
                          <select value={override.bucket} onChange={e => setOverride(o => ({ ...o, bucket: e.target.value }))}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100 outline-none">
                            {Object.keys(BUCKET_COLORS).map(b => <option key={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-slate-600 mb-1 block">Severity</label>
                          <select value={override.severity} onChange={e => setOverride(o => ({ ...o, severity: e.target.value }))}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100 outline-none">
                            {["Sev0", "Sev1", "Sev2", "Sev3"].map(s => <option key={s}>{s}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-slate-600 mb-1 block">Reason</label>
                          <input value={override.note} onChange={e => setOverride(o => ({ ...o, note: e.target.value }))}
                            placeholder="Why overriding?"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-100 outline-none placeholder-slate-700" />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-700">Classification will be confirmed as-is.</div>
                    )}
                  </div>

                  <button onClick={handleConfirmRoute}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors">
                    Confirm & Route →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── QUEUE ── */}
        {view === "queue" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-lg font-semibold text-slate-100 mb-1">Triage Queue</h1>
                <p className="text-slate-500 text-sm">{filtered.length} ticket{filtered.length !== 1 ? "s" : ""}</p>
              </div>
              <button onClick={() => setView("submit")} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg transition-colors">
                + New Report
              </button>
            </div>

            {/* Filters */}
            <div className="flex gap-2 mb-4">
              {[
                { key: "bucket", options: Object.keys(BUCKET_COLORS), label: "All buckets" },
                { key: "severity", options: ["Sev0", "Sev1", "Sev2", "Sev3"], label: "All severities" },
                { key: "status", options: STATUS_OPTIONS, label: "All statuses" },
              ].map(({ key, options, label }) => (
                <select key={key} value={queueFilters[key]}
                  onChange={e => setQueueFilters(f => ({ ...f, [key]: e.target.value }))}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-300 outline-none">
                  <option value="">{label}</option>
                  {options.map(o => <option key={o}>{o}</option>)}
                </select>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div className="text-slate-600 text-sm py-12 text-center">No tickets yet. Submit a report to get started.</div>
            ) : (
              <div className="space-y-2">
                {filtered.map(ticket => (
                  <div key={ticket.id} className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-800 transition-colors"
                      onClick={() => setExpandedRow(expandedRow === ticket.id ? null : ticket.id)}>
                      <span className="text-slate-600 font-mono text-xs w-16">{ticket.id}</span>
                      <span className="text-slate-300 text-sm flex-1 truncate">{ticket.customer}</span>
                      <Badge className={BUCKET_COLORS[ticket.bucket]}>{ticket.bucket}</Badge>
                      <Badge className={SEV_COLORS[ticket.severity]?.badge}>{ticket.severity}</Badge>
                      {ticket.isComplianceRisk && <Badge className="bg-red-800 text-red-200">⚠ compliance</Badge>}
                      <select value={ticket.status}
                        onChange={e => { e.stopPropagation(); handleStatusChange(ticket.id, e.target.value); }}
                        onClick={e => e.stopPropagation()}
                        className={`rounded px-2 py-0.5 text-xs font-semibold outline-none border-0 ${STATUS_COLORS[ticket.status]}`}>
                        {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                      </select>
                      <span className="text-slate-600 text-xs">
                        {new Date(ticket.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {expandedRow === ticket.id && (
                      <div className="px-4 pb-4 border-t border-slate-800 pt-3">
                        <div className="italic text-slate-400 text-sm mb-3">"{ticket.report}"</div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs text-slate-500 mb-1 uppercase tracking-widest">Routing</div>
                            <div className="text-sm">{ticket.routing.team} <span className="text-emerald-400 font-mono">{ticket.routing.channel}</span></div>
                            {ticket.complianceRouting && (
                              <div className="text-sm mt-1">{ticket.complianceRouting.team} <span className="text-red-400 font-mono">{ticket.complianceRouting.channel}</span></div>
                            )}
                          </div>
                          <div>
                            <div className="text-xs text-slate-500 mb-1 uppercase tracking-widest">Tags</div>
                            <div>{ticket.secondaryTags.map(t => <Tag key={t}>{t}</Tag>)}</div>
                          </div>
                          {ticket.llmResult && (
                            <>
                              <div className="col-span-2">
                                <div className="text-xs text-slate-500 mb-1 uppercase tracking-widest">Evidence</div>
                                <div className="text-sm text-slate-300">{ticket.llmResult.evidence}</div>
                              </div>
                              <div className="col-span-2">
                                <div className="text-xs text-slate-500 mb-1 uppercase tracking-widest">Follow-up Questions</div>
                                <ol className="text-sm text-slate-300 space-y-0.5">
                                  {ticket.llmResult.followUpQuestions.map((q, i) => <li key={i}><span className="text-emerald-600">{i + 1}.</span> {q}</li>)}
                                </ol>
                              </div>
                            </>
                          )}
                          {ticket.override && (
                            <div className="col-span-2 bg-amber-950 border border-amber-800 rounded p-3">
                              <div className="text-xs text-amber-400 font-semibold mb-1">Override Applied</div>
                              <div className="text-xs text-amber-300">{ticket.override.note || "No reason provided"}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LLM call — LLM is the primary classifier, rules layer is compliance backstop only ──
async function callLLMWithKey(reportText, impact, rulesPrecheck, apiKey) {
  const precheckHit = rulesPrecheck.bucket !== null;

  const prompt = `You are a bug triage classifier for Salient, a voice AI platform for US consumer lenders. Salient's agents handle loan servicing calls — payments, collections, disputes, hardship plans — via voice AI. Your job is to classify incoming bug reports using the framework below.

CLASSIFICATION FRAMEWORK

BUCKETS — classify by where the failure originates, not where the harm lands.
STT (Speech-to-Text): The agent mishears or fails to recognize what the caller said. The failure is in the listening/transcription layer. Even if the downstream consequence is severe (wrong collections action, wrong payment), if the root cause is mishearing, it's STT.
TTS (Text-to-Speech): The agent speaks incorrectly. Includes robotic or garbled audio, wrong pronunciation, barge-in failure, latency in audio output, cuts off mid-sentence.
LLM: The agent heard correctly but reasoned, decided, or responded incorrectly. Includes looping, wrong intent classification, bad tool use, hallucinated information, off-policy responses, tone violations.
Post-call: The failure happens after the call ends. Includes CRM writes, Salesforce notes, summaries, disposition codes, duplicate or missing post-call records.
Infra: The call cannot connect, complete, or have its data stored. Includes carrier failures, webhook errors, storage failures, authentication errors, recording retrieval failures.

SEVERITY — apply top to bottom, first match wins.
Sev0: Any compliance violation — agent made a false claim about legal consequences of non-payment (arrest, garnishment, liens, lawsuits, asset seizure, prosecution). One instance is enough, scope is irrelevant. Also Sev0: agent systematically denying service to a language group that Salient supports (LEP discrimination). Also Sev0: no data being saved at all across calls (complete pipeline failure, nothing is saving, entire post-call pipeline down).
Sev1: Business cannot be completed AND many callers are confirmed affected. Both conditions required. Business cannot be completed means the call reaches zero outcome — no payment made, no dispute filed, no plan set up. Not degraded, not slow — zero outcome. Also Sev1: any STT misclassification that triggers a downstream financial or legal action (collections escalation, wrong payment, dispute filing) regardless of confirmed scope — the downstream consequence sets the Sev1 floor even for a single caller.
Sev2: Few callers affected, not confirmed systemic, temporary fix or workaround exists. Also Sev2: system-level feature failures that degrade but don't block business entirely (barge-in broken, latency on long calls, robotic audio where caller can still complete transaction). Also Sev2: post-call failures where primary record (audio or transcript) still exists.
Sev3: Cosmetic issue, annoyance only, one-off, no financial or compliance dimension. Caller completes their transaction. Includes isolated pronunciation errors, duplicate data that is cleanable and caused no harm, transcript gaps on a single call where audio is intact.

ESCALATION PATHS — apply these after initial severity:
Sev2 → Sev1: if follow-up confirms callers are failing to complete transactions (not just annoyed — actually failing). Applies to: robotic audio, latency, barge-in broken.
Sev2 → Sev1: if looping is confirmed affecting many callers.
Sev1 → Sev0: if missing recordings are confirmed to include missing transcripts as well — no record of any kind exists.
Sev3 → Sev2: if pronunciation errors are confirmed recurring across many callers.
Sev3 → Sev2: if transcript inaudible is confirmed recurring across many calls (not just one).

CONFIDENCE — reflects information quality, not model certainty.
High: The report contains enough information to classify without ambiguity. No follow-up answer would change the bucket or severity.
Med: The report gives enough to make a reasonable classification, but one specific follow-up answer would change the severity. The classification is the right starting point, not the final verdict.
Low: The report is too vague to classify reliably. Bucket or severity could be completely wrong.

SCOPE SIGNALS — use these to assess how many callers are affected.
Systemic scope confirmed: "customers," "callers," "many," "several," "widespread," "we're seeing," "we're getting," "all calls," "rate dropped," "entire cohort." Any of these confirm many callers.
Isolated scope: "a customer," "one caller," "single caller," "sometimes," "intermittent," "occasionally." These suggest few callers.
Trigger condition — NOT a scope signal: "on long calls," "when the customer interrupts," "after payments," "when interrupted." These tell you WHEN the bug fires, not HOW MANY callers are affected. Never treat a trigger condition as scope confirmation.

HARD STOPS — these override everything else.
If the report contains any language where the agent claims a legal consequence will happen to the caller for not paying — arrest, jail, garnishment, liens, asset seizure, lawsuits, prosecution, law enforcement involvement — classify as Sev0, LLM bucket, compliance-risk tag. One instance is sufficient.
If the report describes systematic failure to serve a language group that Salient supports — classify as Sev0, STT bucket, compliance-risk tag. This applies to ANY language Salient supports, not just Spanish. The root cause is always STT (the system failed to recognize or route based on language) — never LLM, even if the symptom is wrong agent routing.
If the report describes complete data loss across all calls with nothing being saved — classify as Sev0, Infra bucket.

SECONDARY TAGS — assign only when clearly present. Use the five bucket names only: STT, TTS, LLM, Post-call, Infra. Assign a secondary bucket tag when the report touches a second failure layer beyond the primary.
Additionally assign these named tags when present:
compliance-risk: any legal, regulatory, or discriminatory violation
financial-action: collections, wrong payment, credit impact, dispute
looping: agent repeating same question
tool-misuse: agent using wrong data or refusing to check
barge-in: interruption handling failure
latency: slow audio response
recording: recording retrieval or storage failure
duplicate-event: double-logged data

---

BUG REPORT TO CLASSIFY: "${reportText}"
IMPACT (from dropdown): ${impact || "not specified"}
${precheckHit ? `NOTE: A compliance hard stop was already triggered by the pre-classifier. Confirmed classification: bucket=${rulesPrecheck.bucket}, severity=${rulesPrecheck.severity.level}. Your job is still to produce evidence, confidence justification, follow-up questions, and compliance flag — but do not override the bucket or severity.` : ""}

OUTPUT REQUIREMENTS — every word must earn its place:

1. BUCKET: One of: STT, TTS, LLM, Post-call, Infra

2. SEVERITY: One of: Sev0, Sev1, Sev2, Sev3

3. CONFIDENCE: One of: High, Med, Low

4. SECONDARY TAGS: Array of tag strings from the list above. Empty array if none apply.

5. EVIDENCE (1-2 sentences): Quote 1-2 specific phrases (3-7 words each, in "quotes") from the report. Explain in plain English why they point to this bucket and why this severity is warranted. This is the only place the reasoning appears to the user — make it self-contained. No jargon, no framework references.

6. CONFIDENCE JUSTIFICATION (1 sentence): State the single most important fact that is missing or unconfirmed. Plain English. If High, explain what made it unambiguous. Format: "[Specific unknown] is unconfirmed." or "Classification is unambiguous because [reason]."

7. FOLLOW-UP QUESTIONS (2-5 questions, each ≤ 18 words, ordered by decision-criticality):
   - If a workaround is implied: first question must probe whether callers are actually failing to complete transactions, not just annoyed.
   - If a trigger condition is mentioned: ask for the precise threshold so engineering can reproduce it.
   - For compliance cases: ask what happened to the affected customer and whether other calls were reviewed.
   - Otherwise: probe scope, frequency, and downstream financial consequence.

8. COMPLIANCE FLAG: true only if the report describes a legal violation or regulatory risk — false legal threats, illegal discrimination, coercive payment demands, FDCPA/UDAAP violations. false for everything else including bugs, quality issues, and general misbehavior.

Respond ONLY with valid JSON, no preamble, no markdown:
{"bucket":"STT","severity":"Sev2","confidence":"Med","secondaryTags":[],"evidence":"string","confidenceJustification":"string","followUpQuestions":["string","string"],"complianceFlag":false}`;

  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.map(c => c.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  // If a compliance precheck hard stop already fired, honour it — don't let the LLM downgrade
  if (rulesPrecheck.bucket !== null) {
    parsed.bucket = rulesPrecheck.bucket;
    parsed.severity = rulesPrecheck.severity.level;
    parsed.complianceFlag = true;
  }

  return parsed;
}
