import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, History, ShieldCheck, XCircle } from 'lucide-react'
import { agentHealth } from '@/lib/agentBackend'
import { getPolicy, getScheduleRuns, getSchedules, isPaired, type UserAgentPolicy, type UserAgentSchedule, type UserAgentScheduleRun } from '@/lib/pairing'
import { useStore } from '@/lib/store'
import { listX402PaymentHistory, type X402PaymentHistoryEntry } from '@/lib/x402History'

interface PolicyCenterProps {
  onBack: () => void
}

function short(value?: string | null): string {
  if (!value) return '—'
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value
}

function formatDate(value?: string | number | null): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function txUrl(txHash?: string | null): string | null {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return null
  return `https://testnet.arcscan.app/tx/${txHash}`
}

export function PolicyCenter({ onBack }: PolicyCenterProps) {
  const walletAddress = useStore((state) => state.walletAddress)
  const balance = useStore((state) => state.usdcBalance)
  const [paired, setPaired] = useState<boolean | null>(null)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [policy, setPolicy] = useState<UserAgentPolicy | null>(null)
  const [schedules, setSchedules] = useState<UserAgentSchedule[]>([])
  const [runs, setRuns] = useState<UserAgentScheduleRun[]>([])
  const [x402History, setX402History] = useState<X402PaymentHistoryEntry[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      try {
        const [pairedState, health, history] = await Promise.all([
          isPaired().catch(() => false),
          agentHealth().catch(() => null),
          listX402PaymentHistory().catch(() => []),
        ])
        if (cancelled) return
        setPaired(pairedState)
        setBackendOk(Boolean(health?.ok))
        setX402History(history)

        if (pairedState) {
          const [nextPolicy, nextSchedules] = await Promise.all([
            getPolicy().catch(() => null),
            getSchedules().catch(() => []),
          ])
          if (cancelled) return
          setPolicy(nextPolicy)
          setSchedules(nextSchedules)
          const runLists = await Promise.all(nextSchedules.slice(0, 3).map((schedule) => getScheduleRuns(schedule.id).catch(() => [])))
          if (!cancelled) setRuns(runLists.flat().slice(0, 8))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load proof center.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const auditRows = useMemo(() => [
    { label: 'Wallet paired', ok: paired === true, value: paired == null ? 'checking' : paired ? 'yes' : 'no' },
    { label: 'Backend live', ok: backendOk === true, value: backendOk == null ? 'checking' : backendOk ? 'Render OK' : 'unavailable' },
    { label: 'Weekly budget', ok: Boolean(policy?.weeklyBudget), value: policy ? `${policy.weeklyBudget} USDC` : 'unavailable' },
    { label: 'Per-tip cap', ok: Boolean(policy?.perTipCap), value: policy ? `${policy.perTipCap} USDC` : 'unavailable' },
    { label: 'Allowlist', ok: Boolean(policy?.allowlist?.length), value: policy ? `${policy.allowlist.length} recipients` : 'unavailable' },
    { label: 'x402 approvals', ok: x402History.some((entry) => entry.status === 'paid'), value: `${x402History.filter((entry) => entry.status === 'paid').length} paid` },
    { label: 'Scheduled actions', ok: schedules.length > 0, value: `${schedules.length} schedules` },
  ], [backendOk, paired, policy, schedules.length, x402History])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-arc-bg text-white">
      <header className="shrink-0 border-b border-arc-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-full border border-arc-border bg-arc-card" aria-label="Back">
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-tight">Proof & Policy Center</p>
            <p className="text-[11px] text-arc-text-dim">What Gogo can do, what it did, and what is proven.</p>
          </div>
          <ShieldCheck size={19} className="text-emerald-300" />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section className="rounded-[28px] border border-emerald-300/20 bg-emerald-300/[0.07] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-200/80">Policy snapshot</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{short(walletAddress)}</p>
          <p className="mt-1 text-xs text-arc-text-dim">Balance: {balance ?? 'unavailable'} USDC · autonomy without bypass</p>
          {error && <p className="mt-2 text-xs text-arc-danger">{error}</p>}
        </section>

        <section className="mt-3 grid grid-cols-2 gap-2">
          {auditRows.map((row) => (
            <div key={row.label} className="rounded-[20px] border border-arc-border bg-arc-card p-3">
              <div className="flex items-center gap-2">
                {row.ok ? <CheckCircle2 size={15} className="text-emerald-300" /> : <XCircle size={15} className="text-amber-300" />}
                <p className="text-[11px] font-semibold">{row.label}</p>
              </div>
              <p className="mt-2 text-sm font-semibold">{row.value}</p>
            </div>
          ))}
        </section>

        <section className="mt-3 rounded-[24px] border border-arc-border bg-arc-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">x402 approvals</p>
            <History size={16} className="text-arc-text-dim" />
          </div>
          <div className="mt-3 space-y-2">
            {x402History.length === 0 ? (
              <p className="text-xs text-arc-text-dim">No local x402 approvals recorded yet.</p>
            ) : x402History.slice(0, 5).map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-arc-border bg-black/15 p-3 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold">{entry.description}</p>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase text-arc-text-dim">{entry.status}</span>
                </div>
                <p className="mt-1 text-arc-text-dim">{entry.amountUsdc} USDC · seller {short(entry.payTo)}</p>
                <p className="mt-1 text-arc-text-dim">tx/payment: {entry.txHash || entry.transaction || 'not returned yet'}</p>
                <p className="mt-1 text-arc-text-dim">nonce: {entry.nonce || 'not returned yet'}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-3 rounded-[24px] border border-arc-border bg-arc-card p-4">
          <p className="text-sm font-semibold">Scheduled payment proof</p>
          <div className="mt-3 space-y-2">
            {runs.length === 0 ? (
              <p className="text-xs text-arc-text-dim">No schedule run proof loaded yet.</p>
            ) : runs.map((run) => {
              const explorer = txUrl(run.txHash)
              return (
                <div key={run.id} className="rounded-2xl border border-arc-border bg-black/15 p-3 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{run.status}</p>
                    <p className="text-arc-text-dim">{formatDate(run.scheduledFor)}</p>
                  </div>
                  {explorer ? (
                    <button type="button" onClick={() => chrome.tabs?.create?.({ url: explorer })} className="mt-2 inline-flex items-center gap-1 text-emerald-200">
                      {short(run.txHash)} <ExternalLink size={11} />
                    </button>
                  ) : (
                    <p className="mt-2 text-arc-text-dim">ArcScan tx: {run.txHash ? short(run.txHash) : 'not available'}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
