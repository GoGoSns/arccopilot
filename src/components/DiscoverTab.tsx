import { AlertCircle, RefreshCcw, Target, Trophy, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatAddress } from '@/lib/utils'
import { useEcosystemStats } from '@/lib/hooks/useEcosystemStats'
import { useTopBuilders } from '@/lib/hooks/useTopBuilders'

interface DiscoverTabProps {
  address?: string | null
  onViewAll?: () => void
}

function hashToHue(address: string): number {
  let hash = 0
  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) % 360
  }
  return hash
}

function BuilderAvatar({ address }: { address: string }) {
  const hue = hashToHue(address)

  return (
    <div
      className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-white/10"
      style={{ background: `hsl(${hue} 70% 55% / 0.28)` }}
      aria-hidden="true"
    >
      <div
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: `hsl(${hue} 80% 60%)` }}
      />
    </div>
  )
}

function LoadingPulseCards() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-arc-border bg-arc-card px-2 py-2 animate-pulse">
          <div className="h-2.5 w-16 rounded-full bg-arc-border/80" />
          <div className="mt-2 h-4 w-20 rounded-full bg-arc-border/80" />
        </div>
      ))}
    </div>
  )
}

function LoadingBuilderRows() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-2 rounded-lg border border-arc-border bg-arc-card px-2 py-2 animate-pulse"
        >
          <div className="h-3 w-5 rounded-full bg-arc-border/80" />
          <div className="h-[18px] w-[18px] rounded-full bg-arc-border/80" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="h-2.5 w-32 rounded-full bg-arc-border/80" />
            <div className="h-2 w-24 rounded-full bg-arc-border/60" />
          </div>
          <div className="h-2.5 w-16 rounded-full bg-arc-border/80" />
        </div>
      ))}
    </div>
  )
}

export function DiscoverTab({ address, onViewAll }: DiscoverTabProps) {
  const stats = useEcosystemStats()
  const buildersState = useTopBuilders(address)

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.2em] text-arc-text-dim">Ecosystem Pulse</p>
            <p className="text-[10px] text-arc-text-dim">Live Arc Testnet network snapshot</p>
          </div>
          <p className="text-[10px] text-arc-text-dim">
            Avg block time {stats.isLoading ? '—' : stats.averageBlockTimeLabel}
          </p>
        </div>

        {stats.error ? (
          <Card className="p-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 text-arc-danger" size={16} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-arc-text">Couldn&apos;t load ecosystem stats</p>
                <p className="text-xs text-arc-text-dim">{stats.error}</p>
              </div>
            </div>
            <Button className="mt-3" variant="ghost" size="sm" onClick={() => void stats.refresh()}>
              <RefreshCcw size={12} />
              Retry
            </Button>
          </Card>
        ) : stats.isLoading ? (
          <LoadingPulseCards />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Card className="rounded-lg px-2 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">24h volume</p>
              <p className="mt-1 text-[13px] font-semibold text-arc-gold">{stats.volume24h}</p>
            </Card>
            <Card className="rounded-lg px-2 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">Active wallets</p>
              <p className="mt-1 text-[13px] font-semibold text-arc-gold">{stats.activeWallets}</p>
            </Card>
            <Card className="rounded-lg px-2 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">Total tx</p>
              <p className="mt-1 text-[13px] font-semibold text-arc-gold">{stats.totalTxs}</p>
            </Card>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.2em] text-arc-text-dim">Top Builders</p>
            <p className="text-[10px] text-arc-text-dim">Most active addresses on Arc Testnet</p>
          </div>
          {onViewAll ? (
            <button
              onClick={onViewAll}
              className="text-[10px] font-medium text-arc-gold transition-colors hover:text-arc-gold/80"
            >
              View all →
            </button>
          ) : null}
        </div>

        {buildersState.error ? (
          <Card className="p-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 text-arc-danger" size={16} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-arc-text">Couldn&apos;t load builders</p>
                <p className="text-xs text-arc-text-dim">{buildersState.error}</p>
              </div>
            </div>
            <Button className="mt-3" variant="ghost" size="sm" onClick={() => void buildersState.refresh()}>
              <RefreshCcw size={12} />
              Retry
            </Button>
          </Card>
        ) : buildersState.isLoading ? (
          <LoadingBuilderRows />
        ) : buildersState.builders.length === 0 ? (
          <Card className="px-3 py-4 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-arc-gold/10 text-arc-gold">
              <Users size={18} />
            </div>
            <p className="mt-2 text-sm font-medium text-arc-text">No builders yet</p>
            <p className="mt-1 text-xs text-arc-text-dim">Active addresses will appear here once ArcScan indexes more data.</p>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {buildersState.builders.map((builder, index) => {
              return (
                <div
                  key={builder.address}
                  className="flex items-center gap-2 rounded-lg border border-arc-border bg-arc-card px-2 py-2"
                >
                  <span className="w-5 text-[10px] font-semibold text-arc-text-dim">#{index + 1}</span>
                  <BuilderAvatar address={builder.address} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[11px] font-medium text-arc-text">
                        {formatAddress(builder.address, 4)}
                      </p>
                      {builder.isYou && (
                        <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                          You
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[9px] text-arc-text-dim">
                      {builder.txCount.toLocaleString('en-US')} tx · {builder.volume} vol
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div>
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-arc-text-dim">Live Opportunities</p>
          <p className="text-[10px] text-arc-text-dim">Community drops and time-boxed rewards</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Card className="flex flex-col gap-2 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-arc-gold/10 text-arc-gold">
                <Trophy size={16} />
              </div>
              <span className="rounded-full border border-arc-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-arc-text-dim">
                Live
              </span>
            </div>
            <div>
              <p className="text-[11px] font-medium text-arc-text">Hackathon</p>
              <p className="mt-0.5 text-[10px] text-arc-text-dim">Ends in 2d 4h</p>
            </div>
          </Card>

          <Card className="flex flex-col gap-2 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-arc-success/10 text-arc-success">
                <Target size={16} />
              </div>
              <span className="rounded-full border border-arc-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-arc-text-dim">
                Open
              </span>
            </div>
            <div>
              <p className="text-[11px] font-medium text-arc-text">Bounty 500 USDC</p>
              <p className="mt-0.5 text-[10px] text-arc-text-dim">Community reward pool</p>
            </div>
          </Card>
        </div>
      </section>
    </div>
  )
}
